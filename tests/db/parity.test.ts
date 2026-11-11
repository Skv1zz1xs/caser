import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { setupDb, type Db } from './helpers'
import { CATALOG } from '../../src/shared/catalog'
import { hmacHexSync, splitRoll } from '../../src/shared/fair'
import { rollDrop } from '../../src/shared/roll'
import { contractMult, contractResult } from '../../src/shared/contract'
import { resolveBattle } from '../../src/shared/battle'
import { levelFromXp } from '../../src/shared/progress'
import { BATTLE_FORMATS, BATTLE_MODES } from '../../src/config/economy'

let db: Db
beforeAll(async () => {
  db = await setupDb()
})
afterAll(async () => {
  await db.close()
})

let seed = 987654321
const rnd = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0)

describe('parity TS ↔ SQL', () => {
  it('HMAC и разбор hex совпадают', async () => {
    for (let i = 0; i < 20; i++) {
      const key = 'ключ-' + rnd()
      const msg = 'сид:' + i
      const hex = hmacHexSync(key, msg)
      const r = (await db.admin.query('select game.hmac_hex($1,$2) h, (game.roll_nums(game.hmac_hex($1,$2))).*', [key, msg])).rows[0]
      expect(r.h).toBe(hex)
      expect({ n0: r.n0, n1: r.n1, n2: r.n2, n3: r.n3 }).toEqual(splitRoll(hex))
    }
  })

  it('2000 случайных роллов дают одинаковый дроп', async () => {
    const cases: string[] = []
    const n0: number[] = []
    const n1: number[] = []
    const n2: number[] = []
    for (let i = 0; i < 2000; i++) {
      cases.push(CATALOG.cases[rnd() % CATALOG.cases.length].id)
      n0.push(rnd() * 1048576 + (rnd() % 1048576))
      n1.push(rnd())
      n2.push(rnd())
    }
    const rows = (
      await db.admin.query(
        'select t.ord, d.* from unnest($1::text[], $2::bigint[], $3::bigint[], $4::bigint[]) with ordinality t(c, a, b, e, ord), ' +
          'lateral game.roll_drop(t.c, t.a, t.b, t.e) d order by t.ord',
        [cases, n0, n1, n2],
      )
    ).rows
    expect(rows.length).toBe(2000)
    rows.forEach((r, i) => {
      const d = rollDrop(CATALOG.caseById.get(cases[i])!, { n0: n0[i], n1: n1[i], n2: n2[i], n3: 0 })
      expect({ outcomeIdx: r.outcome_idx, itemId: r.item_id, phase: r.phase, fi: r.fi, st: r.st, price: r.price }).toEqual({
        outcomeIdx: d.outcomeIdx, itemId: d.itemId, phase: d.phase, fi: d.fi, st: d.st, price: d.price,
      })
    })
  })

  it('контракт: множитель и подбор результата совпадают', async () => {
    for (let i = 0; i < 300; i++) {
      const rarity = i % 7
      const sum = 500 + (rnd() % 3_000_000)
      const n = { n0: rnd(), n1: rnd(), n2: rnd(), n3: 0 }
      const ts = contractResult(sum, rarity, n)
      const m = (await db.admin.query('select game.contract_mult($1,$2) m', [n.n0, n.n1])).rows[0].m
      expect(m).toBe(contractMult(n.n0, n.n1))
      const r = (await db.admin.query('select * from game.contract_pick($1,$2,$3)', [ts.value, rarity + 1, n.n2])).rows[0]
      expect({ caseId: r.case_id, outcomeIdx: r.idx, itemId: r.item_id, phase: r.phase, fi: r.fi, price: r.price }).toEqual({
        caseId: ts.caseId, outcomeIdx: ts.outcomeIdx, itemId: ts.itemId, phase: ts.phase, fi: ts.fi, price: ts.price,
      })
    }
  })

  it('батл: победитель и выплаты совпадают во всех режимах и форматах', async () => {
    for (const f of BATTLE_FORMATS)
      for (const m of BATTLE_MODES)
        for (let k = 0; k < 12; k++) {
          const rounds = 1 + (rnd() % 4)
          const values = Array.from({ length: rounds }, () =>
            Array.from({ length: f.slots }, () => (k % 3 === 0 ? 100 : 1 + (rnd() % 100000))),
          )
          const tie = rnd() * 4096 + (rnd() % 4096)
          const sql = (await db.admin.query('select game.battle_resolve($1,$2,$3::jsonb,$4) r', [m.id, f.id, JSON.stringify(values), tie])).rows[0].r
          expect(sql).toEqual(resolveBattle({ mode: m.id, format: f.id, values, tie }))
        }
  })

  it('уровень батл-пасса по XP совпадает', async () => {
    for (const xp of [0, 149, 150, 151, 330, 5000, 29399, 29400, 999999]) {
      const l = (await db.admin.query('select game.level_of($1) l', [xp])).rows[0].l
      expect(l).toBe(levelFromXp(xp).level)
    }
  })
})
