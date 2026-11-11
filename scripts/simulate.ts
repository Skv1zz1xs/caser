/**
 * npm run simulate
 *
 * 1) RTP: каждый кейс открывается 1 000 000 раз через ту же функцию исхода, что и в игре.
 *    Главный ролл (билет) берётся СТРАТИФИЦИРОВАННО: i-е открытие получает случайный билет из i-й
 *    миллионной доли диапазона. Это та же честная симуляция, но без лотереи: при хвостах x300–x3000
 *    обычный Монте-Карло на 1 млн открытий шумит на ±1 % RTP, и проверка «±1 %» падала бы случайно.
 *    Износ и счётчик — обычный ГПСЧ.
 * 2) «Вечер»: игрок со стартовым балансом 2 часа открывает кейсы, собирает бонусы и награды.
 *    Считаем, какая доля игроков хоть раз дошла до 10 000 и до 100 000 монет.
 */
import { ACHIEVEMENTS, BONUS, COIN, PASS, QUESTS } from '../src/config/economy'
import { CATALOG, expectedValue, type CaseDef } from '../src/shared/catalog'
import { FI_RANGE, ST_LIMIT, TICKETS, fmt, instancePrice } from '../src/shared/money'
import { pickOutcome } from '../src/shared/roll'
import { levelFromXp } from '../src/shared/progress'

/* ------------------------------- ГПСЧ ---------------------------------- */
function sfc32(a: number, b: number, c: number, d: number) {
  return () => {
    a |= 0; b |= 0; c |= 0; d |= 0
    const t = (((a + b) | 0) + d) | 0
    d = (d + 1) | 0
    a = b ^ (b >>> 9)
    b = (c + (c << 3)) | 0
    c = (c << 21) | (c >>> 11)
    c = (c + t) | 0
    return t >>> 0
  }
}
const SEED = Number(process.env.SEED ?? 20261110)
const rng = sfc32(0x9e3779b9, 0x243f6a88, 0xb7e15162, SEED)
for (let i = 0; i < 20; i++) rng()
const rand = () => rng() / 4294967296

const stOf = new Map<string, boolean>()
for (const c of CATALOG.cases) for (const it of c.items) stOf.set(it.id, it.st)

/** Одно открытие со случайным билетом. */
function open(c: CaseDef, ticket: number): { value: number; rarity: number; phase: number } {
  const o = pickOutcome(c, ticket)
  const fi = rng() % FI_RANGE
  const st = stOf.get(o.itemId)! && rng() % FI_RANGE < ST_LIMIT
  return { value: instancePrice(o.price, fi, st), rarity: CATALOG.itemById.get(o.itemId)!.rarity, phase: o.phase }
}
const randomTicket = () => Math.floor(rand() * TICKETS)

/* --------------------------- 1. RTP по кейсам --------------------------- */
const N = Number(process.env.OPENS ?? 1_000_000)
let failed = false
const pad = (s: string, n: number) => (s.length >= n ? s : s + ' '.repeat(n - s.length))
const lpad = (s: string, n: number) => (s.length >= n ? s : ' '.repeat(n - s.length) + s)
const oneIn = (cnt: number) => (cnt === 0 ? '—' : `1/${Math.round(N / cnt)}`)

const SKIP_RTP = process.env.ONLY === 'evening'
if (!SKIP_RTP) console.log(`\n=== RTP: ${N.toLocaleString('ru-RU')} открытий на кейс ===\n`)
if (!SKIP_RTP) console.log(pad('кейс', 18) + lpad('цена', 11) + lpad('цель', 8) + lpad('факт', 9) + lpad('точно', 9) + lpad('≥x2', 9) + lpad('≥x10', 9) + lpad('≥x50', 9) + lpad('≥x100', 9))
for (const c of SKIP_RTP ? [] : CATALOG.cases) {
  let sum = 0
  const hit = [0, 0, 0, 0]
  const marks = [2, 10, 50, 100].map((m) => m * c.price)
  for (let i = 0; i < N; i++) {
    const ticket = Math.min(TICKETS - 1, Math.floor(((i + rand()) * TICKETS) / N))
    const v = open(c, ticket).value
    sum += v
    if (c.price > 0) for (let m = 0; m < 4; m++) if (v >= marks[m]) hit[m]++
  }
  const avg = sum / N
  if (c.category === 'free') {
    console.log(pad(c.name, 18) + lpad('бесплатно', 11) + lpad('', 8) + lpad('', 9) + `   средний дроп ${fmt(Math.round(avg))} (точно ${fmt(Math.round(expectedValue(c)))})`)
    continue
  }
  const rtp = avg / c.price
  const exact = expectedValue(c) / c.price
  const bad = Math.abs(rtp - c.rtp) / c.rtp > 0.01
  if (bad) failed = true
  console.log(
    pad(c.name, 18) + lpad(fmt(c.price), 11) + lpad((c.rtp * 100).toFixed(1) + '%', 8) + lpad((rtp * 100).toFixed(2) + '%', 9) +
      lpad((exact * 100).toFixed(2) + '%', 9) + lpad(oneIn(hit[0]), 9) + lpad(oneIn(hit[1]), 9) + lpad(oneIn(hit[2]), 9) + lpad(oneIn(hit[3]), 9) +
      (bad ? '   ✗ ОТКЛОНЕНИЕ > 1 %' : ''),
  )
}

