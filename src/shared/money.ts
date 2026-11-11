import { COIN, COUNTER, WEAR, WEAR_PRICE } from '../config/economy'

/** Всего билетов в одном ролле. */
export const TICKETS = 1_000_000_000
/** Износ хранится целым fi = 0..9999 (float = fi / 10000). */
export const FI_RANGE = 10_000
/** Цена = база × (WEAR_A − WEAR_B × fi) / 100000. При ±20 %: A = 120000, B = 4. */
export const WEAR_A = WEAR_PRICE.topPct * 1000
export const WEAR_B = (WEAR_PRICE.topPct - WEAR_PRICE.bottomPct) / 10
/** Счётчик: выпадает при n2 mod 10000 < ST_LIMIT, цена × ST_MULT_PM / 1000. */
export const ST_LIMIT = Math.round(COUNTER.chancePct * 100)
export const ST_MULT_PM = Math.round(COUNTER.mult * 1000)

if (!Number.isInteger(WEAR_B) || WEAR_B <= 0) throw new Error('WEAR_PRICE: разница topPct − bottomPct должна делиться на 10')

const SAFE = Number.MAX_SAFE_INTEGER

/** floor(a × b / d) без потери точности. */
export function mulDiv(a: number, b: number, d: number): number {
  const p = a * b
  if (p <= SAFE) return (p - (p % d)) / d
  return Number((BigInt(a) * BigInt(b)) / BigInt(d))
}

/** Цена экземпляра: база (копейки) → с учётом износа и счётчика. Зеркало SQL game.instance_price. */
export function instancePrice(base: number, fi: number, st: boolean): number {
  const p = mulDiv(base, WEAR_A - WEAR_B * fi, 100_000)
  return st ? mulDiv(p, ST_MULT_PM, 1000) : p
}

/** Категория износа по fi. */
export function wearIndex(fi: number): number {
  for (let i = 0; i < WEAR.length; i++) if (fi < Math.round(WEAR[i].max * FI_RANGE)) return i
  return WEAR.length - 1
}

const nf0 = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 })
const nf2 = new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** Копейки → строка в монетах: «0,08», «12,50», «1 234», «2 500 000». */
export function fmt(kopecks: number): string {
  const v = kopecks / COIN
  const abs = Math.abs(v)
  if (abs < 1000 && !Number.isInteger(v)) return nf2.format(v)
  return nf0.format(Math.floor(v + 1e-9))
}

/** Компактно: «950», «12,3K», «1,25M». */
export function fmtShort(kopecks: number): string {
  const v = kopecks / COIN
  const abs = Math.abs(v)
  const cut = (x: number, d: number) => (Math.floor(x * 10 ** d + 1e-9) / 10 ** d).toLocaleString('ru-RU', { maximumFractionDigits: d })
  if (abs >= 1e9) return cut(v / 1e9, 2) + 'B'
  if (abs >= 1e6) return cut(v / 1e6, 2) + 'M'
  if (abs >= 1e4) return cut(v / 1e3, 1) + 'K'
  return fmt(kopecks)
}

/** Множитель «икс» дропа относительно цены кейса: «x12.5». */
export function fmtX(value: number, casePrice: number): string {
  if (casePrice <= 0) return ''
  const x = value / casePrice
  return 'x' + (x >= 100 ? Math.floor(x).toString() : x >= 10 ? x.toFixed(1) : x.toFixed(2))
}
