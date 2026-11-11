import { describe, it, expect } from 'vitest'
import { CATALOG, TICKETS } from '../src/shared/catalog'
import { pickOutcome, instancePrice, rollDrop, wearIndex } from '../src/shared/roll'
import { COUNTER, WEAR } from '../src/config/economy'

const std = CATALOG.cases.find((c) => c.profile === 'standard')!

describe('рулетка: билет → исход', () => {
  it('границы диапазонов: cum−1 ещё предыдущий исход, cum — уже следующий', () => {
    const [a, b] = std.outcomes
    expect(pickOutcome(std, 0).idx).toBe(a.idx)
    expect(pickOutcome(std, a.cum - 1).idx).toBe(a.idx)
    expect(pickOutcome(std, a.cum).idx).toBe(b.idx)
    expect(pickOutcome(std, TICKETS - 1).idx).toBe(std.outcomes[std.outcomes.length - 1].idx)
  })

  it('билет вне диапазона — ошибка', () => {
    expect(() => pickOutcome(std, TICKETS)).toThrow()
    expect(() => pickOutcome(std, -1)).toThrow()
  })

  it('частоты исходов по всем билетам с шагом совпадают с весами', () => {
    const counts = new Map<number, number>()
    const step = 9973
    let n = 0
    for (let t = 0; t < TICKETS; t += step) {
      const o = pickOutcome(std, t)
      counts.set(o.idx, (counts.get(o.idx) ?? 0) + 1)
      n++
    }
    for (const o of std.outcomes) {
      const got = (counts.get(o.idx) ?? 0) / n
      expect(Math.abs(got - o.weight / TICKETS)).toBeLessThan(2e-5)
    }
  })
})

describe('цена экземпляра', () => {
  it('износ линейно меняет цену от +20 % до −20 %', () => {
    expect(instancePrice(1000, 0, false)).toBe(1200)
    expect(instancePrice(1000, 5000, false)).toBe(1000)
    expect(instancePrice(1000, 9999, false)).toBe(800)
    expect(instancePrice(100000, 2500, false)).toBe(110000)
  })

  it('счётчик умножает цену на 1.5', () => {
    expect(instancePrice(1000, 5000, true)).toBe(1500)
    expect(instancePrice(1001, 5000, true)).toBe(1501)
  })

  it('точна на огромных суммах (за пределами 2^53 в промежуточных вычислениях)', () => {
    expect(instancePrice(300_000_000_000, 0, false)).toBe(360_000_000_000)
    expect(instancePrice(300_000_000_001, 9999, false)).toBe(240_012_000_000)
  })

  it('категории износа идут по порогам', () => {
    expect(wearIndex(0)).toBe(0)
    expect(wearIndex(Math.round(WEAR[0].max * 10000) - 1)).toBe(0)
    expect(wearIndex(Math.round(WEAR[0].max * 10000))).toBe(1)
    expect(wearIndex(9999)).toBe(WEAR.length - 1)
  })
})

describe('rollDrop', () => {
  it('детерминирован и собирает предмет из чисел ролла', () => {
    const n = { n0: 123456789012, n1: 5000, n2: 999999, n3: 7 }
    const d = rollDrop(std, n)
    expect(d).toEqual(rollDrop(std, n))
    const o = pickOutcome(std, n.n0 % TICKETS)
    expect(d.outcomeIdx).toBe(o.idx)
    expect(d.fi).toBe(5000)
    expect(d.price).toBe(instancePrice(o.price, d.fi, d.st))
  })

  it('счётчик выпадает при n2 mod 10000 < порога и только у оружия', () => {
    const limit = COUNTER.chancePct * 100
    const gunTicket = 0 // первый исход — ширпотреб-оружие
    expect(rollDrop(std, { n0: gunTicket, n1: 1, n2: limit - 1, n3: 0 }).st).toBe(true)
    expect(rollDrop(std, { n0: gunTicket, n1: 1, n2: limit, n3: 0 }).st).toBe(false)
    const knifeOutcome = std.outcomes.find((o) => CATALOG.itemById.get(o.itemId)!.kind === 'knife')!
    expect(rollDrop(std, { n0: knifeOutcome.cum - 1, n1: 1, n2: 0, n3: 0 }).st).toBe(false)
  })
})
