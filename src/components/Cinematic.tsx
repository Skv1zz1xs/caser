import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { X } from 'lucide-react'
import { RARITIES } from '../config/economy'
import type { Item } from '../lib/api'
import { fmt } from '../shared/money'
import { sfx } from '../audio/sfx'
import { Confetti, ItemArt, itemTitle, rc, reducedMotion } from './ui'

export type CineKind = 'ultra' | 'mega' | 'trio' | 'seven' | 'zero'
export interface CineEvent { kind: CineKind; item: Item; count?: number }

/** Подбирает секретное событие по результату открытия (в интерфейсе оно нигде не описано). */
export function detectCinema(drops: Item[], casePrice: number): CineEvent | null {
  if (!drops.length) return null
  const best = drops.reduce((a, b) => (b.price > a.price ? b : a))
  const x = best.x ?? 0
  if (x >= 5000 || best.rarity === 7 || best.phase === 3) return { kind: 'ultra', item: best }
  if (x >= 2000) return { kind: 'mega', item: best }
  const byItem = new Map<string, Item[]>()
  for (const d of drops) byItem.set(d.item, [...(byItem.get(d.item) ?? []), d])
  for (const l of byItem.values()) if (l.length >= 3) return { kind: 'trio', item: l[0], count: l.length }
  const seven = drops.find((d) => Math.floor(d.price / 100) % 100 === 77)
  if (seven) return { kind: 'seven', item: seven }
  if (casePrice > 0) {
    const zero = drops.find((d) => Math.abs(d.price - casePrice) / casePrice < 0.01)
    if (zero) return { kind: 'zero', item: zero }
  }
  return null
}

const EASE = [0.22, 1, 0.36, 1] as const

