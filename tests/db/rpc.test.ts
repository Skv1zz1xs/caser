import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { setupDb, type Db } from './helpers'
import { CATALOG, caseOf } from '../../src/shared/catalog'
import { rollNums } from '../../src/shared/fair'
import { rollDrop } from '../../src/shared/roll'
import { resolveBattle } from '../../src/shared/battle'
import { BONUS, COINFLIP, PASS } from '../../src/config/economy'

let db: Db
beforeAll(async () => {
  db = await setupDb()
})
afterAll(async () => {
  await db.close()
})

const err = async (p: Promise<unknown>) => {
  try {
    await p
  } catch (e: any) {
    return String(e.message)
  }
  return ''
}
const pastBattle = (id: string) => db.admin.query("update battles set started_at = started_at - interval '10 minutes', ends_at = ends_at - interval '10 minutes' where id = $1", [id])
const settle = (id: string) => db.admin.query("update pending_credits set available_at = now() - interval '1 second' where profile_id = $1", [id])

describe('вход и права', () => {
  it('новый ник создаёт профиль со стартовым балансом', async () => {
    const uid = randomUUID()
    const r = await db.rpc(uid, 'login', { p_nick: 'Вася', p_pin: '123456', p_avatar: 3 })
    expect(r.ok).toBe(true)
    expect(r.created).toBe(true)
    expect(r.me.balance).toBe(BONUS.startBalance * 100)
    expect(r.me.fair.hash).toMatch(/^[0-9a-f]{64}$/)
  })
  it('занятый ник с неверным PIN отклоняется, с верным — пускает с другого устройства', async () => {
    const bad = await db.rpc(randomUUID(), 'login', { p_nick: 'вася', p_pin: '0000' })
    expect(bad.ok).toBe(false)
    const ok = await db.rpc(randomUUID(), 'login', { p_nick: 'ВАСЯ', p_pin: '123456' })
    expect(ok.ok).toBe(true)
    expect(ok.created).toBe(false)
  })
  it('пять неверных PIN блокируют вход', async () => {
    await db.user('Замок', '654321')
    for (let i = 0; i < 5; i++) await db.rpc(randomUUID(), 'login', { p_nick: 'Замок', p_pin: 'xxxxxx' })
    const r = await db.rpc(randomUUID(), 'login', { p_nick: 'Замок', p_pin: '654321' })
    expect(r.ok).toBe(false)
    expect(r.error).toContain('попыток')
  })
  it('кривой ник и короткий PIN не проходят', async () => {
    expect((await db.rpc(randomUUID(), 'login', { p_nick: 'a', p_pin: '123456' })).ok).toBe(false)
    expect((await db.rpc(randomUUID(), 'login', { p_nick: '<script>', p_pin: '123456' })).ok).toBe(false)
    expect((await db.rpc(randomUUID(), 'login', { p_nick: 'Норм', p_pin: '12' })).ok).toBe(false)
  })
  it('без входа RPC недоступны, sync отдаёт me = null', async () => {
    const uid = randomUUID()
    expect((await db.rpc(uid, 'sync')).me).toBeNull()
    expect(await err(db.rpc(uid, 'open_case', { p_case: 'meloch' }))).toContain('Нужно войти')
  })
  it('клиентская роль не может менять таблицы и читать приватное', async () => {
    const c = await db.admin.connect()
    const tryAs = async (role: string, sql: string) => {
      await c.query('begin')
      await c.query('set local role ' + role)
      const e = await err(c.query(sql))
      await c.query('rollback')
      return e
    }
    try {
      expect(await tryAs('authenticated', 'update profiles set balance = 99999999')).toMatch(/permission denied/)
      expect(await tryAs('authenticated', "insert into chat (nick, body) values ('x','y')")).toMatch(/permission denied/)
      expect(await tryAs('authenticated', 'select * from seeds')).toMatch(/permission denied/)
      expect(await tryAs('authenticated', 'select * from secrets')).toMatch(/permission denied/)
      expect(await tryAs('authenticated', 'select * from cfg_kv')).toMatch(/permission denied/)
      expect(await tryAs('authenticated', "select game.cfg('recipes')")).toMatch(/permission denied/)
      expect(await tryAs('anon', 'select public.sync()')).toMatch(/permission denied/)
      expect(await tryAs('anon', 'select nick from profiles limit 1')).toBe('')
    } finally {
      c.release()
    }
  })
})

