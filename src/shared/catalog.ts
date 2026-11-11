import {
  ACHIEVEMENTS, BATTLE, BONUS, CASE_ECON, COIN, COINFLIP, CONTRACT, COUNTER, CRASH, FREE_TABLE, LIMITS, PASS, PHASES,
  PROFILES, QUESTS, RARITIES, RISK_TABLES, UPGRADE, WEAR, WEAR_PRICE,
} from '../config/economy'
import { CASE_CONTENT, type CaseCategory } from '../config/cases'
import { GLOVES, KNIVES, SLOT_WEAPONS, WEAPON_BY_ID, type ItemKind } from '../config/weapons'
import { FI_RANGE, ST_LIMIT, ST_MULT_PM, TICKETS, WEAR_A, WEAR_B, instancePrice } from './money'

export { TICKETS }

export interface ItemDef {
  id: string
  caseId: string
  /** полное название «Модель | Скин» */
  name: string
  skin: string
  weapon: string
  weaponId: string
  kind: ItemKind
  shape: string
  rarity: number
  /** сырая стоимость в долях цены кейса (до k) */
  raw: number
  /** может ли выпасть со счётчиком */
  st: boolean
  /** есть ли фазы */
  phases: boolean
  /** порядковый номер в кейсе */
  slot: number
}

export interface Outcome {
  idx: number
  itemId: string
  phase: number
  /** билетов из TICKETS */
  weight: number
  /** верхняя граница диапазона билетов (не включая) */
  cum: number
  /** базовая цена в копейках (износ 0.5, без счётчика) */
  price: number
}

export interface CaseDef {
  id: string
  ord: number
  name: string
  category: CaseCategory
  tagline: string
  colors: [string, string]
  icon: string
  /** цена в копейках */
  price: number
  rtp: number
  profile: string
  items: ItemDef[]
  outcomes: Outcome[]
  /** коэффициент масштабирования стоимости */
  k: number
  /** участвует ли в контрактах как источник результата */
  contractable: boolean
}

export interface FlatOutcome {
  caseId: string
  caseOrd: number
  idx: number
  itemId: string
  phase: number
  price: number
  rarity: number
  contractable: boolean
}

interface Spec { rarity: number; pct: number; raw: number; kind: ItemKind | 'auto'; fixedCoins?: number }

/** Средний множитель износа (float равномерен). */
const MEAN_WEAR = (WEAR_A - (WEAR_B * (FI_RANGE - 1)) / 2) / 100_000
const ST_P = ST_LIMIT / FI_RANGE

/** Средняя цена экземпляра для базовой цены (с учётом округлений вниз). exact=true — полный перебор износа. */
function avgInstance(base: number, st: boolean, exact: boolean): number {
  if (!exact && base >= 200_000) {
    const p = base * MEAN_WEAR - 0.5
    return st ? p * (1 - ST_P) + (p * (ST_MULT_PM / 1000) - 0.25) * ST_P : p
  }
  const step = exact ? 1 : 17
  let sum = 0
  let n = 0
  for (let fi = 0; fi < FI_RANGE; fi += step) {
    const p = instancePrice(base, fi, false)
    sum += st ? p * (1 - ST_P) + instancePrice(base, fi, true) * ST_P : p
    n++
  }
  return sum / n
}

function specsFor(profile: string, id: string): Spec[] {
  if (profile === 'risk') {
    const t = RISK_TABLES[id]
    if (!t) throw new Error(`Нет RISK_TABLES для кейса ${id}`)
    return t.map((r) => ({ rarity: r.rarity, pct: r.pct, raw: r.raw, kind: 'auto' }))
  }
  if (profile === 'free') return FREE_TABLE.map((r) => ({ rarity: r.rarity, pct: r.pct, raw: 0, kind: 'auto', fixedCoins: r.coins }))
  const p = PROFILES[profile]
  if (!p) throw new Error(`Неизвестный профиль ${profile} у кейса ${id}`)
  const out: Spec[] = []
  for (let r = 0; r < RARITIES.length; r++) {
    const n = p.counts[r]
    for (let i = 0; i < n; i++) {
      const { min, max } = RARITIES[r]
      const raw = n === 1 ? (min + max) / 2 : min + ((max - min) * i) / (n - 1)
      out.push({ rarity: r, pct: p.chances[r] / n, raw, kind: r === 6 ? p.special[i] : 'gun' })
    }
  }
  return out
}

