import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Award, Bot, Check, CloudRain, Coins, Gift, HeartPulse, Lock, Sparkles, Ticket, Trophy } from 'lucide-react'
import { BONUS, COIN, COINFLIP, PASS, QUESTS } from '../config/economy'
import { CATALOG, caseOf } from '../shared/catalog'
import { levelFromXp } from '../shared/progress'
import { fmt } from '../shared/money'
import { rpc, type Coinflip as Flip, type Me } from '../lib/api'
import { applyMe, useGame } from '../store/game'
import { sfx } from '../audio/sfx'
import { Avatar, Bar, Btn, CaseCover, Empty, ItemArt, Money, Section, cx, mmss, useNow } from '../components/ui'

/* =============================== БОНУСЫ ================================= */
export function Bonus() {
  const me = useGame((s) => s.me)!
  const rain = useGame((s) => s.rain)
  const run = useGame((s) => s.run)
  const now = useNow()
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState('')
  const free = (me.free_case_at ?? 0) + BONUS.freeCase.cooldownMin * 60000 - now
  const daily = (me.daily_at ?? 0) + BONUS.daily.cooldownHours * 3600000 - now
  const second = (me.second_at ?? 0) + BONUS.secondChance.cooldownMin * 60000 - now
  const broke = me.balance + me.inv_value + me.pending < BONUS.secondChance.maxNetWorth * COIN
  const streakAlive = me.daily_at !== null && now - me.daily_at < BONUS.daily.resetHours * 3600000
  const nextDay = Math.min(BONUS.daily.rewards.length, (streakAlive ? me.daily_streak : 0) + 1)

  const call = async (key: string, fn: string, args: Record<string, unknown>, msg: (r: any) => string) => {
    setBusy(key)
    const r = await run(async () => applyMe(await rpc<any>(fn, args)))
    setBusy('')
    if (r) {
      sfx('coin')
      useGame.getState().toast(msg(r), 'ok')
    }
    return r
  }
  return (
    <div className="space-y-4">
      <h1 className="display text-xl sm:text-2xl font-extrabold">Бонусы</h1>
      <div className="grid gap-3 md:grid-cols-2">
        <Section>
          <div className="flex items-center gap-3">
            <div className="grid size-12 shrink-0 place-items-center rounded-2xl bg-ok/15 text-ok"><Gift size={26} /></div>
            <div className="min-w-0 flex-1"><div className="display text-sm font-bold">Бесплатный кейс</div><div className="text-xs text-mute">Раз в {BONUS.freeCase.cooldownMin} минут. Редко, но метко: до 1 000 000.</div></div>
            <Link to="/case/free" data-testid="go-free" className={cx('rounded-xl px-4 py-2.5 text-sm font-extrabold', free <= 0 ? 'btn-gold' : 'bg-white/8 text-mute')}>{free <= 0 ? 'Открыть' : mmss(free)}</Link>
          </div>
        </Section>
        <Section>
          <div className="flex items-center gap-3">
            <div className="grid size-12 shrink-0 place-items-center rounded-2xl bg-gold/15 text-gold"><Sparkles size={26} /></div>
            <div className="min-w-0 flex-1"><div className="display text-sm font-bold">Ежедневный бонус</div><div className="text-xs text-mute">День {nextDay}: <Money v={BONUS.daily.rewards[nextDay - 1] * COIN} size={11} />. Заходи каждый день — награда растёт.</div></div>
            <Btn kind={daily <= 0 ? 'gold' : 'soft'} disabled={daily > 0} busy={busy === 'daily'} testId="daily"
              onClick={() => call('daily', 'bonus_daily', {}, (r) => `Дейлик: +${fmt(r.amount)} (день ${r.streak})`)}>{daily <= 0 ? 'Забрать' : mmss(daily)}</Btn>
          </div>
          <div className="mt-3 grid grid-cols-7 gap-1">
            {BONUS.daily.rewards.map((r, i) => (
              <div key={i} className={cx('rounded-lg py-1.5 text-center text-[10px] font-bold', i + 1 < nextDay ? 'bg-ok/15 text-ok' : i + 1 === nextDay ? 'bg-gold/20 text-gold ring-1 ring-gold/50' : 'bg-white/5 text-mute')}>
                <div>д{i + 1}</div><div>{r >= 1000 ? r / 1000 + 'к' : r}</div>
              </div>
            ))}
          </div>
        </Section>
        <Section>
          <div className="flex items-center gap-3">
            <div className="grid size-12 shrink-0 place-items-center rounded-2xl bg-bad/15 text-bad"><HeartPulse size={26} /></div>
            <div className="min-w-0 flex-1"><div className="display text-sm font-bold">Второй шанс</div><div className="text-xs text-mute">Слил всё до нуля? Держи <Money v={BONUS.secondChance.amount * COIN} size={11} />. Раз в {BONUS.secondChance.cooldownMin} минут.</div></div>
            <Btn kind={broke && second <= 0 ? 'gold' : 'soft'} disabled={!broke || second > 0} busy={busy === 'second'} testId="second"
              onClick={() => call('second', 'bonus_second_chance', {}, (r) => `Второй шанс: +${fmt(r.amount)}`)}>{second > 0 ? mmss(second) : broke ? 'Забрать' : 'Ты не на нуле'}</Btn>
          </div>
        </Section>
        <Section>
          <div className="flex items-center gap-3">
            <div className="grid size-12 shrink-0 place-items-center rounded-2xl bg-r1/15 text-r1"><CloudRain size={26} /></div>
            <div className="min-w-0 flex-1"><div className="display text-sm font-bold">Дождь в чате</div>
              <div className="text-xs text-mute">Каждые {BONUS.rain.everyMin} минут в чате льёт <Money v={BONUS.rain.pot * COIN} size={11} /> — делится между теми, кто успел нажать.</div></div>
            <span className="rounded-xl bg-white/8 px-3 py-2.5 text-sm font-extrabold text-mute">{rain?.active ? 'идёт!' : rain ? mmss(rain.next_at - now) : '—'}</span>
          </div>
        </Section>
      </div>
      <Section title="Промокод">
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); void call('promo', 'promo_redeem', { p_code: code }, (r) => `Промокод: ${r.coins ? '+' + fmt(r.coins) : ''}${r.case ? ` и ${r.n} × «${caseOf(r.case).name}»` : ''}`).then((r) => r && setCode('')) }}>
          <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Введи код" data-testid="promo-input" className="h-11 min-w-0 flex-1 rounded-xl border border-line bg-white/5 px-4 text-sm font-bold uppercase outline-none focus:border-gold/50" />
          <Btn kind="gold" disabled={!code.trim()} busy={busy === 'promo'} testId="promo-go">Активировать</Btn>
        </form>
      </Section>
    </div>
  )
}