describe('открытие и продажа', () => {
  it('списывает цену × N, создаёт N предметов, дроп перепроверяется по сидам', async () => {
    const u = await db.user('Открыватель')
    const c = caseOf('sigma')
    const r = await db.rpc(u.uid, 'open_case', { p_case: 'sigma', p_count: 5 })
    expect(r.drops.length).toBe(5)
    expect(r.me.balance).toBe(BONUS.startBalance * 100 - c.price * 5)
    expect(r.me.inv_count).toBe(5)
    expect(r.me.stats.opened).toBe(5)
    // честность: раскрываем сид и пересчитываем первый дроп
    const before = r.me.fair
    const rot = await db.rpc(u.uid, 'fair_rotate')
    expect(rot.revealed.hash).toBe(before.hash)
    const rolls = await db.rpc(u.uid, 'fair_rolls', { p_limit: 10 })
    expect(rolls.length).toBe(5)
    for (const roll of rolls) {
      expect(roll.server_seed).toBe(rot.revealed.server_seed)
      const d = rollDrop(c, rollNums(roll.server_seed, roll.client_seed, roll.nonce))
      expect({ item: d.itemId, fi: d.fi, st: d.st, price: d.price, phase: d.phase }).toEqual({
        item: roll.detail.item, fi: roll.detail.fi, st: roll.detail.st, price: roll.detail.price, phase: roll.detail.phase,
      })
    }
    expect(rot.fair.nonce).toBe(0)
    expect(rot.fair.hash).not.toBe(before.hash)
  })
  it('server seed не виден, пока не раскрыт', async () => {
    const u = await db.user('Скрытный')
    await db.rpc(u.uid, 'open_case', { p_case: 'meloch', p_count: 1 })
    const rolls = await db.rpc(u.uid, 'fair_rolls')
    expect(rolls[0].server_seed).toBeNull()
    expect(rolls[0].hash).toMatch(/^[0-9a-f]{64}$/)
  })
  it('недостаточно монет / неверное количество / бесплатный кейс напрямую — ошибка без изменений', async () => {
    const u = await db.user('Бедняк')
    expect(await err(db.rpc(u.uid, 'open_case', { p_case: 'absolut' }))).toContain('Недостаточно монет')
    expect(await err(db.rpc(u.uid, 'open_case', { p_case: 'meloch', p_count: 11 }))).toContain('от 1 до')
    expect(await err(db.rpc(u.uid, 'open_case', { p_case: 'free' }))).toContain('бонус')
    expect(await err(db.rpc(u.uid, 'open_case', { p_case: 'нет' }))).toContain('Нет такого кейса')
    expect(await db.balance(u.id)).toBe(BONUS.startBalance * 100)
  })
  it('параллельные открытия не уводят баланс в минус и не теряют списания', async () => {
    const u = await db.user('Кликер')
    await db.setBalance(u.id, 300) // хватит ровно на 3 «50/50» по 100
    const res = await Promise.allSettled(Array.from({ length: 6 }, () => db.rpc(u.uid, 'open_case', { p_case: 'r5050', p_count: 1 })))
    expect(res.filter((x) => x.status === 'fulfilled').length).toBe(3)
    expect(await db.balance(u.id)).toBe(0)
    expect((await db.rpc(u.uid, 'get_inventory')).items.length).toBe(3)
  })
  it('продажа: зачисляет сумму, чужое и несуществующее продать нельзя', async () => {
    const a = await db.user('Продавец')
    const b = await db.user('Чужой')
    const mine = await db.give(a.id, 'sigma', 0, { price: 700 })
    const other = await db.give(b.id, 'sigma', 0, { price: 900 })
    expect(await err(db.rpc(a.uid, 'sell_items', { p_ids: [mine, other] }))).toContain('уже нет')
    expect(await db.balance(a.id)).toBe(BONUS.startBalance * 100)
    const r = await db.rpc(a.uid, 'sell_items', { p_ids: [mine] })
    expect(r.amount).toBe(700)
    expect(r.me.balance).toBe(BONUS.startBalance * 100 + 700)
    expect(await err(db.rpc(a.uid, 'sell_items', { p_ids: [mine] }))).toContain('уже нет')
    expect((await db.rpc(b.uid, 'get_inventory')).items.length).toBe(1)
  })
  it('«продать всё дешевле X» трогает только дешёвое', async () => {
    const u = await db.user('Чистильщик')
    await db.give(u.id, 'sigma', 0, { price: 100 })
    await db.give(u.id, 'sigma', 1, { price: 200 })
    const keep = await db.give(u.id, 'sigma', 2, { price: 5000 })
    const r = await db.rpc(u.uid, 'sell_below', { p_max_price: 200 })
    expect(r.sold).toBe(2)
    expect(r.amount).toBe(300)
    expect((await db.rpc(u.uid, 'get_inventory')).items.map((i: any) => i.id)).toEqual([keep])
  })
  it('бесплатные открытия (тикеты) не списывают баланс', async () => {
    const u = await db.user('Тикетный')
    await db.admin.query(`update profiles set tickets = '{"sigma": 2}' where id = $1`, [u.id])
    const r = await db.rpc(u.uid, 'open_case', { p_case: 'sigma', p_count: 2, p_ticket: true })
    expect(r.me.balance).toBe(BONUS.startBalance * 100)
    expect(r.me.tickets.sigma).toBeUndefined()
    expect(await err(db.rpc(u.uid, 'open_case', { p_case: 'sigma', p_count: 1, p_ticket: true }))).toContain('Не хватает')
  })
  it('sync отдаёт версию конфига, совпадающую с клиентской, ленту и чат', async () => {
    const u = await db.user('Синк')
    await db.rpc(u.uid, 'chat_send', { p_text: '  привет   всем ' })
    const s = await db.rpc(u.uid, 'sync')
    expect(s.version).toBe(CATALOG.version)
    expect(s.me.nick).toBe('Синк')
    expect(s.chat.at(-1).body).toBe('привет всем')
    expect(s.online).toBeGreaterThan(0)
    const s2 = await db.rpc(u.uid, 'sync', { p_chat_after: s.chat.at(-1).id, p_feed_after: 0 })
    expect(s2.chat.length).toBe(0)
    expect(await err(db.rpc(u.uid, 'chat_send', { p_text: 'x'.repeat(500) }))).toContain('длинное')
  })
})

