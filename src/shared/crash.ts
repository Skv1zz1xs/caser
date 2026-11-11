import { CRASH } from '../config/economy'

const TWO52 = 2n ** 52n

/** Точка падения в промилле (1000 = x1.00) из n0 ролла. Целочисленно, зеркало SQL game.crash_pm. */
export function crashPm(n0: number): number {
  const num = BigInt(100 - CRASH.edgePct) * 10n * TWO52
  const v = Number(num / (TWO52 - BigInt(n0)))
  return Math.min(1_000_000, Math.max(1000, v))
}

/** Множитель (промилле) через ms миллисекунд после старта. */
export const multPm = (ms: number): number => Math.floor(1000 * Math.exp((CRASH.growthPerSec * ms) / 1000))

/** Когда ракета достигнет заданного множителя, мс от старта. */
export const msToMult = (pm: number): number => (Math.log(pm / 1000) / CRASH.growthPerSec) * 1000
