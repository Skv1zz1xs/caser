import { describe, it, expect } from 'vitest'
import { resolveBattle, slotsOf, teamOf, battleDurationMs } from '../src/shared/battle'
import { levelFromXp } from '../src/shared/progress'
import { BATTLE, PASS } from '../src/config/economy'

describe('батл: форматы', () => {
  it('число мест и команды', () => {
    expect(slotsOf('1v1')).toBe(2)
    expect(slotsOf('1v1v1')).toBe(3)
    expect(slotsOf('1v1v1v1')).toBe(4)
    expect(slotsOf('2v2')).toBe(4)
    expect([0, 1, 2, 3].map((s) => teamOf('2v2', s))).toEqual([0, 0, 1, 1])
    expect([0, 1, 2, 3].map((s) => teamOf('1v1v1v1', s))).toEqual([0, 1, 2, 3])
  })
  it('длительность анимации = отсчёт + раунды + финал', () => {
    expect(battleDurationMs(3)).toBe(BATTLE.countdownMs + 3 * BATTLE.roundMs + BATTLE.endMs)
  })
})

describe('батл: победитель и выплаты', () => {
  const v = [
    [100, 200],
    [300, 50],
  ]
  it('классика: большая сумма забирает всё', () => {
    const r = resolveBattle({ mode: 'classic', format: '1v1', values: v, tie: 0 })
    expect(r.sums).toEqual([400, 250])
    expect(r.pot).toBe(650)
    expect(r.winnerTeam).toBe(0)
    expect(r.payouts).toEqual([650, 0])
  })
  it('крейзи: побеждает меньшая сумма', () => {
    const r = resolveBattle({ mode: 'crazy', format: '1v1', values: v, tie: 0 })
    expect(r.winnerTeam).toBe(1)
    expect(r.payouts).toEqual([0, 650])
  })
  it('терминал: решает только последний кейс', () => {
    const r = resolveBattle({ mode: 'terminal', format: '1v1', values: [[1000, 10], [5, 6]], tie: 0 })
    expect(r.winnerTeam).toBe(1)
    expect(r.payouts).toEqual([0, 1021])
  })
  it('шерд: банк поровну всем', () => {
    const r = resolveBattle({ mode: 'shared', format: '1v1v1', values: [[100, 200, 300]], tie: 0 })
    expect(r.winnerTeam).toBe(-1)
    expect(r.payouts).toEqual([200, 200, 200])
  })
  it('джекпот: шанс пропорционален сумме', () => {
    const vals = [[100, 300]]
    expect(resolveBattle({ mode: 'jackpot', format: '1v1', values: vals, tie: 0 }).winnerTeam).toBe(0)
    expect(resolveBattle({ mode: 'jackpot', format: '1v1', values: vals, tie: 99 }).winnerTeam).toBe(0)
    expect(resolveBattle({ mode: 'jackpot', format: '1v1', values: vals, tie: 100 }).winnerTeam).toBe(1)
    expect(resolveBattle({ mode: 'jackpot', format: '1v1', values: vals, tie: 399 }).winnerTeam).toBe(1)
    expect(resolveBattle({ mode: 'jackpot', format: '1v1', values: vals, tie: 400 }).winnerTeam).toBe(0)
  })
  it('2v2: суммы команд, банк пополам победителям', () => {
    const r = resolveBattle({ mode: 'classic', format: '2v2', values: [[100, 100, 150, 101]], tie: 0 })
    expect(r.teamSums).toEqual([200, 251])
    expect(r.winnerTeam).toBe(1)
    expect(r.payouts).toEqual([0, 0, 225, 225])
    expect(r.payouts.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(r.pot)
  })
  it('ничья решается tie-роллом среди лидеров', () => {
    const vals = [[100, 100, 50]]
    expect(resolveBattle({ mode: 'classic', format: '1v1v1', values: vals, tie: 0 }).winnerTeam).toBe(0)
    expect(resolveBattle({ mode: 'classic', format: '1v1v1', values: vals, tie: 1 }).winnerTeam).toBe(1)
    expect(resolveBattle({ mode: 'classic', format: '1v1v1', values: vals, tie: 2 }).winnerTeam).toBe(0)
  })
  it('неверные входные данные — ошибка', () => {
    expect(() => resolveBattle({ mode: 'classic', format: '1v1', values: [[1, 2, 3]], tie: 0 })).toThrow()
    expect(() => resolveBattle({ mode: 'classic', format: '1v1', values: [], tie: 0 })).toThrow()
  })
})

describe('батл-пасс: уровень по XP', () => {
  it('считает уровень, прогресс и потолок', () => {
    const { base, step } = PASS.levelXp
    expect(levelFromXp(0)).toEqual({ level: 0, into: 0, need: base })
    expect(levelFromXp(base - 1).level).toBe(0)
    expect(levelFromXp(base)).toEqual({ level: 1, into: 0, need: base + step })
    expect(levelFromXp(base + base + step).level).toBe(2)
    const top = levelFromXp(10_000_000)
    expect(top.level).toBe(PASS.rewards.length)
    expect(top.need).toBe(0)
  })
})
