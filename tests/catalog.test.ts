import { describe, it, expect } from 'vitest'
import { CATALOG, TICKETS, expectedValue, rarityChances } from '../src/shared/catalog'
import { CASE_ECON, RARITIES, PHASES } from '../src/config/economy'
import { CASE_CONTENT } from '../src/config/cases'

describe('каталог кейсов', () => {
  it('содержит минимум 40 кейсов и все нужные категории', () => {
    const playable = CATALOG.cases.filter((c) => c.category !== 'free')
    expect(playable.length).toBeGreaterThanOrEqual(40)
    for (const cat of ['cheap', 'theme', 'knife', 'risk', 'elite'])
      expect(playable.some((c) => c.category === cat), cat).toBe(true)
    expect(playable.some((c) => c.price >= 1_000_000 * 100)).toBe(true)
    expect(playable.some((c) => c.price <= 100)).toBe(true)
  })

  it('у каждого кейса из экономики есть контент и наоборот', () => {
    const econ = CASE_ECON.map((e) => e.id).sort()
    const content = CASE_CONTENT.map((c) => c.id).sort()
    expect(content).toEqual(econ)
  })

  it('веса исходов каждого кейса в сумме дают ровно TICKETS', () => {
    for (const c of CATALOG.cases) {
      const sum = c.outcomes.reduce((s, o) => s + o.weight, 0)
      expect(sum, c.id).toBe(TICKETS)
      expect(c.outcomes[c.outcomes.length - 1].cum, c.id).toBe(TICKETS)
      let prev = 0
      for (const o of c.outcomes) {
        expect(o.weight, `${c.id}#${o.idx}`).toBeGreaterThan(0)
        expect(o.cum).toBe(prev + o.weight)
        expect(o.price).toBeGreaterThanOrEqual(1)
        prev = o.cum
      }
    }
  })

  it('id предметов уникальны, названия внутри кейса не повторяются', () => {
    const ids = new Set<string>()
    for (const c of CATALOG.cases) {
      const names = new Set<string>()
      for (const it of c.items) {
        expect(ids.has(it.id), it.id).toBe(false)
        ids.add(it.id)
        expect(names.has(it.name), `${c.id}: ${it.name}`).toBe(false)
        names.add(it.name)
      }
    }
  })

  it('шансы редкостей стандартного кейса совпадают с таблицей из ТЗ', () => {
    const c = CATALOG.cases.find((x) => x.profile === 'standard')!
    const ch = rarityChances(c)
    const want = [60, 22, 10.5, 4.8, 1.85, 0.58, 0.22, 0.05]
    want.forEach((w, i) => expect(ch[i], RARITIES[i].name).toBeCloseTo(w, 5))
  })

  it('точное матожидание каждого кейса попадает в целевой RTP (±0.2 п.п.)', () => {
    for (const c of CATALOG.cases) {
      if (c.category === 'free') continue
      const rtp = expectedValue(c) / c.price
      expect(Math.abs(rtp - c.rtp), `${c.id}: ${rtp.toFixed(4)} vs ${c.rtp}`).toBeLessThan(0.002)
    }
  })

  it('целевой RTP всех платных кейсов в коридоре 90–95 %', () => {
    for (const c of CATALOG.cases) {
      if (c.category === 'free') continue
      expect(c.rtp, c.id).toBeGreaterThanOrEqual(0.9)
      expect(c.rtp, c.id).toBeLessThanOrEqual(0.95)
    }
  })

  it('фазы есть только у ножей и перчаток и делят шанс 85/12/2.7/0.3', () => {
    const c = CATALOG.cases.find((x) => x.profile === 'standard')!
    for (const o of c.outcomes) {
      const item = CATALOG.itemById.get(o.itemId)!
      if (item.kind === 'gun') expect(o.phase).toBe(0)
    }
    const knife = c.items.find((i) => i.kind === 'knife')!
    const outs = c.outcomes.filter((o) => o.itemId === knife.id)
    expect(outs.length).toBe(PHASES.length)
    const total = outs.reduce((s, o) => s + o.weight, 0)
    PHASES.forEach((p, i) => expect((outs[i].weight / total) * 100).toBeCloseTo(p.pct, 2))
    // цена фазы = база × множитель фазы
    expect(outs[2].price / outs[0].price).toBeCloseTo(PHASES[2].mult, 1)
  })

  it('версия каталога — стабильная непустая строка', () => {
    expect(CATALOG.version).toMatch(/^[0-9a-f]{8,}$/)
  })
})