describe('апгрейдер', () => {
  it('шанс вне коридора отклоняется, предметы целы', async () => {
    const u = await db.user('Апер1')
    const it1 = await db.give(u.id, 'sigma', 0, { price: 100 })
    const big = caseOf('absolut').outcomes.at(-1)!
    expect(await err(db.rpc(u.uid, 'upgrade', { p_ids: [it1], p_coins: 0, p_case: 'absolut', p_idx: big.idx }))).toContain('Шанс')
    const tiny = caseOf('meloch').outcomes[0]
    expect(await err(db.rpc(u.uid, 'upgrade', { p_ids: [it1], p_coins: 0, p_case: 'meloch', p_idx: tiny.idx }))).toContain('Шанс')
    expect((await db.rpc(u.uid, 'get_inventory')).items.length).toBe(1)
  })
  it('предметы и монеты сгорают; при победе появляется цель по точной цене; шанс считается как в ТЗ', async () => {
    const u = await db.user('Апер2')
    const target = caseOf('sigma').outcomes.find((o) => o.price > 20000)!
    let wins = 0
    for (let i = 0; i < 40; i++) {
      const input = Math.floor(target.price / 2)
      const id = await db.give(u.id, 'meloch', 0, { price: input - 500 })
      await db.setBalance(u.id, 5)
      const r = await db.rpc(u.uid, 'upgrade', { p_ids: [id], p_coins: 500, p_case: 'sigma', p_idx: target.idx })
      expect(r.ppm).toBe(Math.floor((input * 950000) / target.price))
      expect(r.win).toBe(r.roll < r.ppm)
      expect(r.me.balance).toBe(0)
      const inv = (await db.rpc(u.uid, 'get_inventory')).items
      if (r.win) {
        wins++
        expect(inv.length).toBe(1)
        expect(inv[0].price).toBe(target.price)
        expect(inv[0].item).toBe(target.itemId)
        await db.rpc(u.uid, 'sell_items', { p_ids: [inv[0].id] })
      } else expect(inv.length).toBe(0)
    }
    expect(wins).toBeGreaterThan(5)
    expect(wins).toBeLessThan(35)
  })
  it('нельзя вложить чужой предмет или монет больше, чем есть', async () => {
    const a = await db.user('Апер3')
    const b = await db.user('Апер4')
    const foreign = await db.give(b.id, 'sigma', 0, { price: 1000 })
    const t = caseOf('sigma').outcomes.find((o) => o.price > 1500 && o.price < 50000)!
    expect(await err(db.rpc(a.uid, 'upgrade', { p_ids: [foreign], p_coins: 0, p_case: 'sigma', p_idx: t.idx }))).toContain('уже нет')
    expect(await err(db.rpc(a.uid, 'upgrade', { p_ids: [], p_coins: 99999999, p_case: 'sigma', p_idx: t.idx }))).toContain('Недостаточно')
  })
})

