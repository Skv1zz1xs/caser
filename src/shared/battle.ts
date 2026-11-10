import { BATTLE, BATTLE_FORMATS } from '../config/economy'

export type BattleMode = 'classic' | 'crazy' | 'terminal' | 'shared' | 'jackpot'
export type BattleFormat = '1v1' | '1v1v1' | '2v2' | '1v1v1v1'

const fmt = (f: string) => {
  const x = BATTLE_FORMATS.find((b) => b.id === f)
  if (!x) throw new Error(`Неизвестный формат батла: ${f}`)
  return x
}

export const slotsOf = (format: string): number => fmt(format).slots
export const teamOf = (format: string, slot: number): number => fmt(format).teams[slot]
export const teamsCount = (format: string): number => Math.max(...fmt(format).teams) + 1

/** Полная длительность анимации батла, мс. */
export const battleDurationMs = (rounds: number): number => BATTLE.countdownMs + rounds * BATTLE.roundMs + BATTLE.endMs

export interface BattleResolution {
  /** сумма дропов каждого места */
  sums: number[]
  teamSums: number[]
  /** банк = сумма всех дропов */
  pot: number
  /** команда-победитель, −1 для «шерда» */
  winnerTeam: number
  /** выплата каждому месту, копейки */
  payouts: number[]
}

/**
 * Победитель и выплаты. values[раунд][место] — цены дропов в копейках.
 * tie — 52-битное число из ролла: решает ничьи и выбирает победителя в «джекпоте».
 * Зеркало SQL game.battle_resolve.
 */
export function resolveBattle(p: { mode: BattleMode | string; format: BattleFormat | string; values: number[][]; tie: number }): BattleResolution {
  const slots = slotsOf(p.format)
  const teams = teamsCount(p.format)
  if (!p.values.length) throw new Error('В батле нет раундов')
  if (p.values.some((r) => r.length !== slots)) throw new Error('Число дропов в раунде не совпадает с числом мест')

  const sums = new Array<number>(slots).fill(0)
  for (const r of p.values) r.forEach((v, s) => (sums[s] += v))
  const pot = sums.reduce((a, b) => a + b, 0)
  const teamSums = new Array<number>(teams).fill(0)
  sums.forEach((v, s) => (teamSums[teamOf(p.format, s)] += v))

  if (p.mode === 'shared') {
    const each = Math.floor(pot / slots)
    return { sums, teamSums, pot, winnerTeam: -1, payouts: sums.map(() => each) }
  }

  let winnerTeam: number
  if (p.mode === 'jackpot') {
    const r = p.tie % pot
    let acc = 0
    winnerTeam = teams - 1
    for (let t = 0; t < teams; t++) {
      acc += teamSums[t]
      if (r < acc) {
        winnerTeam = t
        break
      }
    }
  } else {
    let score = teamSums
    if (p.mode === 'terminal') {
      score = new Array<number>(teams).fill(0)
      p.values[p.values.length - 1].forEach((v, s) => (score[teamOf(p.format, s)] += v))
    }
    const best = p.mode === 'crazy' ? Math.min(...score) : Math.max(...score)
    const tied = score.map((v, t) => (v === best ? t : -1)).filter((t) => t >= 0)
    winnerTeam = tied[p.tie % tied.length]
  }

  const members = sums.map((_, s) => s).filter((s) => teamOf(p.format, s) === winnerTeam)
  const each = Math.floor(pot / members.length)
  return { sums, teamSums, pot, winnerTeam, payouts: sums.map((_, s) => (members.includes(s) ? each : 0)) }
}
