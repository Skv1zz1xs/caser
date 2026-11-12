import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { ChevronLeft, FastForward, ShieldCheck, Sparkles, Ticket } from 'lucide-react'
import { BONUS, COUNTER, PHASES, RARITIES } from '../config/economy'
import { CATALOG } from '../shared/catalog'
import { fmt, fmtX } from '../shared/money'
import { rpc, type Item, type Me } from '../lib/api'
import { applyMe, useGame } from '../store/game'
import { dropSound, haptic, sfx } from '../audio/sfx'
import { Roulette } from '../components/Roulette'
import { prewarmCase } from '../art/three3d'
import { Cinematic, detectCinema, type CineEvent } from '../components/Cinematic'
import { Btn, CaseCover, Confetti, ItemArt, ItemCard, Money, Section, cx, itemTitle, mmss, rc, useNow } from '../components/ui'

const COUNTS = [1, 2, 3, 5, 10]

export default function CasePage() {
  const { id } = useParams()
  const nav = useNavigate()
  const c = CATALOG.caseById.get(id ?? '')
  const me = useGame((s) => s.me)!
  const fast = useGame((s) => s.fast)
  const setG = useGame((s) => s.set)
  const run = useGame((s) => s.run)
  const [count, setCount] = useState(1)
  const [spinId, setSpinId] = useState(0)
  const [drops, setDrops] = useState<Item[]>([])
  const [stage, setStage] = useState<'idle' | 'spin' | 'result'>('idle')
  const [busy, setBusy] = useState(false)
  const [fx, setFx] = useState({ confetti: 0, flash: '', shake: false, gold: false })
  const [cine, setCine] = useState<CineEvent | null>(null)
  const done = useRef(0)
  const now = useNow()

  useEffect(() => {
    setStage('idle')
    setDrops([])
    setSpinId(0)
  }, [id])

  useEffect(() => {
    if (c) prewarmCase(c)
  }, [c])
  const isFree = c?.category === 'free'
  const tickets = c ? (me.tickets[c.id] ?? 0) : 0
  const freeLeft = isFree ? (me.free_case_at ?? 0) + BONUS.freeCase.cooldownMin * 60000 - now : 0
  const n = isFree ? 1 : count

  const sorted = useMemo(() => (c ? [...c.outcomes].sort((a, b) => b.price - a.price) : []), [c])
  if (!c) return <div className="p-10 text-center text-mute">Такого кейса нет. <Link className="text-gold" to="/">К кейсам</Link></div>

  const finish = (items: Item[]) => {
    const best = items.reduce((a, b) => (b.price > a.price ? b : a))
    const gold = best.rarity >= 6 || best.phase >= 2
    dropSound(best.rarity, best.phase)
    haptic(gold ? [30, 40, 60, 40, 90] : best.rarity >= 4 ? [30, 40, 60] : 12)
    if (best.rarity >= 4 || gold) setFx({ confetti: Date.now(), flash: gold ? '#ffc93c' : rc(best.rarity), shake: true, gold })
    setTimeout(() => setFx((f) => ({ ...f, shake: false, flash: '' })), 800)
    useGame.getState().addItems(items)
    setStage('result')
    setCine(detectCinema(items, c.price))
    if (best.x && best.x >= 1000) useGame.getState().toast(`${fmtX(best.price, c.price)} — вот это залёт!`, 'gold')
  }

  const open = async (useTicket = false) => {
    if (busy || stage === 'spin') return
    setBusy(true)
    sfx('open')
    const r = await run(async () =>
      applyMe(
        isFree
          ? await rpc<{ drops: Item[]; me: Me }>('bonus_free_case')
          : await rpc<{ drops: Item[]; me: Me }>('open_case', { p_case: c.id, p_count: useTicket ? Math.min(n, tickets) : n, p_ticket: useTicket }),
      ),
    )
    setBusy(false)
    if (!r) return
    done.current = 0
    setFx({ confetti: 0, flash: '', shake: false, gold: false })
    setDrops(r.drops)
    setStage('spin')
    setSpinId((x) => x + 1)
  }

  const onStripDone = () => {
    done.current++
    if (done.current >= drops.length) finish(drops)
  }

  const sell = async (ids: number[]) => {
    const r = await run(async () => applyMe(await rpc<{ amount: number; me: Me; removed: number[] }>('sell_items', { p_ids: ids })))
    if (!r) return
    sfx('sell')
    haptic(15)
    useGame.getState().removeItems(r.removed)
    setDrops((d) => d.filter((x) => !ids.includes(x.id)))
  }

  const rows = stage === 'idle' ? n : drops.length || n
  const h = rows === 1 ? 148 : rows <= 3 ? 104 : rows <= 5 ? 78 : 58
  const cost = c.price * n
  const canPay = me.balance >= cost
  const total = drops.reduce((a, d) => a + d.price, 0)

  return (
    <div className={cx('space-y-4', fx.shake && 'shake')}>
      <Cinematic ev={cine} onDone={() => setCine(null)} />
      <Confetti fire={fx.confetti} colors={fx.gold ? ['#ffe9a8', '#ffc93c', '#ff9a2e', '#ffffff'] : undefined} />
      {fx.flash && <div className="flash pointer-events-none fixed inset-0 z-40" style={{ background: `radial-gradient(circle at 50% 40%, ${fx.flash}, transparent 65%)` }} />}

      <div className="panel-glass relative overflow-hidden rounded-3xl p-4 sm:p-5">
        <div className="pointer-events-none absolute -right-10 -top-16 size-72 rounded-full opacity-40" style={{ background: `radial-gradient(circle, ${c.colors[0]}, transparent 68%)` }} />
        <div className="relative flex items-center gap-3 sm:gap-5">
          <button onClick={() => nav(-1)} aria-label="Назад" className="grid size-10 shrink-0 place-items-center self-start rounded-full bg-white/8 hover:bg-white/14"><ChevronLeft size={18} /></button>
          <div className="float -my-2 shrink-0"><CaseCover c={c} size={stage === 'idle' ? 132 : 100} /></div>
          <div className="min-w-0 flex-1">
            <h1 className="display truncate text-xl sm:text-3xl font-extrabold">{c.name}</h1>
            <div className="mt-1 text-xs sm:text-sm text-mute">{c.tagline}</div>
            {!isFree && <div className="mt-2 inline-flex items-center gap-1 rounded-lg bg-ok/12 px-2 py-1 text-xs font-semibold text-ok"><ShieldCheck size={12} />RTP {(c.rtp * 100).toFixed(0)} %</div>}
          </div>
          {!isFree && <Money v={c.price} className="display shrink-0 rounded-2xl bg-white/8 px-3 py-2 text-base sm:text-2xl font-extrabold text-gold" size={20} />}
        </div>
      </div>

      <Section className="!p-3 sm:!p-4">
        <div className={cx('grid gap-2', rows > 5 && 'sm:grid-cols-2')}>
          {Array.from({ length: rows }, (_, i) => (
            <Roulette key={i} c={c} result={drops[i] ?? null} spinId={drops[i] ? spinId : 0} fast={fast} height={h} ticks={i === 0} onDone={onStripDone} />
          ))}
        </div>

        <AnimatePresence>
          {stage === 'result' && drops.length > 0 && (
            <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="mt-4" data-testid="result">
              {fx.gold && (
                <div className="pointer-events-none absolute left-1/2 top-24 -z-0 size-[420px] -translate-x-1/2 opacity-40">
                  <div className="rays size-full rounded-full" style={{ background: 'repeating-conic-gradient(#ffc93c 0 8deg, transparent 8deg 20deg)', maskImage: 'radial-gradient(circle, #000 10%, transparent 65%)' }} />
                </div>
              )}
              {drops.length === 1 ? (
                <WinCard d={drops[0]} casePrice={c.price} onSell={() => sell([drops[0].id])} />
              ) : (
                <>
                  <div className="flex flex-wrap justify-center gap-2">
                    {drops.map((d) => (
                      <div key={d.id} className="w-[30%] min-w-[104px] max-w-[190px] sm:w-[18%]"><ItemCard i={d} compact footer={
                        <button onClick={() => sell([d.id])} className="mt-1 min-h-9 w-full rounded-lg bg-white/10 text-xs font-bold hover:bg-white/20">Продать</button>
                      } /></div>
                    ))}
                  </div>
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                    <div className="text-sm text-mute">Выпало на <Money v={total} className="font-extrabold text-white" /> {!isFree && cost > 0 && <span className={total >= cost ? 'text-ok' : 'text-bad'}>({fmtX(total, cost)})</span>}</div>
                    <Btn kind="soft" onClick={() => sell(drops.map((d) => d.id))} testId="sell-all-drops">Продать всё за <Money v={total} /></Btn>
                  </div>
                </>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          {!isFree && (
            <div className="flex items-center gap-2">
              <div className="flex rounded-xl bg-white/6 p-1">
                {COUNTS.map((k) => (
                  <button key={k} data-testid={'x' + k} onClick={() => { sfx('click'); setCount(k) }} disabled={stage === 'spin'}
                    className={cx('min-w-11 h-10 rounded-lg px-2 text-sm font-extrabold transition', count === k ? 'bg-white/15 text-gold' : 'text-mute hover:text-white')}>
                    x{k}
                  </button>
                ))}
              </div>
              <button onClick={() => setG({ fast: !fast })} data-testid="fast"
                className={cx('inline-flex h-12 items-center gap-1.5 rounded-xl px-3 text-xs font-bold border', fast ? 'border-gold/50 bg-gold/15 text-gold' : 'border-line bg-white/6 text-mute')}>
                <FastForward size={15} />Быстро
              </button>
            </div>
          )}
          <div className="flex flex-1 flex-col gap-2 sm:flex-row sm:justify-end">
            {tickets > 0 && !isFree && (
              <Btn kind="soft" onClick={() => open(true)} disabled={stage === 'spin'} busy={busy} className="h-12" testId="open-ticket">
                <Ticket size={16} />Бесплатно ×{Math.min(n, tickets)} <span className="text-mute">(есть {tickets})</span>
              </Btn>
            )}
            {isFree ? (
              <Btn kind="gold" onClick={() => open()} disabled={freeLeft > 0 || stage === 'spin'} busy={busy} className="h-12 px-8 text-base" testId="open">
                {freeLeft > 0 ? <>Через {mmss(freeLeft)}</> : <><Sparkles size={18} />Открыть бесплатно</>}
              </Btn>
            ) : (
              <Btn kind="gold" onClick={() => open()} disabled={!canPay || stage === 'spin'} busy={busy} className="h-12 px-8 text-base" testId="open">
                {canPay ? <>Открыть за <Money v={cost} size={16} /></> : <>Не хватает <Money v={cost - me.balance} size={16} /></>}
              </Btn>
            )}
          </div>
        </div>
      </Section>

      {stage === 'result' && drops.length > 0 && (
        <div className="fixed inset-x-3 bottom-[88px] z-30 flex gap-2 sm:hidden" data-testid="sticky-cta">
          <Btn kind="gold" className="h-12 flex-1" disabled={!canPay && !isFree} onClick={() => open()} busy={busy}>Открыть ещё</Btn>
          <Btn kind="soft" className="h-12 flex-1 bg-panel/95" onClick={() => sell(drops.map((d) => d.id))}>Продать <Money v={total} short /></Btn>
        </div>
      )}

      <Section title="Что внутри" right={<span className="text-xs text-mute">{c.outcomes.length} вариантов · шансы честные, как на сервере</span>}>
        <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-mute">
          <span>Износ меняет цену на ±20 %</span>
          <span><b className="text-fire">{COUNTER.short}</b> — «{COUNTER.name}»: шанс {COUNTER.chancePct} %, цена ×{COUNTER.mult}</span>
          {c.outcomes.some((o) => o.phase > 0) && <span>Фазы: {PHASES.slice(1).map((p) => `${p.name} ×${p.mult}`).join(', ')}</span>}
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-2">
          {sorted.map((o) => {
            const it = CATALOG.itemById.get(o.itemId)!
            const pct = o.weight / 1e7
            return (
              <div key={o.idx} className="item-card p-2" style={{ '--rc': rc(it.rarity) } as CSSProperties}>
                <div className="flex justify-between text-[10px] font-bold">
                  <span style={{ color: rc(it.rarity) }}>{RARITIES[it.rarity].name}</span>
                  <span className="text-mute">{pct >= 1 ? pct.toFixed(2) : pct >= 0.01 ? pct.toFixed(3) : pct.toFixed(5)} %</span>
                </div>
                <ItemArt i={{ item: o.itemId, phase: o.phase, fi: 3000 }} className="h-14 w-full" />
                <div className="truncate text-[10px] text-mute">{it.weapon}</div>
                <div className="truncate text-xs font-bold">{it.skin}{o.phase > 0 && <span className="text-gold"> · {PHASES[o.phase].name}</span>}</div>
                <div className="mt-0.5 flex items-center justify-between text-[11px] font-extrabold">
                  <Money v={o.price} short size={11} />
                  {c.price > 0 && <span className={o.price >= c.price ? 'text-ok' : 'text-mute'}>{fmtX(o.price, c.price)}</span>}
                </div>
              </div>
            )
          })}
        </div>
      </Section>
    </div>
  )
}

function WinCard({ d, casePrice, onSell }: { d: Item; casePrice: number; onSell: () => void }) {
  const t = itemTitle(d)
  const gold = d.rarity >= 6 || d.phase >= 2
  return (
    <motion.div
      initial={{ scale: 0.85, rotateY: gold ? 90 : 0 }} animate={{ scale: 1, rotateY: 0 }} transition={{ type: 'spring', stiffness: 220, damping: 18 }}
      className={cx('relative mx-auto flex max-w-md items-center gap-4 rounded-3xl p-4 item-card pulse-glow', gold && 'shine')} style={{ '--rc': rc(d.rarity) } as CSSProperties}
    >
      <ItemArt i={d} className="h-24 w-36 sm:h-28 sm:w-44" />
      <div className="min-w-0 flex-1">
        <div className="text-[11px] font-bold" style={{ color: rc(d.rarity) }}>{RARITIES[d.rarity].name}{t.phase && ` · ${t.phase}`}</div>
        <div className="truncate text-xs text-mute">{t.weapon}</div>
        <div className="display truncate text-base font-extrabold">{t.skin}</div>
        <div className="mt-0.5 text-[11px] text-mute">{t.wear.name} · {(d.fi / 10000).toFixed(4)}{d.st && <span className="text-fire"> · {COUNTER.name}</span>}</div>
        <div className="mt-2 flex items-center gap-2">
          <Money v={d.price} className="display text-lg font-extrabold" size={16} />
          {casePrice > 0 && <span className={cx('text-sm font-extrabold', d.price >= casePrice ? 'text-ok' : 'text-mute')}>{fmtX(d.price, casePrice)}</span>}
        </div>
        <button onClick={onSell} data-testid="sell-drop" className="mt-2 rounded-lg bg-white/10 px-3 py-1.5 text-xs font-bold hover:bg-white/20">Продать за {fmt(d.price)}</button>
      </div>
    </motion.div>
  )
}
