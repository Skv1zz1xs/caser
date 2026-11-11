import { describe, it, expect } from 'vitest'
import { upgradeChancePpm, upgradeAllowed, upgradeWin, upgradeTargetRange } from '../src/shared/upgrade'

describe('апгрейдер', () => {
  it('шанс = вложено / цена цели × 0.95', () => {
    expect(upgradeChancePpm(10_000, 20_000)).toBe(475_000)
    expect(upgradeChancePpm(10_000, 100_000)).toBe(95_000)
    expect(upgradeChancePpm(333, 1000)).toBe(316_350)
  })

  it('допустим только коридор 1–75 %', () => {
    expect(upgradeAllowed(9_999)).toBe(false)
    expect(upgradeAllowed(10_000)).toBe(true)
    expect(upgradeAllowed(750_000)).toBe(true)
    expect(upgradeAllowed(750_001)).toBe(false)
  })

  it('диапазон цен целей соответствует коридору шансов', () => {
    const { min, max } = upgradeTargetRange(10_000)
    expect(upgradeAllowed(upgradeChancePpm(10_000, min))).toBe(true)
    expect(upgradeAllowed(upgradeChancePpm(10_000, min - 1))).toBe(false)
    expect(upgradeAllowed(upgradeChancePpm(10_000, max))).toBe(true)
    expect(upgradeAllowed(upgradeChancePpm(10_000, max + 1))).toBe(false)
  })

  it('победа, когда ролл (n0 mod 1e6) строго меньше шанса', () => {
    expect(upgradeWin(475_000, 474_999)).toBe(true)
    expect(upgradeWin(475_000, 475_000)).toBe(false)
    expect(upgradeWin(475_000, 3_000_000 + 474_999)).toBe(true)
  })

  it('матожидание апгрейда = 0.95 от вложенного', () => {
    const input = 12_345
    const target = 61_725
    const ppm = upgradeChancePpm(input, target)
    let wins = 0
    for (let r = 0; r < 1_000_000; r++) if (upgradeWin(ppm, r)) wins++
    const ev = (wins / 1_000_000) * target
    expect(ev / input).toBeGreaterThan(0.949)
    expect(ev / input).toBeLessThanOrEqual(0.95)
  })
})