describe('контракты', () => {
  it('3–10 предметов одной редкости → один предмет следующей; вход сгорает', async () => {
    const u = await db.user('Юрист')
    const src = caseOf('sigma').outcomes.filter((o) => CATALOG.itemById.get(o.itemId)!.rarity === 2)
    const ids = [] as number[]
    for (let i = 0; i < 5; i++) ids.push(await db.give(u.id, 'sigma', src[i % src.length].idx))
    const r = await db.rpc(u.uid, 'contract', { p_ids: ids })
    expect(r.item.rarity).toBe(3)
    expect(r.secret).toBeNull()
    expect(r.value).toBe(Math.floor((r.sum * r.mult) / 1000))
    const inv = (await db.rpc(u.uid, 'get_inventory')).items
    expect(inv.length).toBe(1)
    expect(inv[0].id).toBe(r.item.id)
    expect(Math.abs(inv[0].price - r.value)).toBeLessThanOrEqual(Math.max(2, r.value * 0.001))
    expect(r.me.stats.contracts).toBe(1)
  })
  it('разные редкости, мало предметов, контрабанда — отклоняются', async () => {
    const u = await db.user('Юрист2')
    const c = caseOf('sigma')
    const byR = (r: number) => c.outcomes.find((o) => CATALOG.itemById.get(o.itemId)!.rarity === r)!.idx
    const a = await db.give(u.id, 'sigma', byR(1))
    const b = await db.give(u.id, 'sigma', byR(1))
    const d = await db.give(u.id, 'sigma', byR(2))
    expect(await err(db.rpc(u.uid, 'contract', { p_ids: [a, b] }))).toContain('минимум')
    expect(await err(db.rpc(u.uid, 'contract', { p_ids: [a, b, d] }))).toContain('одной редкости')
    const k = [] as number[]
    for (let i = 0; i < 3; i++) k.push(await db.give(u.id, 'sigma', byR(7)))
    expect(await err(db.rpc(u.uid, 'contract', { p_ids: k }))).toContain('контрабанды')
    expect((await db.rpc(u.uid, 'get_inventory')).items.length).toBe(6)
  })
  it('движок особых сочетаний: срабатывает, уходит на перезарядку', async () => {
    // синтетический рецепт только для теста (настоящие сюда не попадают)
    await db.admin.query(
      `update cfg_kv set value = $1::jsonb where key = 'recipes'`,
      [JSON.stringify([{ id: 't', name: 'Тестовый', minItems: 3, cond: { type: 'all_st' }, chance: 10000, target: 6, from: 3000, to: 3000, cooldownMin: 20 }])],
    )
    const u = await db.user('Алхимик')
    const idx = caseOf('dota').outcomes.find((o) => CATALOG.itemById.get(o.itemId)!.rarity === 3)!.idx
    const mk = async () => [await db.give(u.id, 'dota', idx, { st: true }), await db.give(u.id, 'dota', idx, { st: true }), await db.give(u.id, 'dota', idx, { st: true })]
    const r = await db.rpc(u.uid, 'contract', { p_ids: await mk() })
    expect(r.secret).toEqual({ name: 'Тестовый', cooling: false, hit: true })
    expect(r.item.rarity).toBe(6)
    expect(r.mult).toBe(3000)
    const r2 = await db.rpc(u.uid, 'contract', { p_ids: await mk() })
    expect(r2.secret.cooling).toBe(true)
    expect(r2.item.rarity).toBe(4)
    expect(r2.me.claims).toContain('find:Тестовый')
  })
})

describe('контракты: условия «один предмет» и «одинаковый износ»', () => {
  it('same_item и all_wear срабатывают только когда условие выполнено', async () => {
    await db.admin.query(
      `update cfg_kv set value = $1::jsonb where key = 'recipes'`,
      [JSON.stringify([
        { id: 'a', name: 'Близнецы-тест', minItems: 3, cond: { type: 'same_item' }, chance: 10000, target: 6, from: 3000, to: 3000, cooldownMin: 20 },
        { id: 'b', name: 'Износ-тест', minItems: 3, cond: { type: 'all_wear', idx: 0 }, chance: 10000, target: 6, from: 3000, to: 3000, cooldownMin: 20 },
      ])],
    )
    const u = await db.user('Секретчик')
    const idx = caseOf('dota').outcomes.find((o) => CATALOG.itemById.get(o.itemId)!.rarity === 3)!.idx
    const idx2 = caseOf('dota').outcomes.filter((o) => CATALOG.itemById.get(o.itemId)!.rarity === 3).at(-1)!.idx
    expect(idx2).not.toBe(idx)
    // три разных предмета, износ разный — рецепты не срабатывают
    const mixed = [await db.give(u.id, 'dota', idx, { fi: 100 }), await db.give(u.id, 'dota', idx2, { fi: 5000 }), await db.give(u.id, 'dota', idx2, { fi: 9000 })]
    expect((await db.rpc(u.uid, 'contract', { p_ids: mixed })).secret).toBeNull()
    // три одинаковых — «Близнецы»
    const twins = [await db.give(u.id, 'dota', idx, { fi: 5000 }), await db.give(u.id, 'dota', idx, { fi: 6000 }), await db.give(u.id, 'dota', idx, { fi: 7000 })]
    expect((await db.rpc(u.uid, 'contract', { p_ids: twins })).secret).toMatchObject({ name: 'Близнецы-тест', hit: true })
    // разные предметы, но все «С иголочки» — «Износ»
    const mint = [await db.give(u.id, 'dota', idx, { fi: 100 }), await db.give(u.id, 'dota', idx2, { fi: 200 }), await db.give(u.id, 'dota', idx2, { fi: 300 })]
    expect((await db.rpc(u.uid, 'contract', { p_ids: mint })).secret).toMatchObject({ name: 'Износ-тест', hit: true })
  })
})