/* ------------------------------ 2. Вечер -------------------------------- */
const PLAYERS = Number(process.env.PLAYERS ?? 20_000)
const MINUTES = 120
/** Модель игрока: opensPerMin открытий в минуту; кейс выбирается ценой около доли f от баланса; всё сразу продаётся. */
const PERSONAS = [
  { name: 'осторожный', share: 0.25, f: 0.04, opensPerMin: 3 },
  { name: 'обычный', share: 0.5, f: 0.1, opensPerMin: 4 },
  { name: 'азартный', share: 0.25, f: 0.25, opensPerMin: 5 },
]
/** сколько друзей делят дождь */
const FRIENDS = 4

const playable = CATALOG.cases.filter((c) => c.category !== 'free').sort((a, b) => a.price - b.price)
const freeCase = CATALOG.caseById.get('free')!
const dayQuests = QUESTS.filter((q) => ['opened', 'sold', 'free_cases', 'x10', 'spent', 'specials'].includes(q.metric))
const achs = ACHIEVEMENTS.filter((a) => ['opened', 'best_mult', 'specials', 'gems', 'novas', 'contrabands', 'peak', 'second_chances', 'rains'].includes(a.metric))

function chooseCase(balance: number, f: number): CaseDef | null {
  const target = balance * f
  const fit = playable.filter((c) => c.price <= target && c.price >= target * 0.4 && c.price <= balance)
  if (fit.length) return fit[rng() % fit.length]
  let best: CaseDef | null = null
  for (const c of playable) if (c.price <= target && c.price <= balance) best = c
  if (best) return best
  return playable[0].price <= balance ? playable[0] : null
}