function buildCase(ord: number): CaseDef {
  const econ = CASE_ECON[ord]
  const content = CASE_CONTENT.find((x) => x.id === econ.id)
  if (!content) throw new Error(`Нет контента (cases.ts) для кейса ${econ.id}`)
  const specs = specsFor(econ.profile, econ.id)
  if (specs.length !== content.skins.length)
    throw new Error(`Кейс ${econ.id}: скинов ${content.skins.length}, а нужно ${specs.length}`)
  const plain = econ.profile === 'risk' || econ.profile === 'free'
  const price = Math.round(econ.price * COIN)

  // --- предметы
  const perRarity = new Map<number, number>()
  const items: ItemDef[] = specs.map((s, slot) => {
    const i = perRarity.get(s.rarity) ?? 0
    perRarity.set(s.rarity, i + 1)
    let weaponId: string
    if (s.kind === 'knife' || (s.kind === 'auto' && s.rarity === 6)) weaponId = KNIVES[(ord + i) % KNIVES.length]
    else if (s.kind === 'glove') weaponId = GLOVES[(ord + i) % GLOVES.length]
    else {
      const list = SLOT_WEAPONS[s.rarity]
      weaponId = list[(ord + i) % list.length]
    }
    const w = WEAPON_BY_ID.get(weaponId)!
    const skin = content.skins[slot]
    return {
      id: `${econ.id}-${slot}`, caseId: econ.id, name: `${w.name} | ${skin}`, skin, weapon: w.name, weaponId,
      kind: w.kind, shape: w.shape, rarity: s.rarity, raw: s.raw, st: w.kind === 'gun', phases: !plain && w.kind !== 'gun', slot,
    }
  })

  // --- веса: редкость получает round(pct × 1e7) билетов, остаток деления — первому предмету редкости
  const byRarity = new Map<number, number[]>()
  specs.forEach((s, i) => byRarity.set(s.rarity, [...(byRarity.get(s.rarity) ?? []), i]))
  const itemWeight = new Array<number>(specs.length).fill(0)
  if (plain) specs.forEach((s, i) => (itemWeight[i] = Math.round(s.pct * 1e7)))
  else
    for (const [, idxs] of byRarity) {
      const total = Math.round(idxs.reduce((a, i) => a + specs[i].pct, 0) * 1e7)
      const each = Math.floor(total / idxs.length)
      idxs.forEach((i, j) => (itemWeight[i] = each + (j === 0 ? total - each * idxs.length : 0)))
    }
  const wsum = itemWeight.reduce((a, b) => a + b, 0)
  if (wsum !== TICKETS) throw new Error(`Кейс ${econ.id}: шансы дают ${(wsum / 1e7).toFixed(5)} %, а нужно 100 %`)

  // --- исходы (предмет × фаза)
  const outs: { item: ItemDef; phase: number; weight: number; raw: number; fixed?: number }[] = []
  items.forEach((it, i) => {
    const s = specs[i]
    if (!it.phases) {
      outs.push({ item: it, phase: 0, weight: itemWeight[i], raw: s.raw, fixed: s.fixedCoins })
      return
    }
    const ws = PHASES.map((p) => Math.floor((itemWeight[i] * p.pct) / 100))
    ws[0] = itemWeight[i] - ws.slice(1).reduce((a, b) => a + b, 0)
    PHASES.forEach((p, ph) => outs.push({ item: it, phase: ph, weight: ws[ph], raw: s.raw * p.mult }))
  })

  // --- цены: k = RTP / средняя сырая стоимость, затем подгонка под целые копейки
  let k = 1
  const prices = new Array<number>(outs.length)
  if (econ.profile === 'free') outs.forEach((o, i) => (prices[i] = Math.round(o.fixed! * COIN)))
  else {
    const target = econ.rtp * price
    const mod = (o: (typeof outs)[number]) => MEAN_WEAR * (o.item.st ? 1 + ST_P * (ST_MULT_PM / 1000 - 1) : 1)
    const rawEv = outs.reduce((a, o) => a + (o.weight / TICKETS) * o.raw * price * mod(o), 0)
    k = target / rawEv
    const ev = () => outs.reduce((a, o, i) => a + (o.weight / TICKETS) * avgInstance(prices[i], o.item.st, false), 0)
    for (let pass = 0; pass < 4; pass++) {
      outs.forEach((o, i) => (prices[i] = Math.max(1, Math.round(o.raw * k * price))))
      const e = ev()
      if (Math.abs(e - target) / target < 1e-5) break
      k *= target / e
    }
    // добиваем остаток ±копейками на самых частых исходах (важно для кейсов за 1–10 монет)
    let err = target - ev()
    const order = outs.map((_, i) => i).sort((a, b) => outs[b].weight - outs[a].weight)
    for (const i of order) {
      const per = (outs[i].weight / TICKETS) * mod(outs[i])
      const n = Math.max(-3, Math.min(3, Math.round(err / per)))
      if (n !== 0 && prices[i] + n >= 1) {
        prices[i] += n
        err -= n * per
      }
    }
  }

  let cum = 0
  const outcomes: Outcome[] = outs.map((o, idx) => {
    cum += o.weight
    return { idx, itemId: o.item.id, phase: o.phase, weight: o.weight, cum, price: prices[idx] }
  })

  return {
    id: econ.id, ord, name: content.name, category: content.category, tagline: content.tagline, colors: content.colors,
    icon: content.icon, price, rtp: econ.rtp, profile: econ.profile, items, outcomes, k, contractable: !plain,
  }
}