function Counter({ to, ms }: { to: number; ms: number }) {
  const [v, setV] = useState(0)
  useEffect(() => {
    if (reducedMotion()) return setV(to)
    const t0 = performance.now()
    let raf = 0
    const tick = (t: number) => {
      const k = Math.min(1, (t - t0) / ms)
      setV(Math.round(to * (1 - Math.pow(1 - k, 4))))
      if (k < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [to, ms])
  return <>{fmt(v)}</>
}

function Rays({ color, speed = 14 }: { color: string; speed?: number }) {
  return (
    <div className="pointer-events-none absolute left-1/2 top-1/2 size-[190vmax] -translate-x-1/2 -translate-y-1/2 opacity-50">
      <div
        className="size-full rounded-full"
        style={{
          background: `repeating-conic-gradient(${color} 0 5deg, transparent 5deg 15deg)`,
          maskImage: 'radial-gradient(circle, #000 4%, transparent 40%)',
          WebkitMaskImage: 'radial-gradient(circle, #000 4%, transparent 40%)',
          animation: `rays ${speed}s linear infinite`,
        }}
      />
    </div>
  )
}

function Shockwave({ color }: { color: string }) {
  return (
    <>
      {[0, 0.18, 0.36].map((d) => (
        <motion.div key={d} className="pointer-events-none absolute left-1/2 top-1/2 size-[40vmin] -translate-x-1/2 -translate-y-1/2 rounded-full border-4"
          style={{ borderColor: color }} initial={{ scale: 0.1, opacity: 0.9 }} animate={{ scale: 5, opacity: 0 }} transition={{ duration: 1.6, delay: d + 0.35, ease: 'easeOut' }} />
      ))}
    </>
  )
}

export function Cinematic({ ev, onDone }: { ev: CineEvent | null; onDone: () => void }) {
  const [shot, setShot] = useState(0)
  const dur = ev ? (ev.kind === 'ultra' ? 6200 : ev.kind === 'mega' ? 4200 : 3200) : 0
  useEffect(() => {
    if (!ev) return
    setShot(Date.now())
    if (ev.kind === 'ultra') {
      sfx('boom')
      setTimeout(() => sfx('gold'), 450)
      setTimeout(() => sfx('win'), 1300)
    } else if (ev.kind === 'mega') {
      sfx('boom')
      setTimeout(() => sfx('rare'), 350)
    } else sfx(ev.kind === 'zero' ? 'sell' : 'win')
    const t = setTimeout(onDone, dur)
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onDone()
    window.addEventListener('keydown', esc)
    return () => {
      clearTimeout(t)
      window.removeEventListener('keydown', esc)
    }
  }, [ev]) // eslint-disable-line react-hooks/exhaustive-deps

  const t = useMemo(() => (ev ? itemTitle(ev.item) : null), [ev])
  const reduce = reducedMotion()
  const gold = '#ffc93c'
  return (
    <AnimatePresence>
      {ev && t && (
        <motion.div key={shot} className="pointer-events-none fixed inset-0 z-[80] overflow-hidden" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.35 }} data-testid={'cine-' + ev.kind}>
          <Confetti fire={shot} colors={ev.kind === 'ultra' || ev.kind === 'mega' ? ['#ffe9a8', '#ffc93c', '#ff9a2e', '#ff3df0', '#ffffff'] : undefined} />
          <button aria-label="Закрыть" onClick={onDone} className="pointer-events-auto absolute right-4 top-4 z-10 grid size-10 place-items-center rounded-full bg-white/10 hover:bg-white/20"><X size={18} /></button>

          {(ev.kind === 'ultra' || ev.kind === 'mega') && (
            <>
              <motion.div className="absolute inset-0" style={{ background: 'radial-gradient(circle at 50% 45%, rgb(30 8 60 / .82), rgb(0 0 0 / .94) 70%)' }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} />
              <Rays color={ev.kind === 'ultra' ? '#ffcf4a' : rc(ev.item.rarity)} speed={ev.kind === 'ultra' ? 9 : 16} />
              {!reduce && <Shockwave color={ev.kind === 'ultra' ? gold : rc(ev.item.rarity)} />}
              {ev.kind === 'ultra' && !reduce && <motion.div className="absolute inset-0 bg-white" initial={{ opacity: 0.95 }} animate={{ opacity: 0 }} transition={{ duration: 0.9 }} />}
              <div className="absolute inset-0 flex flex-col items-center justify-center px-4 text-center" style={{ '--rc': rc(ev.item.rarity) } as CSSProperties}>
                <motion.div initial={{ scale: reduce ? 1 : 4, opacity: 0, letterSpacing: '0.6em' }} animate={{ scale: 1, opacity: 1, letterSpacing: '0.12em' }} transition={{ duration: 0.7, delay: 0.25, ease: EASE }}
                  className="display gold-text text-3xl font-black sm:text-6xl">{ev.kind === 'ultra' ? 'УЛЬТРА ДРОП' : 'ЗАЛЁТ'}</motion.div>
                <motion.div initial={{ scale: 0.1, rotate: reduce ? 0 : -25, opacity: 0 }} animate={{ scale: 1, rotate: 0, opacity: 1 }} transition={{ type: 'spring', stiffness: 150, damping: 12, delay: 0.5 }}
                  className="my-2 w-[min(86vw,620px)]" style={{ filter: `drop-shadow(0 0 40px ${rc(ev.item.rarity)})` }}>
                  <ItemArt i={ev.item} className="w-full" />
                </motion.div>
                <motion.div initial={{ y: 30, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 1, duration: 0.6, ease: EASE }}>
                  <div className="text-sm text-mute">{t.weapon}{t.phase && ` · ${t.phase}`}</div>
                  <div className="display text-xl font-extrabold sm:text-3xl" style={{ color: rc(ev.item.rarity) }}>{t.skin} <span className="text-xs text-mute">{RARITIES[ev.item.rarity].name}</span></div>
                  <div className="display gold-text mt-1 text-4xl font-black tabular-nums sm:text-6xl"><Counter to={ev.item.price} ms={2200} /></div>
                  {ev.item.x ? <div className="mt-1 text-lg font-extrabold text-ok">x{(ev.item.x / 100).toFixed(ev.item.x >= 10000 ? 0 : 1)}</div> : null}
                </motion.div>
              </div>
            </>
          )}

          {ev.kind === 'trio' && (
            <div className="absolute inset-0 grid place-items-center bg-black/55 px-4">
              <div className="text-center">
                <motion.div initial={{ scale: 3, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ duration: 0.5, ease: EASE }} className="display gold-text text-3xl font-black sm:text-5xl">ТРОЙНЯШКИ ×{ev.count}</motion.div>
                <div className="relative mx-auto mt-3 h-36 w-[min(80vw,420px)]">
                  {[-1, 0, 1].map((k) => (
                    <motion.div key={k} className="absolute left-1/2 top-0 w-40 -translate-x-1/2" initial={{ x: 0, rotate: 0, opacity: 0 }} animate={{ x: k * 110, rotate: k * 9, opacity: 1 }} transition={{ delay: 0.3, duration: 0.6, ease: EASE }}>
                      <ItemArt i={ev.item} className="w-full" />
                    </motion.div>
                  ))}
                </div>
                <div className="mt-2 text-sm text-mute">{t.weapon} | {t.skin}</div>
              </div>
            </div>
          )}

          {ev.kind === 'seven' && (
            <div className="absolute inset-0 grid place-items-center bg-black/55">
              <div className="text-center">
                <div className="flex justify-center gap-2">
                  {[0, 1, 2].map((k) => (
                    <div key={k} className="grid h-24 w-20 place-items-center overflow-hidden rounded-2xl border-2 border-gold/70 bg-black/60 sm:h-32 sm:w-28">
                      <motion.div initial={{ y: reduce ? 0 : '-300%' }} animate={{ y: 0 }} transition={{ delay: 0.15 + k * 0.4, duration: 0.7, ease: EASE }} className="display gold-text text-6xl font-black sm:text-8xl">7</motion.div>
                    </div>
                  ))}
                </div>
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.5 }} className="display mt-3 text-lg font-extrabold sm:text-2xl">Счастливая семёрка</motion.div>
              </div>
            </div>
          )}

          {ev.kind === 'zero' && (
            <div className="absolute inset-0 grid place-items-center bg-black/45">
              <motion.div initial={{ scale: 3, rotate: -18, opacity: 0 }} animate={{ scale: 1, rotate: -8, opacity: 1 }} transition={{ type: 'spring', stiffness: 260, damping: 14 }}
                className="display rounded-xl border-4 border-ok px-6 py-3 text-3xl font-black uppercase text-ok sm:text-5xl">Ровно в ноль</motion.div>
            </div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  )
}
