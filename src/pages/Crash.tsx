import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Rocket, ShieldCheck } from 'lucide-react'
import { COIN } from '../config/economy'
import { rpc, type Me } from '../lib/api'
import { applyMe, useGame } from '../store/game'
import { haptic, sfx } from '../audio/sfx'
import { Avatar, Btn, Money, Section, cx } from '../components/ui'
import { fmt } from '../shared/money'

interface CrashBet { nick: string; avatar: number; amount: number; cash_pm: number | null; payout: number | null }
interface CrashState {
  now: number
  cfg: { min: number; max: number; growth: number; max_auto: number }
  round: { id: number; status: 'bet' | 'run' | 'done'; seed_hash: string; bet_ends_at: number; started_at: number | null; crashed_at: number | null; crash_pm: number | null; seed: string | null } | null
  my: { amount: number; auto_pm: number | null; cash_pm: number | null; payout: number | null } | null
  bets: CrashBet[]
  history: number[]
}

const fx = (pm: number) => (pm / 1000).toFixed(2)
const chip = (pm: number) => (pm >= 10000 ? 'bg-gold/20 text-gold' : pm >= 2000 ? 'bg-ok/15 text-ok' : 'bg-bad/15 text-bad')

function Curve({ g, t, crashed }: { g: number; t: number; crashed: boolean }) {
  // ось X — секунды (минимум 12), ось Y — множитель до 1..max
  const tx = Math.max(12, t)
  const top = Math.max(2, Math.exp(g * t) * 1.15)
  const pts = useMemo(() => {
    const n = 60
    const out: string[] = []
    for (let i = 0; i <= n; i++) {
      const ti = (t * i) / n
      const x = (ti / tx) * 300
      const y = 150 - ((Math.exp(g * ti) - 1) / (top - 1)) * 140
      out.push(`${x.toFixed(1)},${y.toFixed(1)}`)
    }
    return out.join(' ')
  }, [g, t, tx, top])
  const color = crashed ? '#ff4d6a' : '#3ddc97'
  return (
    <svg viewBox="0 0 300 150" className="absolute inset-0 size-full" preserveAspectRatio="none" aria-hidden>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="3" strokeLinejoin="round" style={{ filter: `drop-shadow(0 0 6px ${color})` }} />
    </svg>
  )
}

