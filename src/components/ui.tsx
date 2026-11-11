import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import * as L from 'lucide-react'
import { COUNTER, PHASES, RARITIES, WEAR } from '../config/economy'
import { CATALOG, type CaseDef } from '../shared/catalog'
import { fmt, fmtShort, wearIndex } from '../shared/money'
import { itemImage } from '../art/item'
import { useGame } from '../store/game'

export const rc = (rarity: number) => RARITIES[rarity]?.color ?? '#888'
export const cx = (...a: (string | false | null | undefined)[]) => a.filter(Boolean).join(' ')
export const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

/* ------------------------------ монеты ---------------------------------- */
export function Coin({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" className="inline-block shrink-0 align-[-2px]">
      <defs>
        <linearGradient id="cg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ffe9a8" />
          <stop offset="1" stopColor="#ff8a1c" />
        </linearGradient>
      </defs>
      <circle cx="10" cy="10" r="9" fill="url(#cg)" />
      <path d="M6 6h8l-5 5h5v3H6l5-5H6z" fill="#5a2c00" opacity=".85" />
    </svg>
  )
}
export function Money({ v, short, className, size }: { v: number; short?: boolean; className?: string; size?: number }) {
  return (
    <span className={cx('inline-flex items-center gap-1 tabular-nums whitespace-nowrap', className)}>
      <Coin size={size} />
      {short ? fmtShort(v) : fmt(v)}
    </span>
  )
}

/* ------------------------------ кнопки ---------------------------------- */
export function Btn({
  children, onClick, disabled, kind = 'soft', className, busy, title, testId,
}: {
  children: ReactNode; onClick?: () => void; disabled?: boolean; kind?: 'gold' | 'soft' | 'ghost' | 'danger'
  className?: string; busy?: boolean; title?: string; testId?: string
}) {
  const base = 'inline-flex items-center justify-center gap-2 rounded-xl px-4 min-h-11 text-sm font-bold transition active:scale-[0.97] disabled:opacity-50 select-none'
  const kinds = {
    gold: 'btn-gold',
    soft: 'bg-white/8 hover:bg-white/14 border border-white/10',
    ghost: 'hover:bg-white/8 text-mute hover:text-white',
    danger: 'bg-bad/15 hover:bg-bad/25 border border-bad/30 text-bad',
  }
  return (
    <button data-testid={testId} title={title} className={cx(base, kinds[kind], className)} disabled={disabled || busy} onClick={onClick}>
      {busy ? <L.LoaderCircle size={16} className="animate-spin" /> : children}
    </button>
  )
}

/* ------------------------------ аватар ---------------------------------- */
const AV_ICONS = ['Ghost', 'Cat', 'Dog', 'Bird', 'Fish', 'Bug', 'Rabbit', 'Squirrel', 'Turtle', 'Snail', 'Skull', 'Rocket', 'Flame', 'Zap', 'Crown', 'Gem',
  'Pizza', 'Banana', 'Cherry', 'Cookie', 'Gamepad2', 'Headphones', 'Glasses', 'Anchor'] as const
export function Avatar({ n, size = 32, ring }: { n: number; size?: number; ring?: string }) {
  const i = ((n % AV_ICONS.length) + AV_ICONS.length) % AV_ICONS.length
  const Icon = (L as any)[AV_ICONS[i]] as L.LucideIcon
  const h = (i * 47) % 360
  return (
    <span
      className="inline-grid place-items-center rounded-full shrink-0"
      style={{ width: size, height: size, background: `linear-gradient(135deg, hsl(${h} 80% 58%), hsl(${(h + 60) % 360} 75% 38%))`, boxShadow: ring ? `0 0 0 2px ${ring}` : 'inset 0 0 0 1px rgb(255 255 255 / .25)' }}
    >
      <Icon size={size * 0.56} color="#fff" strokeWidth={2.2} />
    </span>
  )
}

/* ------------------------------ предмет --------------------------------- */
export interface ItemLike { item: string; phase: number; rarity: number; fi: number; st: boolean; price: number; case?: string }

export function itemTitle(i: ItemLike) {
  const d = CATALOG.itemById.get(i.item)
  return { weapon: d?.weapon ?? '?', skin: d?.skin ?? '?', phase: PHASES[i.phase]?.name ?? '', wear: WEAR[wearIndex(i.fi)] }
}

export function ItemArt({ i, className }: { i: { item: string; phase: number; fi: number }; className?: string }) {
  return <img src={itemImage(i.item, i.phase, wearIndex(i.fi))} alt="" loading="lazy" draggable={false} className={cx('object-contain', className)} />
}

