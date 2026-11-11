/**
 * Собирает SQL с конфигом игры (таблицы cfg_*) из src/config/economy.ts и каталога.
 * Используется: npm run gen:sql (пишет supabase/seed.sql), dev-стек и тесты БД.
 */
import {
  ACHIEVEMENTS, BATTLE, BATTLE_FORMATS, BATTLE_MODES, BONUS, COIN, COINFLIP, CONTRACT, CRASH, LIMITS, PASS, PROMO_CODES, QUESTS, UPGRADE, WEAR,
} from '../../src/config/economy'
import { CATALOG } from '../../src/shared/catalog'
import { FI_RANGE, ST_LIMIT, ST_MULT_PM, WEAR_A, WEAR_B, instancePrice } from '../../src/shared/money'
import { RECIPES } from './recipes.secret'

const q = (s: string) => `'${s.replace(/'/g, "''")}'`
const j = (v: unknown) => `${q(JSON.stringify(v))}::jsonb`
const kop = (coins: number) => Math.round(coins * COIN)
/** метрики, которые хранятся в копейках */
const MONEY_METRICS = new Set(['spent', 'peak', 'earned', 'best_drop', 'sold_value', 'battle_winnings'])
const goal = (metric: string, g: number) => (MONEY_METRICS.has(metric) ? kop(g) : g)

export function buildConfig(): Record<string, unknown> {
  let cum = 0
  const buckets = CONTRACT.buckets.map((b) => {
    cum += Math.round(b.pct * 10_000)
    return { cum, from: Math.round(b.from * 1000), to: Math.round(b.to * 1000) }
  })
  return {
    version: CATALOG.version,
    wear_max: WEAR.map((w) => Math.round(w.max * FI_RANGE)),
    num: {
      wear_a: WEAR_A, wear_b: WEAR_B, fi_range: FI_RANGE, st_limit: ST_LIMIT, st_pm: ST_MULT_PM,
      up_edge: UPGRADE.edgePct * 10_000, up_min: UPGRADE.minPct * 10_000, up_max: UPGRADE.maxPct * 10_000, up_max_items: UPGRADE.maxItems,
      open_max: LIMITS.openMax, inv_limit: LIMITS.inventory, chat_len: LIMITS.chatLen, nick_min: LIMITS.nickMin, nick_max: LIMITS.nickMax,
      pin_min: LIMITS.pinMin, avatars: LIMITS.avatars, tz_hours: BONUS.dayOffsetHours,
    },
    contract: { min: CONTRACT.minItems, max: CONTRACT.maxItems, buckets, min_pm: buckets[0].from, max_pm: buckets[buckets.length - 1].to },
    battle: {
      max_rounds: BATTLE.maxRounds, countdown_ms: BATTLE.countdownMs, round_ms: BATTLE.roundMs, end_ms: BATTLE.endMs, bots: BATTLE.botNames,
      formats: Object.fromEntries(BATTLE_FORMATS.map((f) => [f.id, f.teams])), modes: BATTLE_MODES.map((m) => m.id),
    },
    crash: { min: kop(CRASH.minBet), max: kop(CRASH.maxBet), edge: CRASH.edgePct, growth: CRASH.growthPerSec, bet_ms: CRASH.betMs, pause_ms: CRASH.pauseMs, max_auto: Math.round(CRASH.maxAuto * 1000) },
    coinflip: { min: kop(COINFLIP.minStake), max: kop(COINFLIP.maxStake), rake_pct: COINFLIP.rakePct, flip_ms: COINFLIP.flipMs },
    bonus: {
      start: kop(BONUS.startBalance), free_cd_min: BONUS.freeCase.cooldownMin,
      daily_cd_h: BONUS.daily.cooldownHours, daily_reset_h: BONUS.daily.resetHours, daily: BONUS.daily.rewards.map(kop),
      second: { amount: kop(BONUS.secondChance.amount), cd_min: BONUS.secondChance.cooldownMin, max_net: kop(BONUS.secondChance.maxNetWorth) },
      rain: { every_min: BONUS.rain.everyMin, duration_sec: BONUS.rain.durationSec, pot: kop(BONUS.rain.pot), max_share: kop(BONUS.rain.maxShare) },
    },
    pass: {
      season: PASS.seasonId, xp: PASS.xp, base: PASS.levelXp.base, step: PASS.levelXp.step,
      rewards: PASS.rewards.map((r) => ({ coins: kop(r.coins ?? 0), case: r.case?.[0] ?? null, n: r.case?.[1] ?? 0 })),
    },
    quests: Object.fromEntries(QUESTS.map((x) => [x.id, { period: x.period, metric: x.metric, goal: goal(x.metric, x.goal), coins: kop(x.coins), xp: x.xp }])),
    achievements: Object.fromEntries(ACHIEVEMENTS.map((x) => [x.id, { metric: x.metric, goal: goal(x.metric, x.goal), coins: kop(x.coins) }])),
    promo: Object.fromEntries(PROMO_CODES.map((p) => [p.code.trim().toUpperCase(), { coins: kop(p.coins ?? 0), case: p.case?.[0] ?? null, n: p.case?.[1] ?? 0 }])),
  }
}

export function buildSeedSql(): string {
  const out: string[] = []
  out.push('-- СГЕНЕРИРОВАНО: npm run gen:sql. Не редактируй руками — меняй src/config/economy.ts и перегенерируй.')
  out.push(`-- Версия конфига: ${CATALOG.version}`)
  out.push('begin;')
  out.push('delete from public.cfg_outcomes; delete from public.cfg_cases; delete from public.cfg_kv;')

  for (const [k, v] of Object.entries(buildConfig())) out.push(`insert into public.cfg_kv(key, value) values (${q(k)}, ${j(v)});`)
  // спойлеры спрятаны от случайного взгляда
  const b64 = Buffer.from(JSON.stringify(RECIPES), 'utf8').toString('base64')
  out.push(`insert into public.cfg_kv(key, value) values ('recipes', convert_from(decode(${q(b64)}, 'base64'), 'UTF8')::jsonb);`)

  out.push('insert into public.cfg_cases(case_id, ord, price, profile, contractable, name) values')
  out.push(CATALOG.cases.map((c) => `  (${q(c.id)}, ${c.ord}, ${c.price}, ${q(c.profile)}, ${c.contractable}, ${q(c.name)})`).join(',\n') + ';')

  out.push('insert into public.cfg_outcomes(case_id, case_ord, idx, item_id, weapon, kind, phase, rarity, st_ok, cum, price, lo, hi, contractable) values')
  const rows: string[] = []
  for (const c of CATALOG.cases)
    for (const o of c.outcomes) {
      const it = CATALOG.itemById.get(o.itemId)!
      rows.push(
        `  (${q(c.id)}, ${c.ord}, ${o.idx}, ${q(o.itemId)}, ${q(it.weaponId)}, ${q(it.kind)}, ${o.phase}, ${it.rarity}, ${it.st}, ${o.cum}, ${o.price}, ` +
          `${instancePrice(o.price, FI_RANGE - 1, false)}, ${instancePrice(o.price, 0, false)}, ${c.contractable})`,
      )
    }
  out.push(rows.join(',\n') + ';')
  out.push('commit;')
  return out.join('\n') + '\n'
}
