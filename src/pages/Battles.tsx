import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Bot, ChevronLeft, Copy, Crown, Eye, Lock, Plus, ShieldCheck, Swords, Users, X } from 'lucide-react'
import { BATTLE, BATTLE_FORMATS, BATTLE_MODES } from '../config/economy'
import { CATALOG, caseOf } from '../shared/catalog'
import { battleDurationMs, teamOf } from '../shared/battle'
import { rpc, type Battle, type BattleDrop, type Me } from '../lib/api'
import { applyMe, useGame } from '../store/game'
import { sfx } from '../audio/sfx'
import { Roulette } from '../components/Roulette'
import { Avatar, Btn, CaseCover, Confetti, Empty, ItemArt, Modal, Money, Section, cx, rc, useNow } from '../components/ui'

const modeName = (id: string) => BATTLE_MODES.find((m) => m.id === id)?.name ?? id
const formatName = (id: string) => BATTLE_FORMATS.find((f) => f.id === id)?.name ?? id
const TEAM_COLORS = ['#52a8ff', '#ff4655', '#3ddc97', '#ffc93c']

/* ------------------------------ список ---------------------------------- */
function BattleRow({ b }: { b: Battle }) {
  const me = useGame((s) => s.me)!
  const now = useNow()
  const live = b.status === 'done' && b.ends_at !== null && now < b.ends_at
  const free = b.players.filter((p) => !p).length
  return (
    <Link to={'/battle/' + b.id} data-testid="battle-row" className="glass flex flex-wrap items-center gap-3 rounded-2xl p-3 transition hover:border-white/25">
      <div className="flex -space-x-2">
        {b.players.map((p, i) => (p ? <Avatar key={i} n={p.avatar} size={34} ring={TEAM_COLORS[teamOf(b.format, i)]} /> : <span key={i} className="grid size-[34px] place-items-center rounded-full border border-dashed border-white/25 bg-bg text-white/30"><Plus size={14} /></span>))}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5 text-xs font-bold">
          <span className="rounded bg-white/10 px-1.5 py-0.5">{formatName(b.format)}</span>
          <span className="rounded bg-gold/15 px-1.5 py-0.5 text-gold">{modeName(b.mode)}</span>
          {b.private && <Lock size={12} className="text-mute" />}
          {live && <span className="flex items-center gap-1 text-bad"><span className="size-1.5 animate-pulse rounded-full bg-bad" />идёт</span>}
          {b.status === 'done' && !live && <span className="text-mute">завершён</span>}
        </div>
        <div className="mt-1 flex items-center gap-1 overflow-hidden">
          {b.cases.slice(0, 8).map((c, i) => <CaseCover key={i} c={caseOf(c)} size={30} />)}
          {b.cases.length > 8 && <span className="text-xs text-mute">+{b.cases.length - 8}</span>}
        </div>
      </div>
      <div className="text-right">
        <Money v={b.cost} className="display text-sm font-extrabold" />
        <div className="mt-1 text-[11px] font-bold text-mute">
          {b.status === 'open' ? (b.players.some((p) => p?.pid === me.id) ? 'ты в лобби' : `свободно ${free}`) : <span className="inline-flex items-center gap-1"><Eye size={12} />смотреть</span>}
        </div>
      </div>
    </Link>
  )
}

function CreateModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const me = useGame((s) => s.me)!
  const run = useGame((s) => s.run)
  const nav = useNavigate()
  const [cases, setCases] = useState<string[]>([])
  const [format, setFormat] = useState('1v1')
  const [mode, setMode] = useState('classic')
  const [priv, setPriv] = useState(false)
  const [bots, setBots] = useState(false)
  const [busy, setBusy] = useState(false)
  const cost = cases.reduce((a, c) => a + caseOf(c).price, 0)
  const all = CATALOG.cases.filter((c) => c.category !== 'free')
  const create = async () => {
    setBusy(true)
    const r = await run(async () => {
      let x = applyMe(await rpc<{ battle: Battle; me: Me }>('battle_create', { p_cases: cases, p_format: format, p_mode: mode, p_private: priv }))
      if (bots) x = applyMe(await rpc<{ battle: Battle; me: Me }>('battle_add_bot', { p_id: x.battle.id }))
      return x
    })
    setBusy(false)
    if (r) {
      sfx('start')
      onClose()
      nav('/battle/' + r.battle.id)
    }
  }
  return (
    <Modal open={open} onClose={onClose} title="Новый батл" wide>
      <div className="space-y-4">
        <div>
          <div className="mb-1.5 text-xs font-bold text-mute">Формат</div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {BATTLE_FORMATS.map((f) => (
              <button key={f.id} onClick={() => setFormat(f.id)} data-testid={'fmt-' + f.id} className={cx('h-11 rounded-xl text-sm font-bold', format === f.id ? 'bg-white/15 text-gold ring-1 ring-gold/50' : 'bg-white/6 text-mute')}>{f.id}</button>
            ))}
          </div>
        </div>
        <div>
          <div className="mb-1.5 text-xs font-bold text-mute">Режим</div>
          <div className="grid gap-2 sm:grid-cols-2">
            {BATTLE_MODES.map((m) => (
              <button key={m.id} onClick={() => setMode(m.id)} data-testid={'mode-' + m.id} className={cx('rounded-xl px-3 py-2 text-left', mode === m.id ? 'bg-white/15 ring-1 ring-gold/50' : 'bg-white/6')}>
                <div className={cx('text-sm font-bold', mode === m.id && 'text-gold')}>{m.name}</div>
                <div className="text-[11px] text-mute">{m.desc}</div>
              </button>
            ))}
          </div>
        </div>
        <div>
          <div className="mb-1.5 flex items-center justify-between text-xs font-bold text-mute"><span>Кейсы по раундам ({cases.length}/{BATTLE.maxRounds})</span>{cases.length > 0 && <button className="text-bad" onClick={() => setCases([])}>очистить</button>}</div>
          <div className="flex min-h-14 flex-wrap gap-1.5 rounded-xl bg-black/25 p-2">
            {cases.length === 0 && <span className="self-center px-1 text-xs text-mute">Нажимай на кейсы ниже — каждый станет раундом</span>}
            {cases.map((c, i) => (
              <button key={i} onClick={() => setCases((a) => a.filter((_, k) => k !== i))} className="relative" title="Убрать">
                <CaseCover c={caseOf(c)} size={44} /><X size={12} className="absolute -right-0.5 -top-0.5 rounded-full bg-bad text-white" />
              </button>
            ))}
          </div>
          <div className="mt-2 grid max-h-52 grid-cols-4 gap-1.5 overflow-y-auto sm:grid-cols-7">
            {all.map((c) => (
              <button key={c.id} disabled={cases.length >= BATTLE.maxRounds} onClick={() => { sfx('click'); setCases((a) => [...a, c.id]) }} data-testid={'pick-' + c.id}
                className="flex flex-col items-center rounded-xl bg-white/5 p-1 hover:bg-white/10 disabled:opacity-40">
                <CaseCover c={c} size={46} />
                <div className="w-full truncate text-[9px] font-bold">{c.name}</div>
                <Money v={c.price} short size={9} className="text-[9px] text-mute" />
              </button>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap gap-4 text-sm">
          <label className="flex items-center gap-2"><input type="checkbox" checked={bots} onChange={(e) => setBots(e.target.checked)} data-testid="with-bots" className="size-4 accent-[#ffc93c]" />Сразу с ботами</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={priv} onChange={(e) => setPriv(e.target.checked)} className="size-4 accent-[#ffc93c]" />Приватный (только по ссылке)</label>
        </div>
        <Btn kind="gold" className="h-12 w-full text-base" disabled={!cases.length || me.balance < cost} busy={busy} onClick={create} testId="battle-create">
          {me.balance < cost ? 'Не хватает монет' : <>Создать за <Money v={cost} /></>}
        </Btn>
      </div>
    </Modal>
  )
}

export function Battles() {
  const battles = useGame((s) => s.battles)
  const [open, setOpen] = useState(false)
  const lobby = battles.filter((b) => b.status === 'open')
  const rest = battles.filter((b) => b.status === 'done')
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="display text-xl sm:text-2xl font-extrabold">Батлы</h1>
          <p className="text-xs text-mute">Все открывают одни и те же кейсы. Кто забирает банк — решает режим.</p>
        </div>
        <Btn kind="gold" onClick={() => setOpen(true)} testId="battle-new"><Plus size={16} />Создать</Btn>
      </div>
      <Section title="Ждут игроков">
        {lobby.length ? <div className="space-y-2">{lobby.map((b) => <BattleRow key={b.id} b={b} />)}</div> : <Empty icon={Swords}>Открытых батлов нет — создай свой и позови друзей или ботов</Empty>}
      </Section>
      {rest.length > 0 && <Section title="Идут и недавние"><div className="space-y-2">{rest.map((b) => <BattleRow key={b.id} b={b} />)}</div></Section>}
      <CreateModal open={open} onClose={() => setOpen(false)} />
    </div>
  )
}

/* ------------------------------ комната --------------------------------- */
function DropChip({ d }: { d: BattleDrop }) {
  return (
    <div className="item-card flex items-center gap-1 !rounded-lg px-1 py-0.5" style={{ '--rc': rc(d.rarity) } as any}>
      <ItemArt i={d} className="h-6 w-9" />
      <Money v={d.price} short size={9} className="text-[10px] font-bold" />
    </div>
  )
}

export function BattleRoom() {
  const { id } = useParams()
  const nav = useNavigate()
  const me = useGame((s) => s.me)!
  const run = useGame((s) => s.run)
  const listed = useGame((s) => s.battles.find((b) => b.id === id))
  const [b, setB] = useState<Battle | null>(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [confetti, setConfetti] = useState(0)
  const now = useNow(200)
  const fetching = useRef(false)
  const lastFetch = useRef(0)
  const celebrated = useRef(false)
  const spun = useRef(new Set<number>())

  const load = async () => {
    if (fetching.current || !id) return
    fetching.current = true
    lastFetch.current = Date.now()
    try {
      setB(await rpc<Battle>('get_battle', { p_id: id }))
    } catch (e: any) {
      setErr(e.message)
    }
    fetching.current = false
  }
  useEffect(() => {
    setB(null)
    celebrated.current = false
    spun.current = new Set()
    void load()
  }, [id]) // eslint-disable-line react-hooks/exhaustive-deps
  // изменения в лобби (кто-то сел/вышел, батл стартовал) приходят через общий sync
  const sig = listed ? listed.status + JSON.stringify(listed.players.map((p) => p?.nick ?? null)) : ''
  useEffect(() => {
    if (sig && b && b.status === 'open') void load()
  }, [sig]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (b?.status !== 'open') return
    const t = setInterval(load, 2500)
    return () => clearInterval(t)
  }, [b?.status]) // eslint-disable-line react-hooks/exhaustive-deps

  const started = b?.started_at ?? null
  const rounds = b?.cases.length ?? 0
  const t = started ? now - started : -1
  const total = battleDurationMs(rounds)
  const roundIdx = started ? Math.min(rounds - 1, Math.floor((t - BATTLE.countdownMs) / BATTLE.roundMs)) : -1
  const finalPhase = started !== null && t >= total - BATTLE.endMs
  const over = started !== null && t >= total

  // дозагрузка раундов/итога по мере наступления их времени
  useEffect(() => {
    if (!b || !started || Date.now() - lastFetch.current < 700) return
    const needRounds = Math.min(rounds, Math.max(0, Math.floor((t - BATTLE.countdownMs + 1300) / BATTLE.roundMs) + 1))
    if (b.rounds.length < needRounds || (finalPhase && !b.summary) || (over && !b.seed)) void load()
  }, [now]) // eslint-disable-line react-hooks/exhaustive-deps

  const mySlot = b?.players.findIndex((p) => p?.pid === me.id) ?? -1
  useEffect(() => {
    if (!b?.summary || !finalPhase || celebrated.current) return
    celebrated.current = true
    const won = mySlot >= 0 && b.summary.payouts[mySlot] > 0
    if (mySlot >= 0) sfx(won ? 'win' : 'fail')
    if (won) setConfetti(Date.now())
    setTimeout(() => void useGame.getState().sync(), BATTLE.endMs + 400)
  }, [b?.summary, finalPhase]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (started && t >= 0 && t < 600) sfx('start')
  }, [started]) // eslint-disable-line react-hooks/exhaustive-deps

  const act = async (fn: string, args: Record<string, unknown>) => {
    setBusy(true)
    const r = await run(async () => applyMe(await rpc<{ battle: Battle; me: Me }>(fn, args)))
    setBusy(false)
    if (r) setB(r.battle)
  }

  const sums = useMemo(() => {
    if (!b) return []
    const done = finalPhase ? rounds : Math.max(0, roundIdx + (t - BATTLE.countdownMs - roundIdx * BATTLE.roundMs >= BATTLE.roundMs - 350 ? 1 : 0))
    return b.players.map((_, s) => b.rounds.slice(0, done).reduce((a, r) => a + (r[s]?.price ?? 0), 0))
  }, [b, roundIdx, finalPhase, Math.floor(t / 300)]) // eslint-disable-line react-hooks/exhaustive-deps

  if (err) return <Empty icon={Swords}>{err} · <Link to="/battles" className="font-bold text-gold">к батлам</Link></Empty>
  if (!b) return <div className="h-64 animate-pulse rounded-3xl bg-white/5" />

  const isOwner = b.created_by === me.id
  const inRoundT = t - BATTLE.countdownMs - roundIdx * BATTLE.roundMs
  const cols = b.players.length
  const cur = roundIdx >= 0 && !finalPhase ? b.rounds[roundIdx] : null
  const freshSpin = cur && inRoundT < 1200 && !spun.current.has(roundIdx)
  if (cur && inRoundT < 1200) spun.current.add(roundIdx)
  const winTeam = finalPhase ? (b.summary?.winnerTeam ?? null) : null

  return (
    <div className="space-y-4" data-testid="battle-room" data-status={b.status} data-over={over ? '1' : '0'}>
      <Confetti fire={confetti} />
      <div className="flex flex-wrap items-center gap-3">
        <button onClick={() => nav('/battles')} aria-label="Назад" className="grid size-10 place-items-center rounded-full glass"><ChevronLeft size={18} /></button>
        <div className="min-w-0 flex-1">
          <h1 className="display text-lg sm:text-xl font-extrabold">Батл {formatName(b.format)} · <span className="text-gold">{modeName(b.mode)}</span></h1>
          <div className="text-xs text-mute">{BATTLE_MODES.find((m) => m.id === b.mode)?.desc} · вход <Money v={b.cost} size={11} /></div>
        </div>
        <button onClick={() => { void navigator.clipboard?.writeText(location.href); useGame.getState().toast('Ссылка скопирована — кидай друзьям', 'ok') }} className="glass flex h-10 items-center gap-1.5 rounded-xl px-3 text-xs font-bold"><Copy size={14} />Ссылка</button>
      </div>

      <div className="no-scrollbar flex gap-1.5 overflow-x-auto">
        {b.cases.map((c, i) => (
          <div key={i} className={cx('shrink-0 rounded-xl p-1 transition', i === roundIdx && !finalPhase ? 'bg-gold/20 ring-1 ring-gold' : i < roundIdx || finalPhase ? 'opacity-40' : 'bg-white/5')}>
            <CaseCover c={caseOf(c)} size={42} />
          </div>
        ))}
      </div>

      {b.status === 'cancelled' && <Section><Empty icon={X}>Батл отменён, взносы возвращены</Empty></Section>}

      {b.status !== 'cancelled' && (
        <div className="relative">
          {started !== null && t < BATTLE.countdownMs && (
            <div className="absolute inset-0 z-10 grid place-items-center rounded-3xl bg-bg/70 backdrop-blur-sm">
              <motion.div key={Math.ceil((BATTLE.countdownMs - t) / 1000)} initial={{ scale: 2, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="display text-7xl font-black gold-text">
                {Math.max(1, Math.ceil((BATTLE.countdownMs - t) / 1000))}
              </motion.div>
            </div>
          )}
          <div className={cx('grid gap-2', cols === 2 ? 'grid-cols-2' : cols === 3 ? 'grid-cols-3' : 'grid-cols-2 lg:grid-cols-4')}>
            {b.players.map((p, s) => {
              const team = teamOf(b.format, s)
              const color = TEAM_COLORS[team]
              const won = winTeam !== null && (winTeam === -1 || winTeam === team)
              const lost = winTeam !== null && !won
              return (
                <div key={s} data-testid={'slot-' + s} className={cx('glass min-w-0 rounded-2xl p-2 transition', won && 'ring-2 ring-gold shadow-[0_0_30px_rgba(255,201,60,.3)]', lost && 'opacity-50')}>
                  <div className="flex items-center gap-2">
                    {p ? <Avatar n={p.avatar} size={30} ring={color} /> : <span className="grid size-[30px] place-items-center rounded-full border border-dashed border-white/25 text-white/30"><Users size={13} /></span>}
                    <div className="min-w-0 flex-1 leading-tight">
                      <div className="flex items-center gap-1 truncate text-xs font-extrabold">
                        {p?.bot && <Bot size={12} className="shrink-0 text-mute" />}
                        <span className="truncate">{p?.nick ?? 'Свободно'}</span>
                        {won && winTeam !== -1 && <Crown size={12} className="shrink-0 text-gold" />}
                      </div>
                      <Money v={sums[s] ?? 0} short size={10} className="text-[11px] font-bold text-gold" />
                    </div>
                  </div>
                  <div className="mt-2">
                    {b.status === 'open' ? (
                      <div className="grid h-[84px] place-items-center rounded-xl border border-dashed border-white/12 bg-black/20">
                        {p ? <span className="text-[11px] font-bold text-ok">готов</span> : (
                          <div className="flex flex-col gap-1">
                            {mySlot < 0 && <Btn kind="gold" className="!min-h-8 !px-3 text-xs" busy={busy} onClick={() => act('battle_join', { p_id: b.id, p_slot: s })} testId={'join-' + s}>Сесть</Btn>}
                            {isOwner && <Btn kind="soft" className="!min-h-8 !px-3 text-xs" busy={busy} onClick={() => act('battle_add_bot', { p_id: b.id, p_slot: s })} testId={'bot-' + s}><Bot size={13} />Бот</Btn>}
                          </div>
                        )}
                      </div>
                    ) : cur ? (
                      <Roulette key={roundIdx} c={caseOf(b.cases[roundIdx])} result={cur[s]} spinId={freshSpin || spun.current.has(roundIdx) ? roundIdx + 1 : 0} fast={false} height={84} ticks={s === 0} />
                    ) : (
                      <div className="grid h-[84px] place-items-center rounded-xl bg-black/25 text-center">
                        {finalPhase && b.summary ? (
                          <div><div className="text-[10px] font-bold text-mute">{b.summary.payouts[s] > 0 ? 'забирает' : 'без выплаты'}</div>
                            <Money v={b.summary.payouts[s]} className={cx('display text-base font-extrabold', b.summary.payouts[s] > 0 ? 'text-ok' : 'text-mute')} /></div>
                        ) : <span className="text-[11px] text-mute">{finalPhase ? 'Считаем…' : 'Готовимся…'}</span>}
                      </div>
                    )}
                  </div>
                  <div className="mt-2 flex min-h-8 flex-wrap gap-1">
                    {b.rounds.slice(0, finalPhase ? rounds : Math.max(0, roundIdx)).map((r, i) => r[s] && <DropChip key={i} d={r[s]} />)}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {b.status === 'open' && (
        <div className="flex flex-wrap justify-center gap-2">
          {isOwner && <Btn kind="gold" busy={busy} onClick={() => act('battle_add_bot', { p_id: b.id })} testId="fill-bots"><Bot size={16} />Заполнить ботами и начать</Btn>}
          {mySlot >= 0 && <Btn kind="danger" busy={busy} onClick={() => act('battle_leave', { p_id: b.id })} testId="battle-leave">{isOwner ? 'Отменить батл' : 'Выйти'}</Btn>}
        </div>
      )}

      <Section className="!p-3 text-[11px] text-mute">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <span className="inline-flex items-center gap-1 font-bold text-ok"><ShieldCheck size={13} />Честный батл</span>
          <span className="break-all">хеш сида: {b.seed_hash}</span>
          {b.seed && <span className="break-all text-white/80">сид: {b.seed}</span>}
          {b.seed && <Link className="font-bold text-gold" to={`/fair?seed=${b.seed}&client=${b.id}&nonce=0&case=${b.cases[0]}`}>проверить</Link>}
          {!b.seed && <span>сид раскроется после батла</span>}
        </div>
      </Section>
    </div>
  )
}
