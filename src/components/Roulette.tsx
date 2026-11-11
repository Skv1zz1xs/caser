import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { animate, motion, useMotionValue } from 'framer-motion'
import { Star } from 'lucide-react'
import type { CaseDef } from '../shared/catalog'
import { CATALOG } from '../shared/catalog'
import { fmtShort } from '../shared/money'
import { sfx } from '../audio/sfx'
import { ItemArt, cx, rc, reducedMotion } from './ui'

export interface Cell { item: string; phase: number; rarity: number; fi: number; st: boolean; price: number }

const CELLS = 58
const WIN = 50

/** Случайная ячейка для ленты (редкое показываем чаще, чем оно реально падает — чисто визуально). */
function randomCell(c: CaseDef): Cell {
  const total = c.outcomes.reduce((a, o) => a + Math.pow(o.weight, 0.55), 0)
  let r = Math.random() * total
  let o = c.outcomes[0]
  for (const x of c.outcomes) {
    r -= Math.pow(x.weight, 0.55)
    if (r <= 0) {
      o = x
      break
    }
  }
  return { item: o.itemId, phase: o.phase, rarity: CATALOG.itemById.get(o.itemId)!.rarity, fi: 3000, st: false, price: o.price }
}

function buildStrip(c: CaseDef, win: Cell | null): Cell[] {
  const cells = Array.from({ length: CELLS }, () => randomCell(c))
  if (win) {
    cells[WIN] = win
    // интрига: рядом с выигрышной ячейкой иногда лежит что-то дорогое
    if (Math.random() < 0.45) {
      const rare = c.outcomes.filter((o) => CATALOG.itemById.get(o.itemId)!.rarity >= 4)
      if (rare.length) {
        const o = rare[Math.floor(Math.random() * rare.length)]
        cells[WIN + (Math.random() < 0.5 ? 1 : -1)] = { item: o.itemId, phase: o.phase, rarity: CATALOG.itemById.get(o.itemId)!.rarity, fi: 1000, st: false, price: o.price }
      }
    }
  }
  return cells
}

const CellView = memo(function CellView({ cell, w, h, hide, win }: { cell: Cell; w: number; h: number; hide: boolean; win: boolean }) {
  const special = cell.rarity === 6 && hide
  return (
    <div className="shrink-0 p-[3px]" style={{ width: w, height: h }}>
      <div
        className={cx('item-card h-full w-full grid place-items-center', win && 'ring-2 ring-white/80')}
        style={{ '--rc': special ? '#ffc93c' : rc(cell.rarity) } as CSSProperties}
      >
        {special ? (
          <Star size={h * 0.42} className="text-gold drop-shadow-[0_0_10px_rgba(255,201,60,.8)]" fill="currentColor" />
        ) : (
          <ItemArt i={cell} className="h-[78%] w-[92%]" />
        )}
        {win && h > 70 && <div className="absolute bottom-1.5 z-10 rounded bg-[#0b1226]/80 px-1.5 text-[10px] font-extrabold">{fmtShort(cell.price)}</div>}
      </div>
    </div>
  )
})

/**
 * Лента кейса. При смене spinId с непустым result — крутится и останавливается на result.
 * «Недокрут»: остановка случайно смещена к краю ячейки, затем лента мягко доезжает до центра.
 */
export function Roulette({
  c, result, spinId, fast, height = 132, ticks = true, onDone,
}: { c: CaseDef; result: Cell | null; spinId: number; fast: boolean; height?: number; ticks?: boolean; onDone?: () => void }) {
  const wrap = useRef<HTMLDivElement>(null)
  const x = useMotionValue(0)
  const [revealed, setRevealed] = useState(true)
  const [width, setWidth] = useState(0)
  const cw = Math.round(height * 1.08)
  const cells = useMemo(() => buildStrip(c, result), [c, spinId]) // eslint-disable-line react-hooks/exhaustive-deps

  useLayoutEffect(() => {
    const el = wrap.current!
    const ro = new ResizeObserver(() => setWidth(el.clientWidth))
    ro.observe(el)
    setWidth(el.clientWidth)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    if (!width) return
    const center = width / 2
    if (!result || !spinId) {
      x.set(center - cw * 3.5)
      setRevealed(true)
      return
    }
    setRevealed(false)
    const reduce = reducedMotion()
    const off = 0.12 + Math.random() * 0.76 // где внутри ячейки остановится указатель
    const stop = center - (WIN * cw + off * cw)
    const final = center - (WIN * cw + cw / 2)
    x.set(center - cw * 3.5)
    let last = -1
    const dur = reduce ? 0.2 : fast ? 1.15 : 5.4
    const a = animate(x, stop, {
      duration: dur,
      ease: [0.1, 0.62, 0.06, 1],
      onUpdate: (v) => {
        if (!ticks) return
        const idx = Math.floor((center - v) / cw)
        if (idx !== last) {
          last = idx
          sfx('tick', 0.9 + Math.min(0.5, idx / CELLS))
        }
      },
      onComplete: () => {
        animate(x, final, { duration: reduce ? 0.01 : 0.38, ease: 'easeOut', delay: reduce || fast ? 0 : 0.18 }).then(() => {
          setRevealed(true)
          onDone?.()
        })
      },
    })
    return () => a.stop()
  }, [spinId, width]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div ref={wrap} className="relative overflow-hidden rounded-2xl bg-black/35 border border-line" style={{ height }}>
      <motion.div className="flex will-change-transform" style={{ x, width: CELLS * cw }}>
        {cells.map((cell, i) => (
          <CellView key={i} cell={cell} w={cw} h={height} hide={!revealed} win={revealed && !!result && !!spinId && i === WIN} />
        ))}
      </motion.div>
      {/* затемнение краёв и указатель */}
      <div className="pointer-events-none absolute inset-y-0 left-0 w-[18%] bg-gradient-to-r from-bg to-transparent" />
      <div className="pointer-events-none absolute inset-y-0 right-0 w-[18%] bg-gradient-to-l from-bg to-transparent" />
      <div className="pointer-events-none absolute inset-y-0 left-1/2 w-[2px] -translate-x-1/2 bg-gold/60 shadow-[0_0_12px_2px_rgba(255,201,60,.6)]" />
      <div className="pointer-events-none absolute left-1/2 top-0 -translate-x-1/2 border-x-[7px] border-t-[9px] border-x-transparent border-t-gold" />
      <div className="pointer-events-none absolute left-1/2 bottom-0 -translate-x-1/2 border-x-[7px] border-b-[9px] border-x-transparent border-b-gold" />
    </div>
  )
}
