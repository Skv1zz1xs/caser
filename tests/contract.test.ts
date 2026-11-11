import { describe, it, expect } from 'vitest'
import { contractCheck, contractMult, contractResult, contractBounds } from '../src/shared/contract'
import { CATALOG, itemOf } from '../src/shared/catalog'
import { instancePrice } from '../src/shared/money'
import { CONTRACT } from '../src/config/economy'

const items = (n: number, rarity: number, price: number) => Array.from({ length: n }, () => ({ rarity, price }))

describe('контракт: проверка набора', () => {
  it('принимает 3–10 предметов одной редкости', () => {
    const r = contractCheck(items(3, 2, 5000))
    expect(r).toEqual({ ok: true, rarity: 2, sum: 15000 })
    expect(contractCheck(items(10, 0, 500)).ok).toBe(true)
  })
  it('отклоняет меньше 3 и больше 10', () => {
    expect(contractCheck(items(2, 2, 5000)).ok).toBe(false)
    expect(contractCheck(items(11, 2, 5000)).ok).toBe(false)
  })
  it('отклоняет разные редкости', () => {
    expect(contractCheck([...items(2, 2, 5000), ...items(1, 3, 5000)]).ok).toBe(false)
  })
  it('отклоняет контрабанду — выше неё редкости нет', () => {
    expect(contractCheck(items(3, 7, 5_000_000)).ok).toBe(false)
  })
  it('отклоняет набор, для которого нет предметов следующей редкости по цене', () => {
    const b = contractBounds(7) // контрабанда как цель
    expect(contractCheck(items(3, 6, 1)).ok).toBe(false) // слишком дёшево
    expect(contractCheck(items(10, 6, b.max)).ok).toBe(false) // слишком дорого
  })
})

describe('контракт: множитель', () => {
  it('всегда внутри окна из конфига', () => {
    const lo = Math.round(CONTRACT.buckets[0].from * 1000)
    const hi = Math.round(CONTRACT.buckets[CONTRACT.buckets.length - 1].to * 1000)
    for (let n0 = 0; n0 < 1_000_000; n0 += 9173)
      for (let n1 = 0; n1 < 10_000; n1 += 1237) {
        const m = contractMult(n0, n1)
        expect(m).toBeGreaterThanOrEqual(lo)
        expect(m).toBeLessThanOrEqual(hi)
      }
  })
  it('средний множитель (RTP контракта) в коридоре 0.90–0.95', () => {
    let sum = 0
    let n = 0
    for (let n0 = 0; n0 < 1_000_000; n0 += 997)
      for (let n1 = 0; n1 < 10_000; n1 += 101) {
        sum += contractMult(n0, n1)
        n++
      }
    const mean = sum / n / 1000
    expect(mean).toBeGreaterThan(0.9)
    expect(mean).toBeLessThan(0.95)
  })
})

describe('контракт: результат', () => {
  it('детерминирован', () => {
    const n = { n0: 123456, n1: 777, n2: 99, n3: 0 }
    expect(contractResult(30_000, 1, n)).toEqual(contractResult(30_000, 1, n))
  })
  it('даёт предмет следующей редкости с ценой ≈ сумма × множитель', () => {
    let seed = 12345
    const rnd = () => (seed = (Math.imul(seed, 1103515245) + 12345) >>> 0)
    for (let i = 0; i < 400; i++) {
      const rarity = i % 6
      const sum = 2_000 + (rnd() % 400_000)
      if (!contractCheck([{ rarity, price: sum - 2 }, { rarity, price: 1 }, { rarity, price: 1 }]).ok) continue
      const n = { n0: rnd(), n1: rnd(), n2: rnd(), n3: rnd() }
      const res = contractResult(sum, rarity, n)
      const item = itemOf(res.itemId)
      expect(item.rarity).toBe(rarity + 1)
      const out = CATALOG.caseById.get(res.caseId)!.outcomes[res.outcomeIdx]
      expect(out.itemId).toBe(res.itemId)
      expect(res.price).toBe(instancePrice(out.price, res.fi, false))
      const want = Math.floor((sum * contractMult(n.n0, n.n1)) / 1000)
      const lo = instancePrice(out.price, 9999, false)
      const hi = instancePrice(out.price, 0, false)
      if (want >= lo && want <= hi) expect(Math.abs(res.price - want)).toBeLessThanOrEqual(Math.max(2, want * 0.0002))
      else expect(res.fi === 0 || res.fi === 9999).toBe(true)
    }
  })
})
