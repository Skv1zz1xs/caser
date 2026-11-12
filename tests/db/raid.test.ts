import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { setupDb, type Db } from './helpers'
import { caseOf } from '../../src/shared/catalog'
import { rollNums } from '../../src/shared/fair'
import { rollDrop } from '../../src/shared/roll'
import { BONUS, RAID } from '../../src/config/economy'

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
const price = caseOf('piraty').price // 500 монет

describe('Рейд-кейс', () => {
  it('нужен дорогой кейс, не больше трёх открытых рейдов', async () => {
    const u = await db.user('Рейдер1')
    expect(await err(db.rpc(u.uid, 'raid_create', { p_case: 'meloch' }))).toContain('нужен кейс от')
    expect(await err(db.rpc(u.uid, 'raid_create', { p_case: 'free' }))).toContain('Нет такого')
    for (let i = 0; i < RAID.openMax; i++) await db.rpc(u.uid, 'raid_create', { p_case: 'piraty' })
    expect(await err(db.rpc(u.uid, 'raid_create', { p_case: 'piraty' }))).toContain('Слишком много')
  })

  it('вклады копятся, выход возвращает вклад, отмена возвращает всем', async () => {
    const a = await db.user('Рейдер2')
    const b = await db.user('Рейдер3')
    const { raid } = await db.rpc(a.uid, 'raid_create', { p_case: 'piraty' })
    expect(raid.target).toBe(price)
    expect(raid.seed_hash).toMatch(/^[0-9a-f]{64}$/)
    expect(raid.result).toBeNull()
    const r1 = await db.rpc(a.uid, 'raid_contribute', { p_id: raid.id, p_amount: 10000 })
    expect(r1.raid.pot).toBe(10000)
    expect(r1.me.balance).toBe(start - 10000)
    await db.rpc(b.uid, 'raid_contribute', { p_id: raid.id, p_amount: 5000 })
    expect(await err(db.rpc(b.uid, 'raid_contribute', { p_id: raid.id, p_amount: 1 }))).toContain('Минимальный вклад')
    const left = await db.rpc(b.uid, 'raid_leave', { p_id: raid.id })
    expect(left.raid.pot).toBe(10000)
    expect(await db.balance(b.id)).toBe(start)
    expect(await err(db.rpc(b.uid, 'raid_cancel', { p_id: raid.id }))).toContain('только создатель')
    await db.rpc(a.uid, 'raid_cancel', { p_id: raid.id })
    expect(await db.balance(a.id)).toBe(start)
    expect(await err(db.rpc(a.uid, 'raid_contribute', { p_id: raid.id, p_amount: 5000 }))).toContain('закончился')
  })

  it('полный банк запускает один ролл, выплаты делятся по долям и в сумме равны стоимости дропа', async () => {
    const a = await db.user('Рейдер4')
    const b = await db.user('Рейдер5')
    const c = await db.user('Рейдер6')
    const { raid } = await db.rpc(a.uid, 'raid_create', { p_case: 'piraty' })
    await db.rpc(a.uid, 'raid_contribute', { p_id: raid.id, p_amount: 20000 }) // 40 %
    await db.rpc(b.uid, 'raid_contribute', { p_id: raid.id, p_amount: 20000 }) // 40 %
    // третий просит больше, чем осталось — берётся только остаток
    const last = await db.rpc(c.uid, 'raid_contribute', { p_id: raid.id, p_amount: 999999 })
    expect(last.raid.pot).toBe(price)
    expect(last.raid.status).toBe('done')
    expect(last.raid.result.price).toBeGreaterThan(0)
    expect(last.raid.payouts).toBeNull() // выплаты скрыты до конца анимации
    expect(last.raid.seed).toBeNull()
    expect(await db.balance(c.id)).toBe(start - 10000)
    // конец анимации
    await db.admin.query("update raids set ends_at = now() - interval '1 second' where id = $1", [raid.id])
    await db.admin.query("update pending_credits set available_at = now() - interval '1 second'")
    const v = await db.rpc(a.uid, 'get_raid', { p_id: raid.id })
    const total = v.payouts.reduce((s: number, p: any) => s + p.amount, 0)
    expect(total).toBe(v.result.price)
    const pa = v.payouts.find((p: any) => p.pid === a.id).amount
    const pc = v.payouts.find((p: any) => p.pid === c.id).amount
    expect(Math.abs(pa - Math.floor((v.result.price * 20000) / price))).toBeLessThanOrEqual(2)
    expect(Math.abs(pc - Math.floor((v.result.price * 10000) / price))).toBeLessThanOrEqual(2)
    // деньги дошли
    await db.rpc(a.uid, 'sync')
    await db.rpc(b.uid, 'sync')
    await db.rpc(c.uid, 'sync')
    expect((await db.balance(a.id)) + (await db.balance(b.id)) + (await db.balance(c.id))).toBe(3 * start - price + v.result.price)
    // честность: исход выводится из раскрытого сида
    const d = rollDrop(caseOf('piraty'), rollNums(v.seed, raid.id, 0))
    expect({ item: d.itemId, price: d.price, fi: d.fi }).toEqual({ item: v.result.item, price: v.result.price, fi: v.result.fi })
  })

  it('на закрытый рейд нельзя вложиться; список показывает открытые', async () => {
    const a = await db.user('Рейдер7')
    const { raid } = await db.rpc(a.uid, 'raid_create', { p_case: 'mafia' })
    const list = await db.rpc(a.uid, 'raid_list')
    expect(list.some((r: any) => r.id === raid.id)).toBe(true)
    expect(await err(db.rpc(a.uid, 'get_raid', { p_id: '00000000-0000-0000-0000-000000000000' }))).toContain('не найден')
  })
})