describe('батлы', () => {
  it('взнос списывается, батл стартует при заполнении, исход совпадает с TS и сидом', async () => {
    const a = await db.user('Боец1')
    const b = await db.user('Боец2')
    const cases = ['sigma', 'dota']
    const cost = caseOf('sigma').price + caseOf('dota').price
    const cr = await db.rpc(a.uid, 'battle_create', { p_cases: cases, p_format: '1v1', p_mode: 'classic' })
    const id = cr.battle.id
    expect(cr.me.balance).toBe(BONUS.startBalance * 100 - cost)
    expect(cr.battle.status).toBe('open')
    expect(cr.battle.seed).toBeNull()
    expect(await err(db.rpc(a.uid, 'battle_join', { p_id: id }))).toContain('уже в этом батле')
    const jr = await db.rpc(b.uid, 'battle_join', { p_id: id })
    expect(jr.battle.status).toBe('done')
    expect(jr.battle.started_at).toBeGreaterThan(0)
    // до конца анимации итог и сид скрыты, выплата не зачислена
    expect(jr.battle.summary).toBeNull()
    expect(jr.battle.seed).toBeNull()
    expect(jr.battle.rounds.length).toBeLessThan(2)
    expect((await db.rpc(a.uid, 'sync')).me.balance).toBe(BONUS.startBalance * 100 - cost)
    await pastBattle(id)
    await settle(a.id)
    await settle(b.id)
    const v = await db.rpc(a.uid, 'get_battle', { p_id: id })
    expect(v.rounds.length).toBe(2)
    expect(v.seed).toMatch(/^[0-9a-f]{64}$/)
    // пересчёт дропов из раскрытого сида
    const values = v.rounds.map((round: any[], r: number) =>
      round.map((d, s) => {
        const mine = rollDrop(caseOf(cases[r]), rollNums(v.seed, id, r * 10 + s))
        expect(mine.itemId).toBe(d.item)
        expect(mine.price).toBe(d.price)
        return d.price
      }),
    )
    const res = resolveBattle({ mode: 'classic', format: '1v1', values, tie: rollNums(v.seed, id, 1000).n0 })
    expect(v.summary.payouts).toEqual(res.payouts)
    expect(v.summary.winnerTeam).toBe(res.winnerTeam)
    const ba = (await db.rpc(a.uid, 'sync')).me.balance
    const bb = (await db.rpc(b.uid, 'sync')).me.balance
    expect(ba + bb).toBe(2 * (BONUS.startBalance * 100 - cost) + res.pot)
    expect((await db.rpc(a.uid, 'sync')).me.stats.battles).toBe(1)
  })
  it('батл с ботами стартует сразу, шерд делит банк поровну', async () => {
    const u = await db.user('Соло')
    const cr = await db.rpc(u.uid, 'battle_create', { p_cases: ['r5050'], p_format: '1v1v1v1', p_mode: 'shared' })
    const st = await db.rpc(u.uid, 'battle_add_bot', { p_id: cr.battle.id })
    expect(st.battle.players.filter((p: any) => p.bot).length).toBe(3)
    expect(st.battle.status).toBe('done')
    await pastBattle(cr.battle.id)
    await settle(u.id)
    const v = await db.rpc(u.uid, 'get_battle', { p_id: cr.battle.id })
    expect(v.summary.winnerTeam).toBe(-1)
    const each = Math.floor(v.summary.pot / 4)
    expect((await db.rpc(u.uid, 'sync')).me.balance).toBe(BONUS.startBalance * 100 - caseOf('r5050').price + each)
  })
  it('создатель ушёл из лобби → батл отменён, взносы возвращены всем', async () => {
    const a = await db.user('Хост')
    const b = await db.user('Гость')
    const c = await db.user('Гость2')
    const cr = await db.rpc(a.uid, 'battle_create', { p_cases: ['sigma'], p_format: '1v1v1', p_mode: 'crazy' })
    await db.rpc(b.uid, 'battle_join', { p_id: cr.battle.id, p_slot: 2 })
    expect(await err(db.rpc(c.uid, 'battle_join', { p_id: cr.battle.id, p_slot: 2 }))).toContain('занято')
    expect(await err(db.rpc(b.uid, 'battle_add_bot', { p_id: cr.battle.id }))).toContain('создатель')
    // гость выходит и заходит снова
    await db.rpc(b.uid, 'battle_leave', { p_id: cr.battle.id })
    expect(await db.balance(b.id)).toBe(BONUS.startBalance * 100)
    await db.rpc(b.uid, 'battle_join', { p_id: cr.battle.id })
    const lv = await db.rpc(a.uid, 'battle_leave', { p_id: cr.battle.id })
    expect(lv.battle.status).toBe('cancelled')
    expect(await db.balance(a.id)).toBe(BONUS.startBalance * 100)
    expect(await db.balance(b.id)).toBe(BONUS.startBalance * 100)
    expect(await err(db.rpc(c.uid, 'battle_join', { p_id: cr.battle.id }))).toContain('уже начался или отменён')
  })
  it('неверные параметры батла отклоняются', async () => {
    const u = await db.user('Кривой')
    expect(await err(db.rpc(u.uid, 'battle_create', { p_cases: [], p_format: '1v1', p_mode: 'classic' }))).toContain('от 1 до')
    expect(await err(db.rpc(u.uid, 'battle_create', { p_cases: ['free'], p_format: '1v1', p_mode: 'classic' }))).toContain('неизвестный кейс')
    expect(await err(db.rpc(u.uid, 'battle_create', { p_cases: ['sigma'], p_format: '5v5', p_mode: 'classic' }))).toContain('формат')
    expect(await err(db.rpc(u.uid, 'battle_create', { p_cases: ['sigma'], p_format: '1v1', p_mode: 'wtf' }))).toContain('режим')
    expect(await err(db.rpc(u.uid, 'battle_create', { p_cases: ['absolut'], p_format: '1v1', p_mode: 'classic' }))).toContain('Недостаточно')
  })
})