/* ============================== БАТЛ-ПАСС =============================== */
export function Pass() {
  const me = useGame((s) => s.me)!
  const run = useGame((s) => s.run)
  const [busy, setBusy] = useState('')
  const lv = levelFromXp(me.xp)
  const claimed = (k: string) => me.claims.includes(k)
  const claim = async (kind: string, id: string) => {
    setBusy(kind + id)
    const r = await run(async () => applyMe(await rpc<{ reward: any; me: Me }>('claim', { p_kind: kind, p_id: id })))
    setBusy('')
    if (r) {
      sfx('coin')
      const w = r.reward
      useGame.getState().toast(`Награда: ${w.coins ? '+' + fmt(w.coins) : ''}${w.case ? ` ${w.n} × «${caseOf(w.case).name}»` : ''}${w.xp ? ` и ${w.xp} XP` : ''}`, 'ok')
    }
  }
  const ready = PASS.rewards.map((_, i) => i + 1).filter((n) => n <= lv.level && !claimed(`level:${PASS.seasonId}|${n}`))
  const claimAll = async () => {
    for (const n of ready) await claim('level', String(n))
  }
  const quest = (period: 'day' | 'week') =>
    QUESTS.filter((q) => q.period === period).map((q) => {
      const key = `quest:${q.id}|${period === 'day' ? me.day : me.week}`
      const mult = ['spent'].includes(q.metric) ? COIN : 1
      const v = Math.floor((me.counters[period][q.metric] ?? 0) / mult)
      const done = v >= q.goal
      const got = claimed(key)
      return (
        <div key={q.id} className={cx('rounded-2xl bg-black/20 p-3', got && 'opacity-50')} data-testid={'quest-' + q.id}>
          <div className="flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <div className="text-sm font-bold">{q.title}</div>
              <div className="mt-0.5 flex items-center gap-2 text-[11px] text-mute"><Money v={q.coins * COIN} size={10} /><span>+{q.xp} XP</span><span className="ml-auto tabular-nums">{Math.min(v, q.goal).toLocaleString('ru-RU')}/{q.goal.toLocaleString('ru-RU')}</span></div>
            </div>
            {got ? <Check size={18} className="text-ok" /> : <Btn kind={done ? 'gold' : 'soft'} className="!min-h-9 !px-3 text-xs" disabled={!done} busy={busy === 'quest' + q.id} onClick={() => claim('quest', q.id)} testId={'claim-' + q.id}>Забрать</Btn>}
          </div>
          <div className="mt-2"><Bar v={v} max={q.goal} color={done ? 'var(--color-ok)' : undefined} /></div>
        </div>
      )
    })
  return (
    <div className="space-y-4">
      <Section>
        <div className="flex flex-wrap items-center gap-4">
          <div className="grid size-16 place-items-center rounded-2xl bg-gold/15"><span className="display text-2xl font-black gold-text" data-testid="bp-level">{lv.level}</span></div>
          <div className="min-w-0 flex-1">
            <div className="display text-base font-extrabold">{PASS.seasonName}</div>
            <div className="text-xs text-mute">Без платной ветки. XP — за открытия, батлы, апгрейды, контракты и задания.</div>
            <div className="mt-2 flex items-center gap-2"><Bar v={lv.into} max={lv.need || 1} /><span className="shrink-0 text-[11px] tabular-nums text-mute">{lv.need ? `${lv.into}/${lv.need} XP` : 'максимум'}</span></div>
          </div>
          {ready.length > 0 && <Btn kind="gold" onClick={claimAll} busy={busy.startsWith('level')} testId="claim-levels">Забрать награды ({ready.length})</Btn>}
        </div>
        <div className="no-scrollbar mt-4 flex gap-2 overflow-x-auto pb-1">
          {PASS.rewards.map((r, i) => {
            const n = i + 1
            const got = claimed(`level:${PASS.seasonId}|${n}`)
            const open = n <= lv.level
            return (
              <button key={n} disabled={!open || got} onClick={() => claim('level', String(n))} data-testid={'lvl-' + n}
                className={cx('relative flex w-24 shrink-0 flex-col items-center rounded-2xl border p-2 text-center', got ? 'border-ok/30 bg-ok/10 opacity-60' : open ? 'border-gold/60 bg-gold/10 pulse-ring' : 'border-line bg-black/20')}>
                <div className="text-[10px] font-black text-mute">УР. {n}</div>
                <div className="grid h-14 place-items-center">{r.case ? <CaseCover c={caseOf(r.case[0])} size={50} /> : <Coins size={28} className="text-gold" />}</div>
                {r.coins ? <Money v={r.coins * COIN} short size={10} className="text-[11px] font-extrabold" /> : null}
                {r.case ? <div className="flex items-center gap-0.5 text-[10px] font-bold text-ok"><Ticket size={10} />×{r.case[1]}</div> : null}
                {got ? <Check size={14} className="absolute right-1.5 top-1.5 text-ok" /> : !open ? <Lock size={12} className="absolute right-1.5 top-1.5 text-mute" /> : null}
              </button>
            )
          })}
        </div>
      </Section>
      <div className="grid gap-4 md:grid-cols-2">
        <Section title="Задания на сегодня"><div className="space-y-2">{quest('day')}</div></Section>
        <Section title="Задания на неделю"><div className="space-y-2">{quest('week')}</div></Section>
      </div>
    </div>
  )
}

