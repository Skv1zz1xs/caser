import { useMemo, useRef, useState, type CSSProperties } from 'react'
import { animate, motion, useMotionValue } from 'framer-motion'
import { FastForward, Search, TrendingUp } from 'lucide-react'
import { COIN, PHASES, UPGRADE } from '../config/economy'
import { CATALOG, type FlatOutcome } from '../shared/catalog'
import { FI_RANGE, fmt, instancePrice } from '../shared/money'
import { upgradeAllowed, upgradeChancePpm, upgradeTargetRange } from '../shared/upgrade'
import { rpc, type Item, type Me } from '../lib/api'
import { applyMe, useGame } from '../store/game'
import { sfx } from '../audio/sfx'
import { Picker } from '../components/Picker'
import { Btn, Confetti, ItemArt, ItemCard, Money, Section, cx, rc, reducedMotion } from '../components/ui'
import { useItems } from './Inventory'

interface Target extends FlatOutcome { target: number }
const TARGETS: Target[] = CATALOG.outcomes
  .map((o) => ({ ...o, target: instancePrice(o.price, FI_RANGE / 2, false) }))
  .sort((a, b) => a.target - b.target)
const MULTS = [1.5, 2, 3, 5, 10, 20, 50]

function Wheel({ ppm, angle, state }: { ppm: number; angle: any; state: 'idle' | 'spin' | 'win' | 'lose' }) {
  const R = 88
  const C = 2 * Math.PI * R
  const frac = ppm / 1e6
  const color = state === 'lose' ? '#ff4d6a' : state === 'win' ? '#3ddc97' : '#ffc93c'
  return (
    <div className="relative mx-auto aspect-square w-full max-w-[280px]">
      <svg viewBox="0 0 200 200" className="size-full -rotate-90">
        <circle cx="100" cy="100" r={R} fill="none" stroke="rgb(255 255 255 / .07)" strokeWidth="12" />
        <circle cx="100" cy="100" r={R} fill="none" stroke={color} strokeWidth="12" strokeLinecap="butt"
          strokeDasharray={`${C * frac} ${C}`} style={{ filter: `drop-shadow(0 0 8px ${color})`, transition: 'stroke-dasharray .35s, stroke .2s' }} />
        {Array.from({ length: 40 }, (_, i) => (
          <line key={i} x1="100" y1="3" x2="100" y2={i % 5 ? 7 : 10} stroke="#fff" strokeOpacity=".25" transform={`rotate(${i * 9} 100 100)`} />
        ))}
      </svg>
      <motion.div className="absolute inset-0" style={{ rotate: angle }}>
        <div className="absolute left-1/2 top-[1%] -translate-x-1/2 border-x-[9px] border-t-[16px] border-x-transparent border-t-white drop-shadow-[0_0_8px_#fff]" />
      </motion.div>
      <div className="absolute inset-[16%] grid place-items-center rounded-full glass text-center">
        <div>
          <div className="display text-3xl font-black tabular-nums" style={{ color }} data-testid="chance">{(ppm / 10000).toFixed(2)}%</div>
          <div className="text-[11px] font-bold text-mute">{state === 'win' ? 'Залетело!' : state === 'lose' ? 'Мимо…' : 'шанс апгрейда'}</div>
        </div>
      </div>
    </div>
  )
}

