import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { Link, NavLink, useLocation } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import {
  Backpack, CloudRain, Coins, FileSignature, Gift, LayoutGrid, Menu, MessageCircle, Send, ShieldCheck, Swords, TrendingUp, Trophy, User,
  Volume2, VolumeX, X, Award, TriangleAlert,
} from 'lucide-react'
import { BONUS } from '../config/economy'
import { CATALOG } from '../shared/catalog'
import { fmtShort } from '../shared/money'
import { rpc } from '../lib/api'
import { useGame } from '../store/game'
import { sfx } from '../audio/sfx'
import { Avatar, Btn, ItemArt, Money, cx, mmss, rc, useNow } from './ui'

const NAV = [
  { to: '/', label: 'Кейсы', icon: LayoutGrid, end: true },
  { to: '/battles', label: 'Батлы', icon: Swords },
  { to: '/upgrade', label: 'Апгрейд', icon: TrendingUp },
  { to: '/contracts', label: 'Контракты', icon: FileSignature },
  { to: '/coinflip', label: 'Коинфлип', icon: Coins },
  { to: '/pass', label: 'Пасс', icon: Award },
  { to: '/top', label: 'Топ', icon: Trophy },
  { to: '/inventory', label: 'Инвентарь', icon: Backpack },
]
const MOBILE = [NAV[0], NAV[1], NAV[2], NAV[7]]

function Logo() {
  return (
    <Link to="/" className="flex items-center gap-2 shrink-0" onClick={() => sfx('click')}>
      <svg width="30" height="30" viewBox="0 0 64 64">
        <defs><linearGradient id="lg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#ffe9a8" /><stop offset="1" stopColor="#ff6a18" /></linearGradient></defs>
        <rect width="64" height="64" rx="16" fill="#12141c" stroke="url(#lg)" strokeWidth="2" />
        <path d="M14 18h36L28 40h22v8H14l22-22H14z" fill="url(#lg)" />
      </svg>
      <span className="display text-lg font-black tracking-tight gold-text hidden min-[400px]:inline">ЗАЛЁТ</span>
    </Link>
  )
}

function BonusChip() {
  const me = useGame((s) => s.me)!
  const now = useNow()
  const free = (me.free_case_at ?? 0) + BONUS.freeCase.cooldownMin * 60000 - now
  const daily = (me.daily_at ?? 0) + BONUS.daily.cooldownHours * 3600000 - now
  const ready = free <= 0 || daily <= 0
  return (
    <Link to="/bonus" data-testid="bonus-chip" className={cx('glass flex h-10 items-center gap-1.5 rounded-xl px-3 text-xs font-bold', ready ? 'text-gold pulse-ring border-gold/40' : 'text-mute')}>
      <Gift size={16} />
      <span className="hidden sm:inline">{ready ? 'Бонус ждёт' : mmss(Math.min(free, daily))}</span>
    </Link>
  )
}

function Header() {
  const me = useGame((s) => s.me)!
  const sound = useGame((s) => s.sound)
  const setG = useGame((s) => s.set)
  const unread = useGame((s) => s.unread)
  const online = useGame((s) => s.online)
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-bg/80 backdrop-blur-xl">
      <div className="mx-auto flex h-14 max-w-[1500px] items-center gap-2 px-3 sm:px-5">
        <Logo />
        <nav className="ml-3 hidden lg:flex items-center gap-0.5">
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} onClick={() => sfx('click')}
              className={({ isActive }) => cx('flex h-10 items-center gap-1.5 rounded-xl px-2.5 text-[13px] font-bold transition', isActive ? 'bg-white/10 text-white' : 'text-mute hover:text-white')}>
              <n.icon size={15} />{n.label}
            </NavLink>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
          <span className="hidden md:flex items-center gap-1.5 text-[11px] text-mute"><span className="size-1.5 rounded-full bg-ok" />онлайн {online}</span>
          <BonusChip />
          <div className="glass flex h-10 items-center rounded-xl px-3" data-testid="balance" data-value={me.balance}>
            <Money v={me.balance} className="display text-sm font-extrabold" size={15} />
          </div>
          <button aria-label="Звук" onClick={() => setG({ sound: !sound })} className="hidden sm:grid size-10 place-items-center rounded-xl glass text-mute hover:text-white">
            {sound ? <Volume2 size={16} /> : <VolumeX size={16} />}
          </button>
          <button aria-label="Чат" data-testid="chat-toggle" onClick={() => setG({ chatOpen: !useGame.getState().chatOpen, unread: 0 })} className="relative grid size-10 place-items-center rounded-xl glass text-mute hover:text-white xl:hidden">
            <MessageCircle size={16} />
            {unread > 0 && <span className="absolute -right-1 -top-1 grid min-w-4 h-4 place-items-center rounded-full bg-bad px-1 text-[9px] font-black text-white">{unread > 9 ? '9+' : unread}</span>}
          </button>
          <Link to="/profile" aria-label="Профиль" className="shrink-0"><Avatar n={me.avatar} size={36} /></Link>
        </div>
      </div>
      <FeedTicker />
    </header>
  )
}

