import { CONTRACT, RARITIES } from '../config/economy'
import { CATALOG, type FlatOutcome } from './catalog'
import { FI_RANGE, WEAR_A, WEAR_B, instancePrice, mulDiv } from './money'
import type { RollNums } from './roll'

export interface ContractInput { rarity: number; price: number }

interface PoolEntry extends FlatOutcome { lo: number; hi: number }

/** Пул результатов по редкости: все исходы «контрактных» кейсов, с границами цены при худшем/лучшем износе. */
const POOL: PoolEntry[][] = RARITIES.map((_, r) =>
  CATALOG.outcomes
    .filter((o) => o.contractable && o.rarity === r)
    .map((o) => ({ ...o, lo: instancePrice(o.price, FI_RANGE - 1, false), hi: instancePrice(o.price, 0, false) })),
)

const BUCKETS = (() => {
  let cum = 0
  return CONTRACT.buckets.map((b) => {
    cum += Math.round(b.pct * 10_000)
    return { cum, from: Math.round(b.from * 1000), to: Math.round(b.to * 1000) }
  })
})()
if (BUCKETS[BUCKETS.length - 1].cum !== 1_000_000) throw new Error('CONTRACT.buckets: шансы должны давать 100 %')

export const CONTRACT_MIN_PM = BUCKETS[0].from
export const CONTRACT_MAX_PM = BUCKETS[BUCKETS.length - 1].to

/** Минимальная и максимальная цена предмета данной редкости в пуле. */
export function contractBounds(rarity: number): { min: number; max: number } {
  const p = POOL[rarity] ?? []
  if (!p.length) return { min: 0, max: 0 }
  return { min: Math.min(...p.map((x) => x.lo)), max: Math.max(...p.map((x) => x.hi)) }
}

export function contractCheck(items: ContractInput[]): { ok: true; rarity: number; sum: number } | { ok: false; error: string } {
  if (items.length < CONTRACT.minItems) return { ok: false, error: `Нужно минимум ${CONTRACT.minItems} предмета` }
  if (items.length > CONTRACT.maxItems) return { ok: false, error: `Максимум ${CONTRACT.maxItems} предметов` }
  const rarity = items[0].rarity
  if (items.some((i) => i.rarity !== rarity)) return { ok: false, error: 'Все предметы должны быть одной редкости' }
  if (rarity >= RARITIES.length - 1) return { ok: false, error: 'Выше контрабанды редкости нет' }
  const sum = items.reduce((a, i) => a + i.price, 0)
  const b = contractBounds(rarity + 1)
  if (mulDiv(sum, CONTRACT_MIN_PM, 1000) < b.min) return { ok: false, error: 'Набор слишком дешёвый для следующей редкости' }
  if (mulDiv(sum, CONTRACT_MAX_PM, 1000) > b.max) return { ok: false, error: 'Набор слишком дорогой для следующей редкости' }
  return { ok: true, rarity, sum }
}

/** Множитель контракта в промилле (от суммы вложенного). Зеркало SQL game.contract_mult. */
export function contractMult(n0: number, n1: number): number {
  const t = n0 % 1_000_000
  const b = BUCKETS.find((x) => t < x.cum)!
  return b.from + Math.floor(((b.to - b.from) * (n1 % FI_RANGE)) / FI_RANGE)
}

export interface ContractResult { caseId: string; outcomeIdx: number; itemId: string; phase: number; fi: number; price: number; value: number; mult: number }

/** Результат контракта: предмет следующей редкости ценой ≈ сумма × множитель. Зеркало SQL game.contract_pick. */
export function contractResult(sum: number, rarity: number, n: RollNums): ContractResult {
  const mult = contractMult(n.n0, n.n1)
  const value = mulDiv(sum, mult, 1000)
  const pool = POOL[rarity + 1]
  const fits = pool.filter((o) => o.lo <= value && value <= o.hi)
  let pick: PoolEntry
  let fi: number
  if (fits.length) {
    pick = fits[n.n2 % fits.length]
    const num = BigInt(WEAR_A) * BigInt(pick.price) - BigInt(value) * 100_000n
    const q = Number(num / (BigInt(WEAR_B) * BigInt(pick.price)))
    fi = Math.max(0, Math.min(FI_RANGE - 1, q))
  } else {
    // подходящих по цене нет — берём ближайший по цене предмет и крайний износ
    const dist = (o: PoolEntry) => (value < o.lo ? o.lo - value : value - o.hi)
    pick = pool.reduce((best, o) => (dist(o) < dist(best) ? o : best), pool[0])
    fi = value < pick.lo ? FI_RANGE - 1 : 0
  }
  return {
    caseId: pick.caseId, outcomeIdx: pick.idx, itemId: pick.itemId, phase: pick.phase, fi,
    price: instancePrice(pick.price, fi, false), value, mult,
  }
}