export function ItemCard({
  i, selected, onClick, compact, footer, dim, badge,
}: { i: ItemLike; selected?: boolean; onClick?: () => void; compact?: boolean; footer?: ReactNode; dim?: boolean; badge?: ReactNode }) {
  const t = itemTitle(i)
  const special = i.phase >= 2
  return (
    <div
      onClick={onClick}
      className={cx('item-card flex flex-col', selected && 'sel', onClick && 'cursor-pointer hover:brightness-125 transition', dim && 'opacity-40', special && 'shine')}
      style={{ '--rc': rc(i.rarity) } as CSSProperties}
    >
      <div className="flex items-center justify-between px-2 pt-1.5 text-[10px] font-bold text-mute leading-none h-4">
        <span>{t.wear.short}</span>
        <span className="flex gap-1">
          {i.st && <span className="rounded bg-fire/25 px-1 text-fire" title={COUNTER.name}>{COUNTER.short}</span>}
          {t.phase && <span className="rounded bg-gold/20 px-1 text-gold">{t.phase}</span>}
          {badge}
        </span>
      </div>
      <ItemArt i={i} className={cx('w-full px-1', compact ? 'h-12' : 'h-16 sm:h-20')} />
      <div className="px-2 pb-2 pt-0.5 min-w-0">
        <div className="truncate text-[10px] text-mute leading-tight">{t.weapon}</div>
        <div className="truncate text-xs font-bold leading-tight">{t.skin}</div>
        <div className="mt-1 flex items-center justify-between gap-1 text-xs font-extrabold">
          <Money v={i.price} short size={12} />
        </div>
        {footer}
      </div>
    </div>
  )
}

/* ------------------------------ обложка кейса --------------------------- */
export function CaseCover({ c, size = 120 }: { c: CaseDef; size?: number }) {
  const Icon = ((L as any)[c.icon] ?? L.Package) as L.LucideIcon
  const [a, b] = c.colors
  const id = 'cc-' + c.id
  const elite = c.category === 'elite'
  const risk = c.category === 'risk'
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <div className="absolute inset-[8%] rounded-full blur-2xl opacity-60" style={{ background: a }} />
      <svg viewBox="0 0 120 120" width={size} height={size} className="relative">
        <defs>
          <linearGradient id={id + 'a'} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor={a} />
            <stop offset="1" stopColor={b} />
          </linearGradient>
          <linearGradient id={id + 'b'} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#fff" stopOpacity=".35" />
            <stop offset=".5" stopColor="#fff" stopOpacity="0" />
            <stop offset="1" stopColor="#000" stopOpacity=".45" />
          </linearGradient>
          <pattern id={id + 'h'} width="10" height="10" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="5" height="10" fill="#000" opacity=".35" />
          </pattern>
        </defs>
        {/* крышка */}
        <path d="M14 46L30 26h60l16 20Z" fill={`url(#${id}a)`} />
        <path d="M14 46L30 26h60l16 20Z" fill="#000" opacity=".28" />
        {/* корпус */}
        <rect x="12" y="44" width="96" height="58" rx="8" fill={`url(#${id}a)`} />
        {risk && <rect x="12" y="44" width="96" height="58" rx="8" fill={`url(#${id}h)`} />}
        <rect x="12" y="44" width="96" height="58" rx="8" fill={`url(#${id}b)`} />
        <rect x="12" y="44" width="96" height="10" rx="5" fill="#000" opacity=".3" />
        <rect x="24" y="44" width="7" height="58" fill="#000" opacity=".22" />
        <rect x="89" y="44" width="7" height="58" fill="#000" opacity=".22" />
        <rect x="12.5" y="44.5" width="95" height="57" rx="7.5" fill="none" stroke={elite ? '#ffe9a8' : '#fff'} strokeOpacity={elite ? 0.9 : 0.3} strokeWidth={elite ? 1.6 : 1} />
        {/* замок */}
        <rect x="50" y="38" width="20" height="16" rx="4" fill="#12141c" stroke={elite ? '#ffd76a' : '#fff'} strokeOpacity=".7" />
        <circle cx="60" cy="46" r="2.5" fill={elite ? '#ffd76a' : '#fff'} />
      </svg>
      <div className="absolute inset-x-0 top-[47%] bottom-[14%] grid place-items-center">
        <Icon size={size * 0.3} color="#fff" strokeWidth={2} style={{ filter: 'drop-shadow(0 2px 6px rgb(0 0 0 / .6))' }} />
      </div>
      {elite && <div className="absolute inset-0 shine rounded-2xl pointer-events-none" />}
    </div>
  )
}