describe('коинфлип', () => {
  it('победитель получает банк за вычетом комиссии, проигравший — ничего', async () => {
    const a = await db.user('Орёл')
    const b = await db.user('Решка')
    const stake = 20000
    const cr = await db.rpc(a.uid, 'coinflip_create', { p_stake: stake, p_side: 0 })
    expect(await err(db.rpc(a.uid, 'coinflip_join', { p_id: cr.id }))).toContain('самим собой')
    await db.rpc(b.uid, 'coinflip_join', { p_id: cr.id })
    await settle(a.id)
    await settle(b.id)
    const sa = await db.rpc(a.uid, 'sync')
    const sb = await db.rpc(b.uid, 'sync')
    const flip = sa.coinflips.find((f: any) => f.id === cr.id)
    const pay = (stake * 2 * (100 - COINFLIP.rakePct)) / 100
    expect(flip.result).toBe(rollNums(flip.server_seed, 'coinflip-' + cr.id, 0).n0 % 2)
    const start = BONUS.startBalance * 100 - stake
    expect([sa.me.balance, sb.me.balance].sort()).toEqual([start, start + pay].sort())
    expect(flip.winner).toBe(flip.result === 0 ? a.id : b.id)
  })
  it('отмена возвращает ставку; бот играет вместо соперника', async () => {
    const a = await db.user('Флип')
    const c1 = await db.rpc(a.uid, 'coinflip_create', { p_stake: 5000, p_side: 1 })
    const cn = await db.rpc(a.uid, 'coinflip_cancel', { p_id: c1.id })
    expect(cn.me.balance).toBe(BONUS.startBalance * 100)
    const c2 = await db.rpc(a.uid, 'coinflip_create', { p_stake: 5000, p_side: 1 })
    await db.rpc(a.uid, 'coinflip_bot', { p_id: c2.id })
    await settle(a.id)
    const s = await db.rpc(a.uid, 'sync')
    const f = s.coinflips.find((x: any) => x.id === c2.id)
    expect(s.me.balance).toBe(BONUS.startBalance * 100 - 5000 + (f.result === 1 ? 9600 : 0))
    expect(await err(db.rpc(a.uid, 'coinflip_create', { p_stake: 1, p_side: 0 }))).toContain('Ставка')
  })
})