function evening(p: (typeof PERSONAS)[number]) {
  let bal = BONUS.startBalance * COIN + BONUS.daily.rewards[0] * COIN // старт + дейлик первого дня
  let peak = bal
  let xp = 0
  let level = 0
  let lastSecond = -999
  const cnt: Record<string, number> = { opened: 0, sold: 0, free_cases: 0, x10: 0, spent: 0, specials: 0, gems: 0, novas: 0, contrabands: 0, best_mult: 0, peak: 0, second_chances: 0, rains: 0 }
  const done = new Set<string>()
  const tickets: CaseDef[] = []
  let inflow = 0

  const src: Record<string, number> = {}
  const credit = (coins: number, why: string) => {
    bal += coins * COIN
    inflow += coins
    src[why] = (src[why] ?? 0) + coins
  }
  const progress = () => {
    const lv = levelFromXp(xp).level
    while (level < lv) {
      const r = PASS.rewards[level++]
      if (r.coins) credit(r.coins, 'батл-пасс')
      if (r.case) for (let i = 0; i < r.case[1]; i++) tickets.push(CATALOG.caseById.get(r.case[0])!)
    }
    for (const q of dayQuests)
      if (!done.has(q.id) && cnt[q.metric] >= q.goal) {
        done.add(q.id)
        credit(q.coins, 'задания')
        xp += q.xp
      }
    cnt.peak = Math.max(cnt.peak, bal / COIN)
    for (const a of achs)
      if (!done.has(a.id) && cnt[a.metric] >= a.goal) {
        done.add(a.id)
        credit(a.coins, 'достижения')
      }
    if (bal > peak) peak = bal
  }
  const drop = (c: CaseDef, paid: boolean) => {
    const d = open(c, randomTicket())
    bal += d.value
    cnt.opened++
    cnt.sold++
    if (!paid) {
      inflow += d.value / COIN
      const why = c.category === 'free' ? 'бесплатные кейсы' : 'кейсы из батл-пасса'
      src[why] = (src[why] ?? 0) + d.value / COIN
    }
    if (c.price > 0) {
      const mult = Math.floor((d.value * 100) / c.price)
      if (mult >= 1000) cnt.x10++
      if (mult > cnt.best_mult) cnt.best_mult = mult
    }
    if (d.rarity === 6) cnt.specials++
    if (d.rarity === 7) cnt.contrabands++
    if (d.phase === 2) cnt.gems++
    if (d.phase === 3) cnt.novas++
    xp += PASS.xp.open
    progress()
  }

  for (let minute = 0; minute < MINUTES; minute++) {
    if (minute % BONUS.freeCase.cooldownMin === 0) {
      cnt.free_cases++
      drop(freeCase, false)
    }
    if (minute > 0 && minute % BONUS.rain.everyMin === 0) {
      cnt.rains++
      credit(Math.min(BONUS.rain.maxShare, BONUS.rain.pot / FRIENDS), 'дождь')
      progress()
    }
    for (let a = 0; a < p.opensPerMin; a++) {
      if (tickets.length) {
        drop(tickets.pop()!, false)
        continue
      }
      const c = chooseCase(bal, p.f)
      if (!c) {
        if (bal < BONUS.secondChance.maxNetWorth * COIN && minute - lastSecond >= BONUS.secondChance.cooldownMin) {
          lastSecond = minute
          cnt.second_chances++
          credit(BONUS.secondChance.amount, 'второй шанс')
          progress()
        }
        continue
      }
      bal -= c.price
      cnt.spent += c.price / COIN
      drop(c, true)
    }
  }
  return { peak, final: bal, inflow, level, opened: cnt.opened, src }
}

console.log(`\n=== Вечер: ${PLAYERS.toLocaleString('ru-RU')} игроков × ${MINUTES} минут ===\n`)
let all10 = 0
let all100 = 0
let total = 0
for (const p of PERSONAS) {
  const n = Math.round(PLAYERS * p.share)
  let r10 = 0
  let r100 = 0
  let inflow = 0
  let lvl = 0
  const finals: number[] = []
  const srcSum: Record<string, number> = {}
  for (let i = 0; i < n; i++) {
    const e = evening(p)
    for (const [k, v] of Object.entries(e.src)) srcSum[k] = (srcSum[k] ?? 0) + v
    if (e.peak >= 10_000 * COIN) r10++
    if (e.peak >= 100_000 * COIN) r100++
    inflow += e.inflow
    lvl += e.level
    finals.push(e.final)
  }
  finals.sort((a, b) => a - b)
  all10 += r10
  all100 += r100
  total += n
  console.log(
    pad(p.name, 12) + ` до 10 000: ${lpad(((r10 / n) * 100).toFixed(1), 5)} %   до 100 000: ${lpad(((r100 / n) * 100).toFixed(1), 5)} %   ` +
      `бесплатный приток ≈ ${fmt(Math.round((inflow / n) * COIN))}   уровень БП ≈ ${(lvl / n).toFixed(1)}   медиана в конце ${fmt(finals[finals.length >> 1])}`,
  )
  console.log('             приток в среднем: ' + Object.entries(srcSum).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${Math.round(v / n)}`).join(' · '))
}
const p10 = (all10 / total) * 100
const p100 = (all100 / total) * 100
console.log(`\nИТОГО: до 10 000 дошли ${p10.toFixed(1)} % (цель 30–50 %), до 100 000 — ${p100.toFixed(1)} % (цель ≥ 5 %)`)
if (p10 < 30 || p10 > 50 || p100 < 5) {
  failed = true
  console.log('✗ Вечер вне целевых окон — подкрути BONUS / FREE_TABLE / PASS в src/config/economy.ts')
}

if (failed) {
  console.error('\n✗ СИМУЛЯЦИЯ НЕ ПРОШЛА')
  process.exit(1)
}
console.log('\n✓ Все кейсы в пределах ±1 % от целевого RTP, вечер в целевых окнах')