/** Бегущая лента дропов всех игроков. */
function FeedTicker() {
  const feed = useGame((s) => s.feed)
  const items = feed.filter((f) => f.kind === 'drop' || f.kind === 'upgrade' || f.kind === 'contract').slice(-24).reverse()
  if (!items.length) return <div className="h-[46px] border-t border-line grid place-items-center text-[11px] text-mute">Здесь появятся дропы всех игроков</div>
  return (
    <div className="flex h-[46px] items-center gap-1.5 overflow-hidden border-t border-line px-2" data-testid="feed">
      <span className="flex shrink-0 items-center gap-1 pr-1 text-[10px] font-black uppercase tracking-wider text-bad"><span className="size-1.5 animate-pulse rounded-full bg-bad" />live</span>
      <AnimatePresence initial={false}>
        {items.map((f) => {
          const d = f.data
          const def = CATALOG.itemById.get(d.item)
          return (
            <motion.div key={f.id} layout initial={{ opacity: 0, x: -40, scale: 0.9 }} animate={{ opacity: 1, x: 0, scale: 1 }} transition={{ duration: 0.3 }}
              className="item-card flex h-9 shrink-0 items-center gap-1.5 !rounded-lg pl-1 pr-2" style={{ '--rc': rc(d.rarity) } as CSSProperties} title={`${f.nick}: ${def?.name}`}>
              <ItemArt i={{ item: d.item, phase: d.phase, fi: d.fi }} className="h-7 w-10" />
              <div className="leading-none">
                <div className="max-w-20 truncate text-[10px] font-bold">{f.nick}</div>
                <div className="text-[10px] font-extrabold text-gold">{fmtShort(d.price)}</div>
              </div>
            </motion.div>
          )
        })}
      </AnimatePresence>
    </div>
  )
}

function RainBanner() {
  const rain = useGame((s) => s.rain)
  const run = useGame((s) => s.run)
  const now = useNow()
  if (!rain?.active) return null
  const join = async () => {
    const r = await run(() => rpc<{ rain: any }>('rain_join'))
    if (r) {
      sfx('rain')
      useGame.setState({ rain: r.rain })
      useGame.getState().toast('Ты под дождём — монеты упадут, когда он закончится', 'ok')
    }
  }
  return (
    <div className="mx-3 mb-2 flex items-center gap-2 rounded-2xl border border-r1/40 bg-r1/15 p-2.5" data-testid="rain">
      <CloudRain className="shrink-0 text-r1" size={22} />
      <div className="min-w-0 flex-1 text-xs leading-tight">
        <div className="font-extrabold">Дождь: <Money v={rain.pot} size={11} /> на всех</div>
        <div className="text-mute">ещё {mmss(rain.ends_at - now)} · под дождём {rain.joiners}</div>
      </div>
      <Btn kind={rain.joined ? 'soft' : 'gold'} disabled={rain.joined} onClick={join} className="!min-h-9 !px-3 text-xs" testId="rain-join">{rain.joined ? 'Ты в деле' : 'Под дождь'}</Btn>
    </div>
  )
}

export function Chat() {
  const chat = useGame((s) => s.chat)
  const me = useGame((s) => s.me)!
  const run = useGame((s) => s.run)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const lastId = chat.at(-1)?.id
  useEffect(() => {
    box.current?.scrollTo({ top: box.current.scrollHeight })
  }, [lastId])
  const send = async () => {
    const t = text.trim()
    if (!t || busy) return
    setBusy(true)
    const ok = await run(() => rpc('chat_send', { p_text: t }))
    setBusy(false)
    if (ok) {
      setText('')
      void useGame.getState().sync()
    }
  }
  return (
    <div className="flex h-full min-h-0 flex-col">
      <RainBanner />
      <div ref={box} className="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 pb-2" data-testid="chat-list">
        {chat.length === 0 && <div className="py-8 text-center text-xs text-mute">Тут пока тихо. Напиши первым!</div>}
        {chat.map((m) =>
          m.kind === 'system' ? (
            <div key={m.id} className="rounded-xl bg-gold/10 px-3 py-1.5 text-center text-[11px] font-semibold text-gold">{m.body}</div>
          ) : (
            <div key={m.id} className="flex gap-2">
              <Link to={'/profile/' + encodeURIComponent(m.nick)}><Avatar n={m.avatar} size={28} /></Link>
              <div className="min-w-0">
                <div className="flex items-baseline gap-1.5 text-[11px]">
                  <span className={cx('font-extrabold', m.pid === me.id ? 'text-gold' : 'text-white')}>{m.nick}</span>
                  <span className="rounded bg-white/10 px-1 text-[9px] font-bold text-mute">ур. {m.level}</span>
                </div>
                <div className="break-words text-[13px] leading-snug text-white/90">{m.body}</div>
              </div>
            </div>
          ),
        )}
      </div>
      <form className="flex gap-2 border-t border-line p-3" onSubmit={(e) => { e.preventDefault(); void send() }}>
        <input value={text} onChange={(e) => setText(e.target.value)} maxLength={200} placeholder="Сообщение…" data-testid="chat-input"
          className="h-11 min-w-0 flex-1 rounded-xl border border-line bg-white/5 px-3 text-sm outline-none focus:border-gold/50" />
        <button aria-label="Отправить" data-testid="chat-send" disabled={busy || !text.trim()} className="btn-gold grid size-11 shrink-0 place-items-center rounded-xl disabled:opacity-50"><Send size={16} /></button>
      </form>
    </div>
  )
}

function MoreSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const sound = useGame((s) => s.sound)
  const setG = useGame((s) => s.set)
  const extra = [NAV[3], NAV[4], NAV[5], NAV[6], { to: '/bonus', label: 'Бонусы', icon: Gift }, { to: '/profile', label: 'Профиль', icon: User }, { to: '/fair', label: 'Честность', icon: ShieldCheck }]
  return (
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-40 bg-black/60 lg:hidden" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
          <motion.div className="glass absolute inset-x-0 bottom-0 rounded-t-3xl bg-panel/95 p-4 pb-24" initial={{ y: 300 }} animate={{ y: 0 }} exit={{ y: 300 }} transition={{ duration: 0.2 }}>
            <div className="grid grid-cols-3 gap-2">
              {extra.map((n) => (
                <Link key={n.to} to={n.to} onClick={onClose} className="flex flex-col items-center gap-1.5 rounded-2xl bg-white/6 py-4 text-xs font-bold">
                  <n.icon size={22} className="text-gold" />{n.label}
                </Link>
              ))}
              <button onClick={() => setG({ sound: !sound })} className="flex flex-col items-center gap-1.5 rounded-2xl bg-white/6 py-4 text-xs font-bold">
                {sound ? <Volume2 size={22} className="text-gold" /> : <VolumeX size={22} className="text-mute" />}Звук {sound ? 'вкл' : 'выкл'}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

function BottomNav() {
  const [more, setMore] = useState(false)
  const loc = useLocation()
  useEffect(() => {
    setMore(false)
  }, [loc.pathname])
  return (
    <>
      <MoreSheet open={more} onClose={() => setMore(false)} />
      <nav className="safe-b fixed inset-x-0 bottom-0 z-40 border-t border-line bg-bg/90 backdrop-blur-xl lg:hidden" data-testid="bottom-nav">
        <div className="grid h-16 grid-cols-5">
          {MOBILE.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} onClick={() => sfx('click')}
              className={({ isActive }) => cx('flex flex-col items-center justify-center gap-1 text-[10px] font-bold', isActive ? 'text-gold' : 'text-mute')}>
              <n.icon size={21} />{n.label}
            </NavLink>
          ))}
          <button onClick={() => setMore((m) => !m)} data-testid="more" className={cx('flex flex-col items-center justify-center gap-1 text-[10px] font-bold', more ? 'text-gold' : 'text-mute')}>
            {more ? <X size={21} /> : <Menu size={21} />}Ещё
          </button>
        </div>
      </nav>
    </>
  )
}

export function Layout({ children }: { children: ReactNode }) {
  const chatOpen = useGame((s) => s.chatOpen)
  const setG = useGame((s) => s.set)
  const mismatch = useGame((s) => s.versionMismatch)
  return (
    <div className="min-h-dvh">
      <Header />
      {mismatch && (
        <div className="flex items-center justify-center gap-2 bg-bad/20 px-3 py-2 text-center text-xs font-semibold text-bad" data-testid="mismatch">
          <TriangleAlert size={14} />Экономика на сервере и в клиенте разной версии: выполни свежий supabase/seed.sql и обнови страницу.
        </div>
      )}
      <div className="mx-auto flex max-w-[1500px] gap-5 px-3 sm:px-5">
        <main className="min-w-0 flex-1 pb-24 pt-4 lg:pb-10">{children}</main>
        <aside className="sticky top-[118px] my-4 hidden h-[calc(100dvh-134px)] w-[310px] shrink-0 flex-col overflow-hidden rounded-3xl glass xl:flex">
          <div className="display flex items-center gap-2 px-4 py-3 text-sm font-bold"><MessageCircle size={15} className="text-gold" />Чат</div>
          <Chat />
        </aside>
      </div>
      <AnimatePresence>
        {chatOpen && (
          <motion.div className="fixed inset-0 z-50 flex flex-col bg-bg xl:hidden" initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }} transition={{ duration: 0.22 }}>
            <div className="display flex items-center justify-between border-b border-line px-4 py-3 text-sm font-bold">
              <span className="flex items-center gap-2"><MessageCircle size={15} className="text-gold" />Чат</span>
              <button aria-label="Закрыть чат" onClick={() => setG({ chatOpen: false })} className="grid size-9 place-items-center rounded-full hover:bg-white/10"><X size={18} /></button>
            </div>
            <div className="min-h-0 flex-1 pt-2"><Chat /></div>
          </motion.div>
        )}
      </AnimatePresence>
      <BottomNav />
    </div>
  )
}
