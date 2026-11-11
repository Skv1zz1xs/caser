import { UPGRADE } from '../config/economy'
import { mulDiv } from './money'

/** Шансы — в миллионных долях (ppm): 475000 = 47.5 %. */
export const UP_EDGE_PPM = UPGRADE.edgePct * 10_000
export const UP_MIN_PPM = UPGRADE.minPct * 10_000
export const UP_MAX_PPM = UPGRADE.maxPct * 10_000

/** шанс = вложено / цена цели × edge. Зеркало SQL. */
export const upgradeChancePpm = (input: number, target: number): number => (target <= 0 ? 0 : mulDiv(input, UP_EDGE_PPM, target))

export const upgradeAllowed = (ppm: number): boolean => ppm >= UP_MIN_PPM && ppm <= UP_MAX_PPM

/** Диапазон цен целей, для которых шанс попадает в разрешённый коридор. */
export function upgradeTargetRange(input: number): { min: number; max: number } {
  return { min: mulDiv(input, UP_EDGE_PPM, UP_MAX_PPM + 1) + 1, max: mulDiv(input, UP_EDGE_PPM, UP_MIN_PPM) }
}

/** Ролл апгрейда 0..999999 из n0. */
export const upgradeRoll = (n0: number): number => n0 % 1_000_000

export const upgradeWin = (ppm: number, n0: number): boolean => upgradeRoll(n0) < ppm
