import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { setupDb, type Db } from './helpers'
import { caseOf } from '../../src/shared/catalog'
import { ALBUM, BONUS } from '../../src/config/economy'

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

describe('Альбом скинов', () => {
  it('предмет попадает в альбом при получении и остаётся после продажи', async () => {
    const u = await db.user('Коллекционер1')
    const id = await db.give(u.id, 'sigma', 3)
    const item = caseOf('sigma').outcomes[3].itemId
    expect((await db.rpc(u.uid, 'collection_get')).items).toContain(item)
    await db.rpc(u.uid, 'sell_items', { p_ids: [id] })
    expect((await db.rpc(u.uid, 'collection_get')).items).toContain(item)
  })

  it('награда за кейс — только когда собраны все предметы, и только один раз', async () => {
    const u = await db.user('Коллекционер2')
    const c = caseOf('meloch')
    expect(await err(db.rpc(u.uid, 'collection_claim', { p_case: 'meloch' }))).toContain('Собрано')
    const ids = [...new Set(c.outcomes.map((o) => o.itemId))]
    for (const itemId of ids) await db.admin.query('insert into collection (profile_id, item_id) values ($1, $2) on conflict do nothing', [u.id, itemId])
    const r = await db.rpc(u.uid, 'collection_claim', { p_case: 'meloch' })
    expect(r.reward).toBe(c.price * ALBUM.rewardMult)
    expect(r.me.balance).toBe(BONUS.startBalance * 100 + r.reward)
    expect(await err(db.rpc(u.uid, 'collection_claim', { p_case: 'meloch' }))).toContain('уже получена')
    expect((await db.rpc(u.uid, 'collection_get')).claimed).toContain('meloch')
    expect(await err(db.rpc(u.uid, 'collection_claim', { p_case: 'free' }))).toContain('Нет такого')
  })
})