/** Точное матожидание стоимости одного открытия, копейки. */
export function expectedValue(c: CaseDef): number {
  const st = new Map(c.items.map((i) => [i.id, i.st]))
  return c.outcomes.reduce((a, o) => a + (o.weight / TICKETS) * avgInstance(o.price, st.get(o.itemId)!, true), 0)
}

/** Шансы редкостей кейса в процентах. */
export function rarityChances(c: CaseDef): number[] {
  const rar = new Map(c.items.map((i) => [i.id, i.rarity]))
  const out = new Array<number>(RARITIES.length).fill(0)
  for (const o of c.outcomes) out[rar.get(o.itemId)!] += o.weight / 1e7
  return out
}

function fnv(s: string, seed: number): string {
  let h = seed >>> 0
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}

function build() {
  const ids = new Set(CASE_ECON.map((e) => e.id))
  for (const cc of CASE_CONTENT) if (!ids.has(cc.id)) throw new Error(`Кейс ${cc.id} есть в cases.ts, но нет в economy.ts`)
  const cases = CASE_ECON.map((_, i) => buildCase(i))
  const caseById = new Map(cases.map((c) => [c.id, c]))
  const itemById = new Map(cases.flatMap((c) => c.items.map((i) => [i.id, i] as const)))
  const outcomes: FlatOutcome[] = cases
    .filter((c) => c.category !== 'free')
    .flatMap((c) =>
      c.outcomes.map((o) => ({
        caseId: c.id, caseOrd: c.ord, idx: o.idx, itemId: o.itemId, phase: o.phase, price: o.price,
        rarity: itemById.get(o.itemId)!.rarity, contractable: c.contractable,
      })),
    )
  const sig = JSON.stringify([
    cases.map((c) => [c.id, c.price, c.outcomes.map((o) => [o.itemId, o.phase, o.weight, o.price])]),
    UPGRADE, CONTRACT, BATTLE, COINFLIP, CRASH, BONUS, PASS, QUESTS, ACHIEVEMENTS, WEAR, WEAR_PRICE, COUNTER, LIMITS,
  ])
  return { cases, caseById, itemById, outcomes, version: fnv(sig, 0x811c9dc5) + fnv(sig, 0x9747b28c) }
}

export const CATALOG = build()

export const caseOf = (id: string): CaseDef => {
  const c = CATALOG.caseById.get(id)
  if (!c) throw new Error(`Нет кейса ${id}`)
  return c
}
export const itemOf = (id: string): ItemDef => {
  const i = CATALOG.itemById.get(id)
  if (!i) throw new Error(`Нет предмета ${id}`)
  return i
}