describe('бонусы и прогрессия', () => {
  it('бесплатный кейс: даёт предмет и уходит на перезарядку', async () => {
    const u = await db.user('Халявщик')
    const r = await db.rpc(u.uid, 'bonus_free_case')
    expect(r.drops.length).toBe(1)
    expect(r.drops[0].case).toBe('free')
    expect(await err(db.rpc(u.uid, 'bonus_free_case'))).toContain('не готов')
    await db.admin.query("update profiles set free_case_at = now() - interval '11 minutes' where id = $1", [u.id])
    expect((await db.rpc(u.uid, 'bonus_free_case')).drops.length).toBe(1)
  })
  it('дейлик: раз в сутки, стрик растёт и сгорает', async () => {
    const u = await db.user('Дейлик')
    const r1 = await db.rpc(u.uid, 'bonus_daily')
    expect(r1.amount).toBe(BONUS.daily.rewards[0] * 100)
    expect(await err(db.rpc(u.uid, 'bonus_daily'))).toContain('уже получен')
    await db.admin.query("update profiles set daily_at = now() - interval '21 hours' where id = $1", [u.id])
    const r2 = await db.rpc(u.uid, 'bonus_daily')
    expect(r2.streak).toBe(2)
    expect(r2.amount).toBe(BONUS.daily.rewards[1] * 100)
    await db.admin.query("update profiles set daily_at = now() - interval '3 days' where id = $1", [u.id])
    expect((await db.rpc(u.uid, 'bonus_daily')).streak).toBe(1)
  })
  it('второй шанс: только при сливе и не чаще кулдауна', async () => {
    const u = await db.user('Феникс')
    expect(await err(db.rpc(u.uid, 'bonus_second_chance'))).toContain('слито')
    await db.setBalance(u.id, 0)
    const item = await db.give(u.id, 'sigma', 0, { price: 99999 })
    expect(await err(db.rpc(u.uid, 'bonus_second_chance'))).toContain('слито') // есть инвентарь
    await db.admin.query('delete from items where id = $1', [item])
    const r = await db.rpc(u.uid, 'bonus_second_chance')
    expect(r.me.balance).toBe(BONUS.secondChance.amount * 100)
    await db.setBalance(u.id, 0)
    expect(await err(db.rpc(u.uid, 'bonus_second_chance'))).toContain('перезаряжается')
  })
  it('задание, достижение и уровень забираются ровно один раз', async () => {
    const u = await db.user('Собиратель')
    expect(await err(db.rpc(u.uid, 'claim', { p_kind: 'quest', p_id: 'd_open' }))).toContain('не выполнено')
    await db.setBalance(u.id, 1000)
    for (let i = 0; i < 3; i++) await db.rpc(u.uid, 'open_case', { p_case: 'meloch', p_count: 10 })
    const q = await db.rpc(u.uid, 'claim', { p_kind: 'quest', p_id: 'd_open' })
    expect(q.reward.coins).toBe(25000)
    expect(q.me.claims.some((c: string) => c.startsWith('quest:d_open|d:'))).toBe(true)
    expect(await err(db.rpc(u.uid, 'claim', { p_kind: 'quest', p_id: 'd_open' }))).toContain('уже получена')
    const a = await db.rpc(u.uid, 'claim', { p_kind: 'ach', p_id: 'open10' })
    expect(a.me.claims).toContain('ach:open10')
    expect(await err(db.rpc(u.uid, 'claim', { p_kind: 'ach', p_id: 'open10' }))).toContain('уже получена')
    expect(await err(db.rpc(u.uid, 'claim', { p_kind: 'ach', p_id: 'open1000' }))).toContain('не выполнено')
    // 30 открытий × 5 XP + 120 XP за задание = 270 XP → уровень 1
    expect(a.me.level).toBe(1)
    const before = a.me.balance
    const l = await db.rpc(u.uid, 'claim', { p_kind: 'level', p_id: '1' })
    expect(l.me.balance).toBe(before + (PASS.rewards[0].coins ?? 0) * 100)
    expect(await err(db.rpc(u.uid, 'claim', { p_kind: 'level', p_id: '1' }))).toContain('уже получена')
    expect(await err(db.rpc(u.uid, 'claim', { p_kind: 'level', p_id: '2' }))).toContain('не достигнут')
  })
  it('промокод: один раз на игрока, регистр не важен', async () => {
    const u = await db.user('Промо')
    const r = await db.rpc(u.uid, 'promo_redeem', { p_code: ' друзья ' })
    expect(r.me.balance).toBe(BONUS.startBalance * 100 + 50000)
    expect(r.me.tickets.sigma).toBe(3)
    expect(await err(db.rpc(u.uid, 'promo_redeem', { p_code: 'ДРУЗЬЯ' }))).toContain('уже вводил')
    expect(await err(db.rpc(u.uid, 'promo_redeem', { p_code: 'нетакого' }))).toContain('нет')
  })
  it('дождь: банк делится между участниками', async () => {
    const a = await db.user('Мокрый1')
    const b = await db.user('Мокрый2')
    await db.admin.query('delete from rain')
    await db.admin.query("insert into rain (pot, ends_at) values (100000, now() + interval '1 minute')")
    expect((await db.rpc(a.uid, 'sync')).rain.active).toBe(true)
    await db.rpc(a.uid, 'rain_join')
    await db.rpc(a.uid, 'rain_join')
    await db.rpc(b.uid, 'rain_join')
    await db.admin.query("update rain set ends_at = now() - interval '1 second'")
    const s = await db.rpc(a.uid, 'sync')
    expect(s.rain.active).toBe(false)
    expect(s.me.balance).toBe(BONUS.startBalance * 100 + 50000)
    expect(await db.balance(b.id)).toBe(BONUS.startBalance * 100 + 50000)
    expect(await err(db.rpc(a.uid, 'rain_join'))).toContain('нет')
  })
  it('лидерборд и профиль отдаются', async () => {
    const u = await db.user('Топ')
    const lb = await db.rpc(u.uid, 'leaderboard')
    expect(lb.balance.length).toBeGreaterThan(3)
    expect(lb.balance[0].value).toBeGreaterThanOrEqual(lb.balance[1].value)
    await db.admin.query(`insert into feed (profile_id, nick, avatar, kind, data) values ($1, 'Топ', 1, 'drop', '{"price": 777700, "item": "sigma-0", "phase": 0, "fi": 100, "rarity": 5}')`, [u.id])
    const lb2 = await db.rpc(u.uid, 'leaderboard')
    expect(lb2.tonight[0].data.price).toBe(777700)
    expect(lb2.tonight[0].nick).toBe('Топ')
    const p = await db.rpc(u.uid, 'get_profile', { p_nick: 'топ' })
    expect(p.nick).toBe('Топ')
  })
})

