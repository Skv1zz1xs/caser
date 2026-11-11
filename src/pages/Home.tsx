import { useState } from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Gift, ShieldCheck, Ticket } from 'lucide-react'
import { BONUS } from '../config/economy'
import { CATEGORIES, type CaseCategory } from '../config/cases'
import { CATALOG, type CaseDef } from '../shared/catalog'
import { useGame } from '../store/game'
import { sfx } from '../audio/sfx'
import { CaseCover, Money, cx, mmss, useNow } from '../components/ui'

function CaseTile({ c, tickets }: { c: CaseDef; tickets: number }) {
  const elite = c.category === 'elite'
  return (
    <motion.div whileHover={{ y: -4 }} transition={{ duration: 0.15 }}>
      <Link to={'/case/' + c.id} onClick={() => sfx('click')} data-testid={'case-' + c.id}
        className={cx('group relative flex flex-col items-center rounded-3xl border bg-gradient-to-b from-[#121a33] to-[#0a1024] px-2 pb-3 pt-2 text-center transition duration-300 hover:-translate-y-1', elite ? 'border-gold/50 shadow-[0_0_24px_rgb(255_201_60/.15)]' : 'border-[#2c4aa8]/40 hover:border-[#5b8cff]/70')}>
        {tickets > 0 && <span className="absolute right-2 top-2 z-10 flex items-center gap-1 rounded-full bg-ok/20 px-2 py-0.5 text-[10px] font-extrabold text-ok"><Ticket size={11} />×{tickets}</span>}
        <div className="-mt-3 -mb-1"><CaseCover c={c} size={150} /></div>
        <div className={cx('display mt-1 w-full truncate text-[13px] font-bold', elite && 'gold-text')}>{c.name}</div>
        <div className="w-full truncate text-[10px] text-mute">{c.tagline}</div>
        <div className="mt-2 flex items-center gap-2">
          <Money v={c.price} short className="rounded-lg bg-white/8 px-2.5 py-1 text-xs font-extrabold" size={12} />
          <span className="flex items-center gap-0.5 text-[10px] font-bold text-ok/80"><ShieldCheck size={10} />{(c.rtp * 100).toFixed(0)}%</span>
        </div>
      </Link>
    </motion.div>
  )
}

export default function Home() {
  const me = useGame((s) => s.me)!
  const [cat, setCat] = useState<CaseCategory | 'all'>('all')
  const now = useNow()
  const cases = CATALOG.cases.filter((c) => c.category !== 'free')
  const free = (me.free_case_at ?? 0) + BONUS.freeCase.cooldownMin * 60000 - now
  const groups = CATEGORIES.filter((g) => cat === 'all' || g.id === cat)
  return (
    <div className="space-y-5">
      <Link to="/case/free" data-testid="free-banner" className="glass shine relative flex items-center gap-4 overflow-hidden rounded-3xl border-ok/30 p-4">
        <div className="grid size-14 shrink-0 place-items-center rounded-2xl bg-ok/15 text-ok"><Gift size={30} /></div>
        <div className="min-w-0 flex-1">
          <div className="display text-base sm:text-lg font-extrabold">Халява каждые {BONUS.freeCase.cooldownMin} минут</div>
          <div className="text-xs text-mute">Бесплатный кейс — внутри бывает джекпот на миллион</div>
        </div>
        <div className={cx('display shrink-0 rounded-xl px-4 py-2.5 text-sm font-extrabold', free <= 0 ? 'btn-gold' : 'bg-white/8 text-mute')}>{free <= 0 ? 'Забрать' : mmss(free)}</div>
      </Link>

      <div className="no-scrollbar -mx-3 flex gap-2 overflow-x-auto px-3 sm:mx-0 sm:px-0">
        {[{ id: 'all' as const, name: 'Все' }, ...CATEGORIES].map((g) => (
          <button key={g.id} onClick={() => { sfx('click'); setCat(g.id) }}
            className={cx('h-10 shrink-0 rounded-xl px-4 text-sm font-bold transition', cat === g.id ? 'bg-white/14 text-gold' : 'glass text-mute hover:text-white')}>
            {g.name}
          </button>
        ))}
      </div>

      {groups.map((g) => (
        <section key={g.id}>
          <h2 className="display mb-3 text-base font-extrabold">{g.name}</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 2xl:grid-cols-6">
            {cases.filter((c) => c.category === g.id).map((c) => <CaseTile key={c.id} c={c} tickets={me.tickets[c.id] ?? 0} />)}
          </div>
        </section>
      ))}
    </div>
  )
}