export default function Crash() {
  const me = useGame((s) => s.me)!
  const run = useGame((s) => s.run)
  const [st, setSt] = useState<CrashState | null>(null)
  const [offset, setOffset] = useState(0)
  const [, setTick] = useState(0)
  const [amount, setAmount] = useState('100')
  const [auto, setAuto] = useState('')
  const [busy, setBusy] = useState(false)
  const lastRound = useRef(0)

  useEffect(() => {
    let alive = true
    let timer: ReturnType<typeof setTimeout>
    const poll = async () => {
      try {
        const d = await rpc<CrashState>('crash_state')
        if (!alive) return
        setSt(d)
        setOffset(d.now - Date.now())
      } catch {
        /* повторим */
      }
      if (alive) timer = setTimeout(poll, 450)
    }
    void poll()
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [])
  // кадры анимации: множитель считаем локально по серверному времени
  useEffect(() => {
    let raf = 0
    const loop = () => {
      setTick((x) => (x + 1) % 1e9)
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [])

  const round = st?.round ?? null
  const nowS = Date.now() + offset
  const g = st?.cfg.growth ?? 0.07
  const tRun = round?.status === 'run' && round.started_at ? Math.max(0, (nowS - round.started_at) / 1000) : round?.status === 'done' && round.started_at && round.crashed_at ? (round.crashed_at - round.started_at) / 1000 : 0
  const multPm = round?.status === 'done' ? round.crash_pm! : Math.floor(1000 * Math.exp(g * tRun))
  const my = st?.my ?? null
  const k = Math.round((parseFloat(amount.replace(',', '.')) || 0) * COIN)
  const autoPm = auto ? Math.round((parseFloat(auto.replace(',', '.')) || 0) * 1000) : null
  const betLeft = round?.status === 'bet' ? Math.max(0, (round.bet_ends_at - nowS) / 1000) : 0

  // звуки и вибрация на смене фаз
  useEffect(() => {
    if (!round || lastRound.current === round.id * 10 + (round.status === 'bet' ? 1 : round.status === 'run' ? 2 : 3)) return
    lastRound.current = round.id * 10 + (round.status === 'bet' ? 1 : round.status === 'run' ? 2 : 3)
    if (round.status === 'run') sfx('start')
    if (round.status === 'done') {
      sfx(my && my.cash_pm === null ? 'fail' : 'boom')
      haptic(my && my.cash_pm === null ? [60, 40, 60] : 20)
      void useGame.getState().sync()
    }
  }, [round?.id, round?.status]) // eslint-disable-line react-hooks/exhaustive-deps

  const bet = async () => {
    setBusy(true)
    const r = await run(async () => applyMe(await rpc<{ me: Me }>('crash_bet', { p_amount: k, p_auto: autoPm })))
    setBusy(false)
    if (r) {
      sfx('click')
      haptic(10)
    }
  }
  const cash = async () => {
    setBusy(true)
    const r = await run(async () => applyMe(await rpc<{ mult: number; payout: number; me: Me }>('crash_cashout')))
    setBusy(false)
    if (r) {
      sfx('coin')
      haptic([20, 30, 40])
      useGame.getState().toast(`Забрал x${fx(r.mult)}: +${fmt(r.payout)}`, 'ok')
    }
  }

  const canBet = round?.status === 'bet' && betLeft > 0 && !my
  const canCash = round?.status === 'run' && my && my.cash_pm === null
  const done = round?.status === 'done'
  const myWin = my?.cash_pm != null
  return (
    <div className="space-y-4">
      <div>
        <h1 className="display text-xl font-extrabold sm:text-2xl">Краш</h1>
        <p className="text-xs text-mute">Ракета растёт, пока не упадёт. Забери выигрыш до падения: чем позже, тем больше. Один раунд на всех, ставки принимаются {(8).toFixed(0)} секунд.</p>
      </div>

      <Section className="!p-3 sm:!p-4">
        <div className="mb-3 flex gap-1.5 overflow-x-auto no-scrollbar" data-testid="crash-history">
          {(st?.history ?? []).map((pm, i) => <span key={i} className={cx('shrink-0 rounded-lg px-2 py-1 text-xs font-bold tabular-nums', chip(pm))}>x{fx(pm)}</span>)}
        </div>
        <div className="relative grid h-52 place-items-center overflow-hidden rounded-2xl bg-black/30 sm:h-64" data-testid="crash-stage" data-status={round?.status ?? 'none'}>
          {round && round.status !== 'bet' && <Curve g={g} t={tRun} crashed={!!done} />}
          <div className="relative text-center">
            {round?.status === 'bet' && (
              <>
                <div className="text-sm font-bold text-mute">Ставки открыты</div>
                <div className="display text-5xl font-black tabular-nums gold-text sm:text-7xl" data-testid="crash-countdown">{betLeft.toFixed(1)}</div>
              </>
            )}
            {round?.status === 'run' && (
              <div className="display text-5xl font-black tabular-nums text-ok sm:text-7xl" data-testid="crash-mult">x{fx(multPm)}</div>
            )}
            {done && (
              <>
                <div className="text-sm font-extrabold uppercase tracking-widest text-bad">Краш</div>
                <div className="display text-5xl font-black tabular-nums text-bad sm:text-7xl" data-testid="crash-result">x{fx(multPm)}</div>
              </>
            )}
            {!round && <div className="text-sm text-mute">Загрузка…</div>}
          </div>
          {round?.status === 'run' && <Rocket className="absolute bottom-3 right-3 text-ok/60" size={28} />}
        </div>

        <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <label className="text-[11px] font-bold text-mute">Ставка, монет
            <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" data-testid="crash-amount" disabled={!!my}
              className="mt-1 h-12 w-full rounded-xl border border-line bg-white/5 px-3 text-base font-bold text-white outline-none focus:border-gold/50 disabled:opacity-50" />
          </label>
          <label className="text-[11px] font-bold text-mute">Автовывод на x (по желанию)
            <input value={auto} onChange={(e) => setAuto(e.target.value)} inputMode="decimal" placeholder="например 2" data-testid="crash-auto" disabled={!!my}
              className="mt-1 h-12 w-full rounded-xl border border-line bg-white/5 px-3 text-base font-bold text-white outline-none focus:border-gold/50 disabled:opacity-50" />
          </label>
          {canCash ? (
            <Btn kind="gold" className="h-12 px-6 text-base" busy={busy} onClick={cash} testId="crash-cashout">Забрать <Money v={Math.floor((my!.amount * multPm) / 1000)} /></Btn>
          ) : (
            <Btn kind="gold" className="h-12 px-6 text-base" busy={busy} disabled={!canBet || k < (st?.cfg.min ?? 0) || k > me.balance} onClick={bet} testId="crash-bet">
              {my ? (myWin ? `Забрал x${fx(my.cash_pm!)}` : done ? 'Проиграл' : 'Ставка принята') : round?.status === 'bet' ? 'Поставить' : 'Жди следующий раунд'}
            </Btn>
          )}
        </div>
        <div className="mt-2 flex gap-1.5">
          {[0.5, 2].map((m) => <button key={m} onClick={() => setAmount(String(Math.max(1, Math.floor((k / COIN) * m))))} disabled={!!my} className="h-9 rounded-lg bg-white/8 px-3 text-xs font-bold disabled:opacity-40">{m === 0.5 ? '½' : '×2'}</button>)}
          <button onClick={() => setAmount(String(Math.floor(me.balance / COIN)))} disabled={!!my} className="h-9 rounded-lg bg-white/8 px-3 text-xs font-bold disabled:opacity-40">всё</button>
        </div>
      </Section>

      <Section title="Ставки в раунде" right={<span className="text-xs text-mute">{st?.bets.length ?? 0} игр.</span>}>
        {st?.bets.length ? (
          <div className="divide-y divide-line" data-testid="crash-bets">
            {st.bets.map((b, i) => (
              <div key={i} className="flex items-center gap-3 py-2">
                <Avatar n={b.avatar} size={28} />
                <span className="min-w-0 flex-1 truncate text-sm font-semibold">{b.nick}</span>
                <Money v={b.amount} short size={11} className="text-xs text-mute" />
                {b.cash_pm !== null ? <span className="w-28 text-right text-sm font-extrabold text-ok">x{fx(b.cash_pm)} · +{fmt((b.payout ?? 0) - b.amount)}</span> : done ? <span className="w-28 text-right text-sm font-extrabold text-bad">−{fmt(b.amount)}</span> : <span className="w-28 text-right text-xs text-mute">в игре</span>}
              </div>
            ))}
          </div>
        ) : <p className="py-4 text-center text-sm text-mute">Пока никто не поставил. Будь первым.</p>}
      </Section>

      <Section className="!p-3 text-[11px] text-mute">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <span className="inline-flex items-center gap-1 font-bold text-ok"><ShieldCheck size={13} />Честный раунд: точка падения выбрана до ставок</span>
          <span className="break-all">хеш сида: {round?.seed_hash}</span>
          {done && round?.seed && <Link className="font-bold text-gold" to={`/fair?seed=${round.seed}&client=crash&nonce=${round.id}&case=sigma`} data-testid="crash-verify">проверить раунд</Link>}
        </div>
      </Section>
    </div>
  )
}