describe('Час залёта', () => {
  it('sync отдаёт расписание события, в тестах оно выключено, множитель опыта равен 1', async () => {
    const u = await db.user('Событийный')
    const s = await db.rpc(u.uid, 'sync')
    expect(s.event.on).toBe(false)
    expect(s.event.next_at - s.event.ends_at).toBe(2100 * 1000)
    expect(s.event.next_at).toBeGreaterThan(s.now)
    expect((await db.admin.query('select game.xpm() m')).rows[0].m).toBe(1)
  })
})

describe('защита от злоупотреблений', () => {
  it('«второй шанс» не выдаётся, пока монеты лежат в открытом коинфлипе или батле', async () => {
    const u = await db.user('Хитрец')
    const flip = await db.rpc(u.uid, 'coinflip_create', { p_stake: BONUS.startBalance * 100, p_side: 0 })
    expect(await db.balance(u.id)).toBe(0)
    expect(await err(db.rpc(u.uid, 'bonus_second_chance'))).toContain('слито')
    await db.rpc(u.uid, 'coinflip_cancel', { p_id: flip.id })
    expect(await db.balance(u.id)).toBe(BONUS.startBalance * 100)
  })
  it('нельзя держать больше трёх открытых батлов', async () => {
    const u = await db.user('Лобби-спамер')
    for (let i = 0; i < 3; i++) await db.rpc(u.uid, 'battle_create', { p_cases: ['meloch'], p_format: '1v1', p_mode: 'classic' })
    expect(await err(db.rpc(u.uid, 'battle_create', { p_cases: ['meloch'], p_format: '1v1', p_mode: 'classic' }))).toContain('Слишком много открытых')
  })
  it('с одной сессии нельзя создать больше трёх профилей, но войти в свой можно', async () => {
    const uid = randomUUID()
    for (let i = 1; i <= 3; i++) expect((await db.rpc(uid, 'login', { p_nick: 'Твинк' + i, p_pin: '123456' })).ok).toBe(true)
    const fourth = await db.rpc(uid, 'login', { p_nick: 'Твинк4', p_pin: '123456' })
    expect(fourth.ok).toBe(false)
    expect(fourth.error).toContain('три профиля')
    expect((await db.rpc(uid, 'login', { p_nick: 'Твинк2', p_pin: '123456' })).ok).toBe(true)
  })
  it('слишком короткий PIN отклоняется', async () => {
    expect((await db.rpc(randomUUID(), 'login', { p_nick: 'Короткий', p_pin: '1234' })).ok).toBe(false)
  })
})
