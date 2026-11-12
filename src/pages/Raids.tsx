import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ChevronLeft, Copy, Plus, ShieldCheck, Users } from 'lucide-react'
import { COIN, RAID } from '../config/economy'
import { CATALOG, caseOf } from '../shared/catalog'
import { fmt } from '../shared/money'
import { rpc, type Me } from '../lib/api'
import { applyMe, useGame } from '../store/game'
import { sfx } from '../audio/sfx'
import { Roulette } from '../components/Roulette'
import { Avatar, Bar, Btn, CaseCover, Confetti, Empty, ItemCard, Modal, Money, Section, cx } from '../components/ui'

interface RaidView {
  id: string
  status: 'open' | 'done' | 'cancelled'
  case: string
  target: number
  pot: number
  creator: string
  seed_hash: string
  started_at: number | null
  ends_at: number | null
  now: number
  mine: number
  shares: { nick: string; avatar: number; amount: number; pid: string }[]
  result: { case: string; idx: number; item: string; phase: number; rarity: number; fi: number; st: boolean; price: number } | null
  payouts: { pid: string; amount: number }[] | null
  seed: string | null
}

function usePolled<T>(fn: () => Promise<T>, ms: number, deps: unknown[]): [T | null, () => void] {
  const [v, setV] = useState<T | null>(null)
  const [n, setN] = useState(0)
  useEffect(() => {
    let alive = true
    let t: ReturnType<typeof setTimeout>
    const go = async () => {
      try {
        const d = await fn()
        if (alive) setV(d)
      } catch {
        /* повторим */
      }
      if (alive) t = setTimeout(go, ms)
    }
    void go()
    return () => {
      alive = false
      clearTimeout(t)
    }
  }, [...deps, n]) // eslint-disable-line react-hooks/exhaustive-deps
  return [v, () => setN((x) => x + 1)]
}

function RaidRow({ r }: { r: RaidView }) {
  const c = caseOf(r.case)
  const pct = Math.min(100, (r.pot / r.target) * 100)
  return (
    <Link to={'/raid/' + r.id} data-testid="raid-row" className="glass flex items-center gap-3 rounded-2xl p-3 transition hover:border-white/25">
      <CaseCover c={c} size={64} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-extrabold">{c.name}</div>
        <div className="mt-1.5"><Bar v={r.pot} max={r.target} /></div>
        <div className="mt-1 flex items-center justify-between text-[11px] text-mute">
          <span><Money v={r.pot} short size={10} /> из <Money v={r.target} short size={10} /></span>
          <span className="flex items-center gap-1"><Users size={11} />{r.shares.length}</span>
        </div>
      </div>
      <span className={cx('rounded-lg px-2 py-1 text-xs font-bold', r.status === 'done' ? 'bg-gold/15 text-gold' : 'bg-white/8 text-mute')}>{r.status === 'done' ? 'идёт' : `${pct.toFixed(0)}%`}</span>
    </Link>
  )
}

export function Raids() {
  const nav = useNavigate()
  const run = useGame((s) => s.run)
  const [list] = usePolled(() => rpc<RaidView[]>('raid_list'), 2500, [])
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState('')
  const cases = CATALOG.cases.filter((c) => c.category !== 'free' && c.price >= RAID.minCase * COIN)
  const create = async (id: string) => {
    setBusy(id)
    const r = await run(() => rpc<{ raid: RaidView }>('raid_create', { p_case: id }))
    setBusy('')
    if (r) {
      sfx('start')
      setOpen(false)
      nav('/raid/' + r.raid.id)
    }
  }
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="display text-xl font-extrabold sm:text-2xl">Рейд-кейс</h1>
          <p className="text-xs text-mute">Вся компания скидывается на один дорогой кейс. Выпавшее делится по вкладам, так что ловить джекпот можно вскладчину.</p>
        </div>
        <Btn kind="gold" onClick={() => setOpen(true)} testId="raid-new"><Plus size={16} />Создать</Btn>
      </div>
      <Section title="Открытые рейды">
        {!list ? <div className="h-24 animate-pulse rounded-2xl bg-white/5" /> : list.length ? <div className="space-y-2">{list.map((r) => <RaidRow key={r.id} r={r} />)}</div> : <Empty icon={Users}>Рейдов нет. Создай свой и позови друзей.</Empty>}
      </Section>
      <Modal open={open} onClose={() => setOpen(false)} title="Выбери кейс для рейда" wide>
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
          {cases.map((c) => (
            <button key={c.id} disabled={!!busy} onClick={() => create(c.id)} data-testid={'raidcase-' + c.id} className="flex flex-col items-center rounded-2xl bg-white/5 p-2 text-center hover:bg-white/10 disabled:opacity-50">
              <CaseCover c={c} size={72} />
              <div className="w-full truncate text-xs font-bold">{c.name}</div>
              <Money v={c.price} short size={10} className="text-[11px] text-mute" />
            </button>
          ))}
        </div>
      </Modal>
    </div>
  )
}