/* ================================ ТОП =================================== */
export function Top() {
  const me = useGame((s) => s.me)!
  const [tab, setTab] = useState<'balance' | 'best' | 'battles'>('balance')
  const [data, setData] = useState<Record<string, any[]> | null>(null)
  useEffect(() => {
    void rpc('leaderboard').then(setData).catch(() => setData({ balance: [], best: [], battles: [] }))
  }, [])
  const tabs = [{ id: 'balance', name: 'Состояние' }, { id: 'best', name: 'Лучший дроп' }, { id: 'battles', name: 'Выигрыши в батлах' }] as const
  const rows = data?.[tab] ?? []
  return (
    <div className="space-y-4">
      <h1 className="display text-xl sm:text-2xl font-extrabold">Лидерборд</h1>
      <div className="flex gap-2 overflow-x-auto no-scrollbar">
        {tabs.map((t) => <button key={t.id} onClick={() => setTab(t.id)} className={cx('h-10 shrink-0 rounded-xl px-4 text-sm font-bold', tab === t.id ? 'bg-white/14 text-gold' : 'glass text-mute')}>{t.name}</button>)}
      </div>
      <Section className="!p-2">
        {!data ? <div className="h-40 animate-pulse rounded-2xl bg-white/5" /> : rows.length === 0 ? <Empty icon={Trophy}>Пока пусто — будь первым</Empty> : (
          <div className="divide-y divide-line" data-testid="top-list">
            {rows.map((r, i) => (
              <Link to={'/profile/' + encodeURIComponent(r.nick)} key={r.nick} className={cx('flex items-center gap-3 px-3 py-2.5 hover:bg-white/5', r.nick === me.nick && 'bg-gold/8')}>
                <span className={cx('display w-7 text-center text-sm font-black', i === 0 ? 'text-gold' : i === 1 ? 'text-r0' : i === 2 ? 'text-fire' : 'text-mute')}>{i + 1}</span>
                <Avatar n={r.avatar} size={34} />
                <div className="min-w-0 flex-1"><div className="truncate text-sm font-bold">{r.nick}</div><div className="text-[10px] text-mute">ур. {r.level}{tab === 'battles' && ` · побед ${r.wins}`}{tab === 'balance' && ` · на балансе ${fmt(r.balance)}`}</div></div>
                {tab === 'best' && r.item && <ItemArt i={r.item} className="h-8 w-12" />}
                <Money v={r.value} short className="display text-sm font-extrabold" />
              </Link>
            ))}
          </div>
        )}
      </Section>
    </div>
  )
}