/* ------------------------------ модалка --------------------------------- */
export function Modal({ open, onClose, children, title, wide }: { open: boolean; onClose: () => void; children: ReactNode; title?: ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!open) return
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [open, onClose])
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 grid place-items-end sm:place-items-center bg-black/70 backdrop-blur-sm"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}
        >
          <motion.div
            className={cx('glass w-full rounded-t-3xl sm:rounded-3xl bg-panel/95 max-h-[92dvh] overflow-y-auto', wide ? 'sm:max-w-3xl' : 'sm:max-w-lg')}
            initial={{ y: 40, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 40, opacity: 0 }} transition={{ duration: 0.2 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sticky top-0 z-10 flex items-center justify-between gap-3 bg-panel/95 px-5 py-4 border-b border-line">
              <div className="display text-base font-bold">{title}</div>
              <button aria-label="Закрыть" onClick={onClose} className="grid size-9 place-items-center rounded-full hover:bg-white/10"><L.X size={18} /></button>
            </div>
            <div className="p-5">{children}</div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

/* ------------------------------ тосты ----------------------------------- */
export function Toasts() {
  const toasts = useGame((s) => s.toasts)
  const drop = useGame((s) => s.dropToast)
  const color = { ok: 'border-ok/40 text-ok', err: 'border-bad/50 text-bad', info: 'border-white/15', gold: 'border-gold/60 text-gold' }
  return (
    <div className="fixed left-1/2 top-16 z-[70] flex w-[min(92vw,420px)] -translate-x-1/2 flex-col gap-2 pointer-events-none">
      <AnimatePresence>
        {toasts.map((t) => (
          <motion.div
            key={t.id} layout initial={{ opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95 }}
            onClick={() => drop(t.id)} data-testid={'toast-' + t.kind}
            className={cx('glass pointer-events-auto rounded-2xl bg-panel/95 px-4 py-3 text-sm font-semibold shadow-2xl', color[t.kind])}
          >
            {t.text}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}

/* ------------------------------ конфетти -------------------------------- */
export function Confetti({ fire, colors }: { fire: number; colors?: string[] }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    if (!fire || reducedMotion()) return
    const cv = ref.current!
    const ctx = cv.getContext('2d')!
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    cv.width = innerWidth * dpr
    cv.height = innerHeight * dpr
    const cols = colors ?? ['#ffd76a', '#ff7a18', '#e23df0', '#52a8ff', '#3ddc97', '#ffffff']
    const ps = Array.from({ length: 130 }, () => ({
      x: cv.width / 2 + (Math.random() - 0.5) * cv.width * 0.3, y: cv.height * 0.45,
      vx: (Math.random() - 0.5) * 22 * dpr, vy: (-Math.random() * 20 - 6) * dpr,
      s: (4 + Math.random() * 6) * dpr, r: Math.random() * 6, c: cols[Math.floor(Math.random() * cols.length)],
    }))
    let raf = 0
    let frame = 0
    const tick = () => {
      ctx.clearRect(0, 0, cv.width, cv.height)
      for (const p of ps) {
        p.vy += 0.55 * dpr
        p.vx *= 0.985
        p.x += p.vx
        p.y += p.vy
        p.r += 0.2
        ctx.save()
        ctx.translate(p.x, p.y)
        ctx.rotate(p.r)
        ctx.fillStyle = p.c
        ctx.globalAlpha = Math.max(0, 1 - frame / 150)
        ctx.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2)
        ctx.restore()
      }
      if (++frame < 150) raf = requestAnimationFrame(tick)
      else ctx.clearRect(0, 0, cv.width, cv.height)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [fire, colors])
  return <canvas ref={ref} className="pointer-events-none fixed inset-0 z-[60] h-full w-full" />
}

/* ------------------------------ мелочи ---------------------------------- */
/** Тикает раз в секунду и возвращает серверное «сейчас». */
export function useNow(intervalMs = 1000): number {
  const now = useGame((s) => s.now)
  const [, set] = useState(0)
  useEffect(() => {
    const t = setInterval(() => set((x) => x + 1), intervalMs)
    return () => clearInterval(t)
  }, [intervalMs])
  return now()
}
export function mmss(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const pad = (n: number) => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(s % 60)}` : `${pad(m)}:${pad(s % 60)}`
}
export function Section({ title, right, children, className }: { title?: ReactNode; right?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cx('glass rounded-3xl p-4 sm:p-5', className)}>
      {(title || right) && (
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="display text-sm sm:text-base font-bold">{title}</h2>
          {right}
        </div>
      )}
      {children}
    </section>
  )
}
export function Bar({ v, max, color = 'var(--color-gold)' }: { v: number; max: number; color?: string }) {
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-white/8">
      <div className="h-full rounded-full transition-all duration-500" style={{ width: `${Math.min(100, max > 0 ? (v / max) * 100 : 0)}%`, background: color }} />
    </div>
  )
}
export function Empty({ icon: Icon = L.Package, children }: { icon?: L.LucideIcon; children: ReactNode }) {
  return (
    <div className="grid place-items-center gap-3 py-12 text-center text-mute">
      <Icon size={36} strokeWidth={1.5} />
      <div className="text-sm">{children}</div>
    </div>
  )
}
export function RarityName({ r }: { r: number }) {
  return <span style={{ color: rc(r) }} className="font-bold">{RARITIES[r]?.name}</span>
}