export default function Upgrade() {
  const { items } = useItems()
  const me = useGame((s) => s.me)!
  const fast = useGame((s) => s.fast)
  const setG = useGame((s) => s.set)
  const run = useGame((s) => s.run)
  const [sel, setSel] = useState<Set<number>>(new Set())
  const [coinsStr, setCoinsStr] = useState('')
  const [target, setTarget] = useState<Target | null>(null)
  const [q, setQ] = useState('')
  const [state, setState] = useState<'idle' | 'spin' | 'win' | 'lose'>('idle')
  const [won, setWon] = useState<Item | null>(null)
  const [confetti, setConfetti] = useState(0)
  const angle = useMotionValue(0)
  const lastTick = useRef(0)

  const coins = Math.max(0, Math.min(me.balance, Math.round((parseFloat(coinsStr.replace(',', '.')) || 0) * COIN)))
  const picked = items.filter((i) => sel.has(i.id))
  const input = picked.reduce((a, i) => a + i.price, 0) + coins
  const range = upgradeTargetRange(input)
  const ppm = target ? upgradeChancePpm(input, target.target) : 0
  const ok = target !== null && input > 0 && upgradeAllowed(ppm)

  const list = useMemo(() => {
    const s = q.trim().toLowerCase()
    const inRange = input > 0 ? TARGETS.filter((t) => t.target >= range.min && t.target <= range.max) : TARGETS
    const f = s ? inRange.filter((t) => CATALOG.itemById.get(t.itemId)!.name.toLowerCase().includes(s) || CATALOG.caseById.get(t.caseId)!.name.toLowerCase().includes(s)) : inRange
    return f.slice(0, 150)
  }, [q, input, range.min, range.max])

  const toggle = (i: Item) => {
    if (state === 'spin') return
    sfx('click')
    setState('idle')
    setWon(null)
    setSel((s) => {
      const n = new Set(s)
      if (n.has(i.id)) n.delete(i.id)
      else if (n.size < UPGRADE.maxItems) n.add(i.id)
      return n
    })
  }
  const pickMult = (m: number) => {
    if (input <= 0) return
    const want = input * m
    const inRange = TARGETS.filter((t) => t.target >= range.min && t.target <= range.max)
    if (!inRange.length) return
    sfx('click')
    setTarget(inRange.reduce((a, b) => (Math.abs(b.target - want) < Math.abs(a.target - want) ? b : a)))
  }

  const go = async () => {
    if (!ok || state === 'spin') return
    const t = target!
    setState('spin')
    setWon(null)
    const r = await run(() => rpc<{ win: boolean; roll: number; ppm: number; item: Item | null; removed: number[]; me: Me }>('upgrade', {
      p_ids: [...sel], p_coins: coins, p_case: t.caseId, p_idx: t.idx,
    }))
    if (!r) return setState('idle')
    const end = 360 * (reducedMotion() || fast ? 2 : 6) + (r.roll / 1e6) * 360
    angle.set(0)
    await animate(angle, end, {
      duration: reducedMotion() ? 0.2 : fast ? 1.1 : 5,
      ease: [0.12, 0.6, 0.1, 1],
      onUpdate: (v) => {
        const k = Math.floor(v / 30)
        if (k !== lastTick.current) {
          lastTick.current = k
          sfx('spin')
        }
      },
    })
    applyMe(r)
    useGame.getState().removeItems(r.removed)
    setSel(new Set())
    setCoinsStr('')
    if (r.win && r.item) {
      useGame.getState().addItems([r.item])
      setWon(r.item)
      setState('win')
      setConfetti(Date.now())
      sfx('win')
    } else {
      setState('lose')
      sfx('fail')
    }
  }

  return (
    <div className="space-y-4">
      <Confetti fire={confetti} />
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="display text-xl sm:text-2xl font-extrabold">Апгрейдер</h1>
          <p className="text-xs text-mute">Шанс = вложено ÷ цена цели × {UPGRADE.edgePct / 100}. Допустимо от {UPGRADE.minPct} до {UPGRADE.maxPct} %.</p>
        </div>
        <button onClick={() => setG({ fast: !fast })} className={cx('inline-flex h-10 items-center gap-1.5 rounded-xl border px-3 text-xs font-bold', fast ? 'border-gold/50 bg-gold/15 text-gold' : 'border-line bg-white/6 text-mute')}>
          <FastForward size={15} />Быстро
        </button>
      </div>

      <Section className="!p-4">
        <div className="grid items-center gap-4 md:grid-cols-[1fr_auto_1fr]">
          <div className="order-2 md:order-1">
            <div className="mb-1 text-[11px] font-bold uppercase tracking-wide text-mute">Вкладываешь</div>
            <div className="flex min-h-24 flex-wrap items-center gap-1.5 rounded-2xl bg-black/25 p-2">
              {picked.length === 0 && coins === 0 && <span className="px-2 text-xs text-mute">Выбери предметы ниже или добавь монеты</span>}
              {picked.map((i) => (
                <button key={i.id} onClick={() => toggle(i)} className="item-card grid size-14 place-items-center" style={{ '--rc': rc(i.rarity) } as CSSProperties} title="Убрать">
                  <ItemArt i={i} className="h-9 w-12" />
                </button>
              ))}
              {coins > 0 && <Money v={coins} className="rounded-xl bg-gold/15 px-2.5 py-2 text-xs font-extrabold text-gold" />}
            </div>
            <div className="mt-2 flex items-center justify-between text-sm">
              <span className="text-mute">Итого</span><Money v={input} className="display font-extrabold" />
            </div>
          </div>
          <div className="order-1 w-56 justify-self-center sm:w-64 md:order-2"><Wheel ppm={ok || state !== 'idle' ? ppm : target ? ppm : 0} angle={angle} state={state} /></div>
          <div className="order-3">
            <div className="mb-1 text-[11px] font-bold uppercase tracking-wide text-mute">Цель</div>
            {won ? (
              <div data-testid="upgrade-won"><ItemCard i={won} /></div>
            ) : target ? (
              <div className={cx(state === 'lose' && 'opacity-40 grayscale')}>
                <ItemCard i={{ item: target.itemId, phase: target.phase, rarity: target.rarity, fi: FI_RANGE / 2, st: false, price: target.target }}
                  footer={<div className="mt-1 text-[10px] text-mute">из кейса «{CATALOG.caseById.get(target.caseId)!.name}» · x{input > 0 ? (target.target / input).toFixed(2) : '—'}</div>} />
              </div>
            ) : (
              <div className="grid min-h-24 place-items-center rounded-2xl bg-black/25 p-3 text-center text-xs text-mute">Выбери цель из списка или нажми множитель</div>
            )}
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-center gap-1.5">
          {MULTS.map((m) => (
            <button key={m} onClick={() => pickMult(m)} disabled={input <= 0 || state === 'spin'} data-testid={'mult-' + m}
              className="h-10 min-w-12 rounded-xl bg-white/8 px-3 text-sm font-extrabold hover:bg-white/15 disabled:opacity-40">x{m}</button>
          ))}
        </div>
        <Btn kind="gold" className="mx-auto mt-4 flex h-13 w-full max-w-sm text-base" onClick={go} disabled={!ok} busy={state === 'spin'} testId="upgrade-go">
          <TrendingUp size={18} />{target && input > 0 && !upgradeAllowed(ppm) ? (ppm > UPGRADE.maxPct * 10000 ? 'Цель слишком дешёвая' : 'Цель слишком дорогая') : 'Апгрейд'}
        </Btn>
      </Section>

      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="Мои предметы" right={<span className="text-xs text-mute">{sel.size}/{UPGRADE.maxItems}</span>}>
          <label className="mb-3 flex items-center gap-2 text-xs text-mute">
            Добавить монет:
            <input value={coinsStr} onChange={(e) => { setCoinsStr(e.target.value); setState('idle'); setWon(null) }} inputMode="decimal" placeholder="0" data-testid="up-coins"
              className="h-10 w-28 rounded-xl border border-line bg-white/5 px-3 text-sm font-bold text-white outline-none focus:border-gold/50" />
            <button className="font-bold text-gold" onClick={() => setCoinsStr(String(me.balance / COIN))}>всё ({fmt(me.balance)})</button>
          </label>
          <Picker items={items} selected={sel} onToggle={toggle} canPick={() => sel.size < UPGRADE.maxItems} />
        </Section>
        <Section title="Цели" right={<span className="text-xs text-mute">{input > 0 ? `от ${fmt(range.min)} до ${fmt(range.max)}` : 'сначала выбери, что вкладываешь'}</span>}>
          <label className="relative mb-2 block">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-mute" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Поиск цели" className="h-10 w-full rounded-xl border border-line bg-white/5 pl-9 pr-3 text-sm outline-none focus:border-gold/50" />
          </label>
          <div className="grid max-h-[46dvh] grid-cols-3 gap-2 overflow-y-auto pr-1 sm:grid-cols-4" data-testid="targets">
            {list.map((t) => (
              <ItemCard key={t.caseId + t.idx} compact selected={target === t} onClick={() => { sfx('click'); setTarget(t); setState('idle'); setWon(null) }}
                i={{ item: t.itemId, phase: t.phase, rarity: t.rarity, fi: FI_RANGE / 2, st: false, price: t.target }}
                badge={t.phase > 0 ? undefined : input > 0 ? <span className="text-ok">{(upgradeChancePpm(input, t.target) / 10000).toFixed(1)}%</span> : undefined} />
            ))}
            {list.length === 0 && <div className="col-span-full py-8 text-center text-xs text-mute">Нет целей в допустимом диапазоне{PHASES.length ? '' : ''}</div>}
          </div>
        </Section>
      </div>
    </div>
  )
}