/* ============================== КОИНФЛИП ================================ */
function CoinFace({ side, size = 72 }: { side: number; size?: number }) {
  return (
    <div className="grid place-items-center rounded-full font-black" style={{ width: size, height: size, fontSize: size * 0.42, background: side === 0 ? 'linear-gradient(135deg,#ffe9a8,#ff8a1c)' : 'linear-gradient(135deg,#dfe7f5,#7c8aa8)', color: side === 0 ? '#5a2c00' : '#1a2233', boxShadow: 'inset 0 -4px 0 rgb(0 0 0 / .2), 0 6px 20px rgb(0 0 0 / .4)' }}>
      {side === 0 ? 'О' : 'Р'}
    </div>
  )
}

function FlipRow({ f }: { f: Flip }) {
  const me = useGame((s) => s.me)!
  const run = useGame((s) => s.run)
  const now = useNow(200)
  const [busy, setBusy] = useState(false)
  const act = async (fn: string) => {
    setBusy(true)
    const r = await run(async () => applyMe(await rpc<{ me: Me }>(fn, { p_id: f.id })))
    setBusy(false)
    if (r) {
      sfx('start')
      void useGame.getState().sync()
    }
  }
  const flipping = f.status === 'done' && f.ends_at !== null && now < f.ends_at
  const shown = f.status === 'done' && !flipping
  const mine = f.creator === me.id
  const iWon = shown && f.winner === me.id
  const involved = mine || f.joiner === me.id
  useEffect(() => {
    if (shown && involved && f.ends_at && now - f.ends_at < 900) {
      sfx(iWon ? 'win' : 'fail')
      void useGame.getState().sync()
    }
  }, [shown]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="glass flex flex-wrap items-center gap-3 rounded-2xl p-3" data-testid="flip-row" data-status={flipping ? 'flipping' : f.status}>
      <div className="flex items-center gap-2"><Avatar n={f.creator_avatar} size={36} /><div className="leading-tight"><div className="text-xs font-extrabold">{f.creator_nick}</div><div className="text-[10px] text-mute">{f.creator_side === 0 ? 'орёл' : 'решка'}</div></div></div>
      <div className="mx-auto">
        {flipping ? (
          <motion.div animate={{ rotateY: 360 * 5 + (f.result === 0 ? 0 : 180) }} transition={{ duration: COINFLIP.flipMs / 1000 - 0.3, ease: [0.2, 0.7, 0.2, 1] }} style={{ transformStyle: 'preserve-3d' }} className="relative size-14">
            <div className="absolute inset-0" style={{ backfaceVisibility: 'hidden' }}><CoinFace side={0} size={56} /></div>
            <div className="absolute inset-0" style={{ backfaceVisibility: 'hidden', transform: 'rotateY(180deg)' }}><CoinFace side={1} size={56} /></div>
          </motion.div>
        ) : shown ? <CoinFace side={f.result!} size={56} /> : <div className="text-center"><Money v={f.stake} className="display text-base font-extrabold" /><div className="text-[10px] text-mute">ставка</div></div>}
      </div>
      <div className="flex items-center gap-2">
        {f.joiner_nick ? (
          <><div className="text-right leading-tight"><div className="flex items-center justify-end gap-1 text-xs font-extrabold">{f.joiner_bot && <Bot size={12} className="text-mute" />}{f.joiner_nick}</div><div className="text-[10px] text-mute">{f.creator_side === 0 ? 'решка' : 'орёл'}</div></div><Avatar n={f.joiner_avatar ?? 0} size={36} /></>
        ) : mine ? (
          <><Btn kind="gold" className="!min-h-9 !px-3 text-xs" busy={busy} onClick={() => act('coinflip_bot')} testId="flip-bot"><Bot size={13} />С ботом</Btn><Btn kind="ghost" className="!min-h-9 !px-2 text-xs" busy={busy} onClick={() => act('coinflip_cancel')} testId="flip-cancel">Отмена</Btn></>
        ) : (
          <Btn kind="gold" className="!min-h-9 text-xs" busy={busy} disabled={me.balance < f.stake} onClick={() => act('coinflip_join')} testId="flip-join">Принять за <Money v={f.stake} size={11} /></Btn>
        )}
      </div>
      {shown && <div className={cx('w-full text-center text-xs font-bold', f.winner === null ? 'text-mute' : iWon ? 'text-ok' : involved ? 'text-bad' : 'text-mute')} data-testid="flip-result">
        {f.winner === null ? 'Бот забрал банк' : <>{f.winner === f.creator ? f.creator_nick : f.joiner_nick} забирает <Money v={f.payout ?? 0} size={11} /></>}
      </div>}
    </div>
  )
}

