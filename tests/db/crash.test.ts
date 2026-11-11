import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { setupDb, type Db } from './helpers'
import { crashPm, multPm } from '../../src/shared/crash'
import { hmacHexSync, sha256HexSync, splitRoll } from '../../src/shared/fair'
import { BONUS, CRASH } from '../../src/config/economy'

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
const start = BONUS.startBalance * 100
/** Перематывает последний раунд в нужную фазу (время в тестах двигаем руками). */
const setRound = (sql: string) => db.admin.query(`update crash_rounds set ${sql} where id = (select max(id) from crash_rounds)`)
const lastRound = async () => (await db.admin.query('select * from crash_rounds order by id desc limit 1')).rows[0]

describe('Краш', () => {
  it('формула точки падения клиента и сервера совпадает, возврат ≈ 96 %', async () => {
    for (const n0 of [0, 1, 123456789, 2 ** 51, 2 ** 52 - 1, 4503599627370495, 3000000000000000]) {
      const hex = hmacHexSync('s', 'x' + n0)
      const n = splitRoll(hex)
      const sql = (await db.admin.query('select game.crash_pm($1) v', [hex])).rows[0].v
      expect(sql).toBe(crashPm(n.n0))
    }
    // шанс дожить до x2 ≈ 48 %, до x10 ≈ 9.6 %
    let ge2 = 0
    let ge10 = 0
    const N = 20000
    for (let i = 0; i < N; i++) {
      const pm = crashPm(Math.floor(((i + 0.5) / N) * 2 ** 52))
      if (pm >= 2000) ge2++
      if (pm >= 10000) ge10++
    }
    expect(ge2 / N).toBeCloseTo(0.48, 1)
    expect(ge10 / N).toBeCloseTo(0.096, 2)
    expect(multPm(10_000)).toBe(Math.floor(1000 * Math.exp(CRASH.growthPerSec * 10)))
  })

  it('раунд создаётся, точка падения не раскрывается до конца, хеш виден заранее', async () => {
    const u = await db.user('Крашер1')
    const s = await db.rpc(u.uid, 'crash_state')
    expect(s.round.status).toBe('bet')
    expect(s.round.seed_hash).toMatch(/^[0-9a-f]{64}$/)
    expect(s.round.crash_pm).toBeNull()
    expect(s.round.seed).toBeNull()
    expect(JSON.stringify(s)).not.toContain('"crash_pm":1')
  })

  it('ставка списывает монеты; вторая ставка, малая сумма и закрытый приём отклоняются', async () => {
    const u = await db.user('Крашер2')
    await db.rpc(u.uid, 'crash_state')
    const r = await db.rpc(u.uid, 'crash_bet', { p_amount: 5000 })
    expect(r.me.balance).toBe(start - 5000)
    expect(await err(db.rpc(u.uid, 'crash_bet', { p_amount: 5000 }))).toContain('уже поставил')
    const v = await db.user('Крашер3')
    expect(await err(db.rpc(v.uid, 'crash_bet', { p_amount: 1 }))).toContain('Ставка от')
    expect(await err(db.rpc(v.uid, 'crash_bet', { p_amount: 1_000_000_000 }))).toContain('Ставка от')
    expect(await err(db.rpc(v.uid, 'crash_bet', { p_amount: 5000, p_auto: 1005 }))).toContain('Автовывод')
    await setRound("bet_ends_at = now() - interval '1 second'")
    expect(await err(db.rpc(v.uid, 'crash_bet', { p_amount: 5000 }))).toBeTruthy()
  })

  it('забор выигрыша в полёте выплачивает по текущему множителю, повторно нельзя', async () => {
    const u = await db.user('Крашер4')
    await db.rpc(u.uid, 'crash_state')
    // дожидаемся нового раунда: прошлый переводим в «done» и пропускаем паузу
    await setRound("status = 'done', crashed_at = now() - interval '1 minute', started_at = now() - interval '2 minutes'")
    const s0 = await db.rpc(u.uid, 'crash_state')
    expect(s0.round.status).toBe('bet')
    await db.rpc(u.uid, 'crash_bet', { p_amount: 10000 })
    expect(await err(db.rpc(u.uid, 'crash_cashout'))).toContain('ещё не начался')
    await setRound("bet_ends_at = now() - interval '5 seconds', crash_pm = 50000")
    await db.rpc(u.uid, 'crash_state') // тик: bet → run, started_at = bet_ends_at (5 с назад), падение через ~56 с
    const round = await lastRound()
    expect(round.status).toBe('run')
    const c = await db.rpc(u.uid, 'crash_cashout')
    const expectedLow = multPm(4900)
    const expectedHigh = multPm(6500)
    expect(c.mult).toBeGreaterThanOrEqual(expectedLow)
    expect(c.mult).toBeLessThanOrEqual(expectedHigh)
    expect(c.payout).toBe(Math.floor((10000 * c.mult) / 1000))
    expect(c.me.balance).toBe(start - 10000 + c.payout)
    expect(await err(db.rpc(u.uid, 'crash_cashout'))).toContain('уже забрал')
  })

  it('после падения забрать нельзя, раунд раскрывает сид и точку; автовывод срабатывает и не срабатывает', async () => {
    const a = await db.user('КрашерА')
    const b = await db.user('КрашерБ')
    await setRound("status = 'done', crashed_at = now() - interval '1 minute', started_at = now() - interval '2 minutes'")
    await db.rpc(a.uid, 'crash_state')
    await db.rpc(a.uid, 'crash_bet', { p_amount: 10000, p_auto: 1500 })
    await db.rpc(b.uid, 'crash_bet', { p_amount: 10000, p_auto: 3000 })
    await setRound("bet_ends_at = now() - interval '1 second', crash_pm = 2000")
    expect((await db.rpc(a.uid, 'crash_state')).round.status).toBe('run')
    await setRound("crashed_at = now() - interval '1 second'")
    const s = await db.rpc(b.uid, 'crash_state') // тик: падение, автовывод, раскрытие сида
    expect(await err(db.rpc(a.uid, 'crash_cashout'))).toContain('уже забрал') // автовывод уже выплатил А
    expect(s.round.status).toBe('done')
    expect(s.round.crash_pm).toBe(2000)
    expect(sha256HexSync(s.round.seed)).toBe(s.round.seed_hash)
    expect(await db.balance(a.id)).toBe(start - 10000 + 15000) // x1.5 ≤ x2.0
    expect(await db.balance(b.id)).toBe(start - 10000) // x3.0 > x2.0, проиграл
    expect(await err(db.rpc(b.uid, 'crash_cashout'))).toContain('Поздно')
    expect(s.history[0]).toBe(2000)
  })

  it('точка падения раунда действительно выводится из раскрытого сида (проверка честности)', async () => {
    const u = await db.user('Проверяльщик')
    await setRound("status = 'done', crashed_at = now() - interval '1 minute', started_at = now() - interval '2 minutes'")
    await db.rpc(u.uid, 'crash_state') // новый раунд
    const r = await lastRound()
    await setRound("status = 'run', started_at = now() - interval '10 seconds', crashed_at = now() - interval '1 second'")
    const s = await db.rpc(u.uid, 'crash_state') // тик сам переводит раунд в «done» и раскрывает сид
    expect(s.round.status).toBe('done')
    expect(s.round.crash_pm).toBe(r.crash_pm)
    const hex = hmacHexSync(s.round.seed, 'crash:' + r.id)
    expect(crashPm(splitRoll(hex).n0)).toBe(r.crash_pm)
  })
})
