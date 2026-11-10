import { PASS } from '../config/economy'

/** XP, нужное для перехода на уровень N (N с 1). */
export const xpForLevel = (n: number): number => PASS.levelXp.base + PASS.levelXp.step * (n - 1)

/** Уровень батл-пасса по накопленному XP. Зеркало SQL game.bp_level. */
export function levelFromXp(xp: number): { level: number; into: number; need: number } {
  const max = PASS.rewards.length
  let level = 0
  let rest = xp
  while (level < max && rest >= xpForLevel(level + 1)) {
    rest -= xpForLevel(level + 1)
    level++
  }
  return level >= max ? { level: max, into: 0, need: 0 } : { level, into: rest, need: xpForLevel(level + 1) }
}