export function RaidRoom() {
  const { id } = useParams()
  const nav = useNavigate()
  const me = useGame((s) => s.me)!
  const run = useGame((s) => s.run)
  const [raid, refresh] = usePolled(() => rpc<RaidView>('get_raid', { p_id: id }), 1200, [id])
  const [offset, setOffset] = useState(0)
  const [amount, setAmount] = useState('')
  const [busy, setBusy] = useState(false)
  const [spin, setSpin] = useState(0)
  const [confetti, setConfetti] = useState(0)
  const spun = useRef(false)
  const celebrated = useRef(false)
  const [, setTick] = useState(0)

  useEffect(() => {
    if (raid) setOffset(raid.now - Date.now())
  }, [raid?.now]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 200)
    return () => clearInterval(t)
  }, [])
  const now = Date.now() + offset
  const c = raid ? caseOf(raid.case) : null
  const started = !!raid?.started_at && !!raid.result
  const rollEnd = raid?.started_at ? raid.started_at + RAID.rollMs : 0
  const over = !!raid?.ends_at && now >= raid.ends_at
  // старт анимации один раз; опоздавшие видят ускоренную
  useEffect(() => {
    if (started && !spun.current) {
      spun.current = true
      setSpin(1)
      sfx('start')
    }
  }, [started])
  const cell = raid?.result ? { item: raid.result.item, phase: raid.result.phase, rarity: raid.result.rarity, fi: raid.result.fi, st: raid.result.st, price: raid.result.price } : null
  const late = started && raid!.started_at! + 1500 < now
  const rolled = started && now >= rollEnd
  const myPay = raid?.payouts?.find((p) => p.pid === me.id)?.amount ?? 0
  useEffect(() => {
    if (over && raid?.payouts && !celebrated.current) {
      celebrated.current = true
      void useGame.getState().sync()
      if (myPay > 0) {
        sfx(myPay >= (raid.shares.find((s) => s.pid === me.id)?.amount ?? 0) ? 'win' : 'coin')
        setConfetti(Date.now())
      }
    }
  }, [over, raid?.payouts]) // eslint-disable-line react-hooks/exhaustive-deps

  const remaining = raid ? raid.target - raid.pot : 0
  const k = Math.round((parseFloat(amount.replace(',', '.')) || 0) * COIN)
  const act = async (fn: string, args: Record<string, unknown>) => {
    setBusy(true)
    const r = await run(async () => applyMe(await rpc<{ raid: RaidView; me: Me }>(fn, args)))
    setBusy(false)
    if (r) {
      sfx(fn === 'raid_contribute' ? 'coin' : 'click')
      refresh()
    }
  }

  if (!raid || !c) return <div className="h-64 animate-pulse rounded-3xl bg-white/5" />
  const isOwner = raid.creator === me.id
  return (
    <div className="space-y-4" data-testid="raid-room" data-status={raid.status} data-over={over ? '1' : '0'}>
      <Confetti fire={confetti} />
      <div className="flex items-center gap-3">
        <button onClick={() => nav('/raids')} aria-label="Назад" className="grid size-10 place-items-center rounded-full glass"><ChevronLeft size={18} /></button>
        <CaseCover c={c} size={72} />
        <div className="min-w-0 flex-1">
          <h1 className="display truncate text-lg font-extrabold sm:text-2xl">Рейд: {c.name}</h1>
          <div className="text-xs text-mute">Цена кейса <Money v={raid.target} size={11} />, RTP {(c.rtp * 100).toFixed(0)} %</div>
        </div>
        <button onClick={() => { void navigator.clipboard?.writeText(location.href); useGame.getState().toast('Ссылка скопирована — кидай друзьям', 'ok') }} className="glass flex h-10 items-center gap-1.5 rounded-xl px-3 text-xs font-bold"><Copy size={14} />Ссылка</button>
      </div>

      {raid.status === 'cancelled' && <Section><Empty>Рейд отменён, вклады возвращены</Empty></Section>}

      {raid.status !== 'cancelled' && (
        <Section>
          <div className="mb-1 flex items-end justify-between text-sm">
            <span className="font-bold">Банк рейда</span>
            <span><Money v={raid.pot} className="font-extrabold" /> <span className="text-mute">из</span> <Money v={raid.target} className="font-extrabold" /></span>
          </div>
          <Bar v={raid.pot} max={raid.target} color={raid.status === 'done' ? 'var(--color-gold)' : 'var(--color-ok)'} />
          {started && cell && (
            <div className="mt-4" data-testid="raid-roulette">
              <Roulette c={c} result={cell} spinId={spin} fast={late} height={120} onDone={() => {}} />
              {rolled && (
                <div className="mx-auto mt-3 max-w-[200px]"><ItemCard i={cell} /></div>
              )}
            </div>
          )}
          {raid.status === 'open' && (
            <div className="mt-4 grid gap-2 sm:grid-cols-[1fr_auto] sm:items-end">
              <label className="text-[11px] font-bold text-mute">Твой вклад, монет (осталось набрать {fmt(remaining)})
                <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" data-testid="raid-amount"
                  className="mt-1 h-12 w-full rounded-xl border border-line bg-white/5 px-3 text-base font-bold text-white outline-none focus:border-gold/50" />
              </label>
              <Btn kind="gold" className="h-12 px-6" busy={busy} disabled={k < RAID.minShare * COIN || k > me.balance} onClick={() => act('raid_contribute', { p_id: raid.id, p_amount: k })} testId="raid-contribute">Вложить</Btn>
              <div className="flex gap-1.5 sm:col-span-2">
                {[0.1, 0.25, 0.5, 1].map((p) => (
                  <button key={p} onClick={() => setAmount(String(Math.max(RAID.minShare, Math.floor((Math.min(remaining, me.balance) * p) / COIN))))} className="h-9 rounded-lg bg-white/8 px-3 text-xs font-bold">{p === 1 ? 'всё что можно' : `${p * 100}%`}</button>
                ))}
                {raid.mine > 0 && <Btn kind="ghost" className="!min-h-9 ml-auto text-xs" busy={busy} onClick={() => act('raid_leave', { p_id: raid.id })} testId="raid-leave">Забрать вклад</Btn>}
                {isOwner && <Btn kind="danger" className="!min-h-9 text-xs" busy={busy} onClick={() => act('raid_cancel', { p_id: raid.id })} testId="raid-cancel">Отменить рейд</Btn>}
              </div>
            </div>
          )}
        </Section>
      )}

      <Section title="Участники" right={<span className="text-xs text-mute">{raid.shares.length}</span>}>
        {raid.shares.length ? (
          <div className="divide-y divide-line" data-testid="raid-shares">
            {raid.shares.map((s) => {
              const pay = over ? (raid.payouts?.find((p) => p.pid === s.pid)?.amount ?? 0) : null
              return (
                <div key={s.pid} className="flex items-center gap-3 py-2">
                  <Avatar n={s.avatar} size={28} />
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold">{s.nick}</span>
                  <span className="text-xs text-mute">{((s.amount / raid.target) * 100).toFixed(1)}%</span>
                  <Money v={s.amount} short size={11} className="w-20 text-right text-xs" />
                  {pay !== null && <span className={cx('w-24 text-right text-sm font-extrabold', pay >= s.amount ? 'text-ok' : 'text-mute')} data-testid="raid-payout">+{fmt(pay)}</span>}
                </div>
              )
            })}
          </div>
        ) : <p className="py-3 text-center text-sm text-mute">Пока никто не вложился</p>}
      </Section>

      <Section className="!p-3 text-[11px] text-mute">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <span className="inline-flex items-center gap-1 font-bold text-ok"><ShieldCheck size={13} />Один ролл на всех, исход определён сидом</span>
          <span className="break-all">хеш сида: {raid.seed_hash}</span>
          {raid.seed && <Link className="font-bold text-gold" to={`/fair?seed=${raid.seed}&client=${raid.id}&nonce=0&case=${raid.case}`}>проверить</Link>}
        </div>
      </Section>
    </div>
  )
}

export default Raids