export function Coinflip() {
  const me = useGame((s) => s.me)!
  const flips = useGame((s) => s.coinflips)
  const run = useGame((s) => s.run)
  const [stake, setStake] = useState('100')
  const [side, setSide] = useState(0)
  const [busy, setBusy] = useState(false)
  const k = Math.round((parseFloat(stake.replace(',', '.')) || 0) * COIN)
  const create = async () => {
    setBusy(true)
    const r = await run(async () => applyMe(await rpc<{ me: Me }>('coinflip_create', { p_stake: k, p_side: side })))
    setBusy(false)
    if (r) {
      sfx('click')
      void useGame.getState().sync()
    }
  }
  return (
    <div className="space-y-4">
      <div>
        <h1 className="display text-xl sm:text-2xl font-extrabold">Коинфлип</h1>
        <p className="text-xs text-mute">Один на один. Победитель забирает обе ставки минус {COINFLIP.rakePct} %. Никто не принял — зови бота.</p>
      </div>
      <Section>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex gap-2">
            {[0, 1].map((s) => <button key={s} onClick={() => setSide(s)} data-testid={'side-' + s} className={cx('rounded-full p-1 transition', side === s ? 'ring-2 ring-gold scale-105' : 'opacity-50')}><CoinFace side={s} size={52} /></button>)}
          </div>
          <label className="flex min-w-36 flex-1 flex-col text-[11px] font-bold text-mute">Ставка
            <input value={stake} onChange={(e) => setStake(e.target.value)} inputMode="decimal" data-testid="flip-stake" className="mt-1 h-11 rounded-xl border border-line bg-white/5 px-3 text-base font-bold text-white outline-none focus:border-gold/50" />
          </label>
          <div className="flex gap-1.5">{[0.5, 2].map((m) => <button key={m} onClick={() => setStake(String(Math.max(COINFLIP.minStake, Math.floor(((k / COIN) * m))))) } className="h-11 rounded-xl bg-white/8 px-3 text-sm font-bold">{m === 0.5 ? '½' : '×2'}</button>)}
            <button onClick={() => setStake(String(Math.floor(me.balance / COIN)))} className="h-11 rounded-xl bg-white/8 px-3 text-sm font-bold">всё</button></div>
          <Btn kind="gold" className="h-11" disabled={k < COINFLIP.minStake * COIN || k > me.balance} busy={busy} onClick={create} testId="flip-create">Создать</Btn>
        </div>
      </Section>
      {flips.length ? <div className="space-y-2">{flips.map((f) => <FlipRow key={f.id} f={f} />)}</div> : <Empty icon={Award}>Никто не бросает монетку. Создай первый коинфлип!</Empty>}
      <p className="text-center text-[11px] text-mute">Честно: хеш сида виден заранее, сам сид раскрывается после броска. Результат = HMAC(сид, «coinflip-№:0») mod 2.{' '}{CATALOG.version && ''}</p>
    </div>
  )
}
