import { useEffect, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { Check, LogOut, RefreshCw, ShieldCheck } from 'lucide-react'
import { ACHIEVEMENTS, COIN, LIMITS } from '../config/economy'
import { CATALOG } from '../shared/catalog'
import { hmacHexSync, rollMessage, sha256HexSync, splitRoll } from '../shared/fair'
import { rollDrop } from '../shared/roll'
import { TICKETS, fmt } from '../shared/money'
import { rpc, type Me } from '../lib/api'
import { applyMe, useGame } from '../store/game'
import { sfx } from '../audio/sfx'
import { Avatar, Bar, Btn, Empty, ItemCard, Money, Section, cx, itemTitle } from '../components/ui'

const MONEY = new Set(['peak'])
const STAT_ROWS: [string, string, boolean][] = [
  ['opened', 'Открыто кейсов', false], ['spent', 'Потрачено', true], ['earned', 'Получено дропами', true], ['best_drop', 'Лучший дроп', true],
  ['upgrades', 'Апгрейдов', false], ['upgrade_wins', 'Удачных апгрейдов', false], ['contracts', 'Контрактов', false], ['battles', 'Батлов', false],
  ['battle_wins', 'Побед в батлах', false], ['battle_winnings', 'Выиграно в батлах', true], ['specials', 'Ножей и перчаток', false], ['peak', 'Пик баланса', true],
]

export function Profile() {
  const { nick } = useParams()
  const me = useGame((s) => s.me)!
  const run = useGame((s) => s.run)
  const logout = useGame((s) => s.logout)
  const own = !nick || nick.toLowerCase() === me.nick.toLowerCase()
  const [other, setOther] = useState<any>(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState('')
  useEffect(() => {
    setOther(null)
    setErr('')
    if (!own) void rpc('get_profile', { p_nick: nick }).then(setOther).catch((e) => setErr(e.message))
  }, [nick, own])
  if (err) return <Empty>{err}</Empty>
  const p = own ? { ...me, ach: me.claims.filter((c) => c.startsWith('ach:')).map((c) => c.slice(4)) } : other
  if (!p) return <div className="h-64 animate-pulse rounded-3xl bg-white/5" />
  const stat = (k: string) => (k === 'peak' ? Math.max(p.stats.peak ?? 0, p.balance) : (p.stats[k] ?? 0))
  const claim = async (id: string) => {
    setBusy(id)
    const r = await run(async () => applyMe(await rpc<{ reward: any; me: Me }>('claim', { p_kind: 'ach', p_id: id })))
    setBusy('')
    if (r) {
      sfx('coin')
      useGame.getState().toast(`Достижение: +${fmt(r.reward.coins)}`, 'ok')
    }
  }
  return (
    <div className="space-y-4">
      <Section>
        <div className="flex flex-wrap items-center gap-4">
          <Avatar n={p.avatar} size={72} />
          <div className="min-w-0 flex-1">
            <h1 className="display truncate text-xl sm:text-2xl font-extrabold" data-testid="profile-nick">{p.nick}</h1>
            <div className="text-xs text-mute">уровень {p.level} · предметов {p.inv_count} на <Money v={p.inv_value} size={11} /></div>
            <Money v={p.balance} className="display mt-1 text-lg font-extrabold text-gold" />
          </div>
          {own && (
            <div className="flex gap-2">
              <Link to="/fair" className="glass flex h-10 items-center gap-1.5 rounded-xl px-3 text-xs font-bold"><ShieldCheck size={14} className="text-ok" />Честность</Link>
              <Btn kind="ghost" onClick={logout} testId="logout"><LogOut size={15} />Выйти</Btn>
            </div>
          )}
        </div>
        {own && (
          <div className="mt-4 border-t border-line pt-3">
            <div className="mb-2 text-xs font-bold text-mute">Сменить аватар</div>
            <div className="flex flex-wrap gap-1.5">
              {Array.from({ length: LIMITS.avatars }, (_, i) => (
                <button key={i} aria-label={'Аватар ' + (i + 1)} onClick={() => run(async () => applyMe(await rpc<{ me: Me }>('set_avatar', { p_avatar: i })))} className={cx('rounded-full p-0.5', me.avatar === i ? 'ring-2 ring-gold' : 'opacity-50 hover:opacity-100')}><Avatar n={i} size={30} /></button>
              ))}
            </div>
          </div>
        )}
      </Section>

      <Section title="Витрина лучших дропов">
        {p.best.length ? <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" data-testid="showcase">{p.best.map((b: any, i: number) => <ItemCard key={i} i={b} footer={<div className="mt-0.5 truncate text-[10px] text-mute">«{CATALOG.caseById.get(b.case)?.name}»{b.x ? ` · x${(b.x / 100).toFixed(1)}` : ''}</div>} />)}</div> : <Empty>Витрина пуста — редкие дропы появятся здесь сами</Empty>}
      </Section>

      <Section title="Статистика">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {STAT_ROWS.map(([k, label, money]) => (
            <div key={k} className="rounded-2xl bg-black/20 p-3">
              <div className="text-[11px] text-mute">{label}</div>
              <div className="display mt-0.5 text-sm font-extrabold">{money ? <Money v={stat(k)} short /> : stat(k).toLocaleString('ru-RU')}</div>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Достижения" right={<span className="text-xs text-mute">{p.ach.length}/{ACHIEVEMENTS.length}</span>}>
        <div className="grid gap-2 sm:grid-cols-2">
          {ACHIEVEMENTS.map((a) => {
            const got = p.ach.includes(a.id)
            const goal = MONEY.has(a.metric) ? a.goal * COIN : a.goal
            const v = stat(a.metric)
            const done = v >= goal
            return (
              <div key={a.id} className={cx('flex items-center gap-3 rounded-2xl bg-black/20 p-3', got && 'border border-gold/30')} data-testid={'ach-' + a.id}>
                <div className="min-w-0 flex-1">
                  <div className={cx('text-sm font-bold', got && 'text-gold')}>{a.title}</div>
                  <div className="text-[11px] text-mute">{a.desc} · <Money v={a.coins * COIN} size={10} /></div>
                  {!got && <div className="mt-1.5"><Bar v={v} max={goal} color={done ? 'var(--color-ok)' : undefined} /></div>}
                </div>
                {got ? <Check size={18} className="shrink-0 text-gold" /> : own && done ? <Btn kind="gold" className="!min-h-9 !px-3 text-xs" busy={busy === a.id} onClick={() => claim(a.id)} testId={'claim-ach-' + a.id}>Забрать</Btn> : null}
              </div>
            )
          })}
        </div>
      </Section>
    </div>
  )
}

/* ============================== ЧЕСТНОСТЬ =============================== */
export function Fair() {
  const me = useGame((s) => s.me)!
  const run = useGame((s) => s.run)
  const [sp] = useSearchParams()
  const [rolls, setRolls] = useState<any[] | null>(null)
  const [client, setClient] = useState(me.fair.client_seed)
  const [revealed, setRevealed] = useState<{ server_seed: string; hash: string } | null>(null)
  const [f, setF] = useState({ seed: sp.get('seed') ?? '', client: sp.get('client') ?? '', nonce: sp.get('nonce') ?? '1', case: sp.get('case') ?? 'sigma' })
  const load = () => void rpc<any[]>('fair_rolls', { p_limit: 40 }).then(setRolls).catch(() => setRolls([]))
  useEffect(load, [])

  const calc = (() => {
    const c = CATALOG.caseById.get(f.case)
    if (!f.seed || !c) return null
    try {
      const hex = hmacHexSync(f.seed, rollMessage(f.client, Number(f.nonce) || 0))
      const n = splitRoll(hex)
      return { hex, n, hash: sha256HexSync(f.seed), drop: rollDrop(c, n), ticket: n.n0 % TICKETS, up: n.n0 % 1_000_000 }
    } catch {
      return null
    }
  })()
  const rotate = async () => {
    const r = await run(() => rpc<{ revealed: any; fair: Me['fair'] }>('fair_rotate'))
    if (r) {
      setRevealed(r.revealed)
      useGame.setState({ me: { ...useGame.getState().me!, fair: r.fair } })
      load()
    }
  }
  const saveClient = async () => {
    const r = await run(() => rpc<Me['fair']>('fair_set_client_seed', { p_seed: client }))
    if (r) {
      useGame.setState({ me: { ...useGame.getState().me!, fair: r } })
      useGame.getState().toast('Client seed сохранён', 'ok')
    }
  }
  const input = 'h-10 w-full rounded-xl border border-line bg-white/5 px-3 text-xs font-mono outline-none focus:border-gold/50'
  return (
    <div className="space-y-4">
      <div>
        <h1 className="display text-xl sm:text-2xl font-extrabold">Проверка честности</h1>
        <p className="text-xs text-mute">Сервер заранее показывает хеш своего сида. Результат = HMAC-SHA256(server seed, «client seed:nonce»). Подменить исход задним числом нельзя — сид не сойдётся с хешем.</p>
      </div>
      <Section title="Твои сиды">
        <div className="space-y-3 text-xs">
          <div><div className="mb-1 font-bold text-mute">Хеш текущего server seed (SHA-256)</div><div className="break-all rounded-xl bg-black/25 p-3 font-mono" data-testid="fair-hash">{me.fair.hash}</div></div>
          <div className="flex flex-wrap items-end gap-2">
            <label className="min-w-48 flex-1"><div className="mb-1 font-bold text-mute">Client seed (можно менять)</div><input className={input} value={client} onChange={(e) => setClient(e.target.value)} maxLength={64} data-testid="client-seed" /></label>
            <Btn kind="soft" className="!min-h-10" onClick={saveClient} disabled={client === me.fair.client_seed || !client.trim()}>Сохранить</Btn>
            <div className="rounded-xl bg-black/25 px-3 py-2.5">nonce: <b data-testid="fair-nonce">{me.fair.nonce}</b></div>
          </div>
          <Btn kind="gold" onClick={rotate} testId="fair-rotate"><RefreshCw size={15} />Раскрыть сид и получить новый</Btn>
          {revealed && <div className="rounded-xl border border-ok/30 bg-ok/10 p-3"><div className="font-bold text-ok">Раскрытый server seed</div><div className="mt-1 break-all font-mono" data-testid="revealed-seed">{revealed.server_seed}</div><div className="mt-1 text-mute">Его SHA-256 = {sha256HexSync(revealed.server_seed) === revealed.hash ? '✓ совпадает с показанным хешем' : '✗ НЕ совпадает'}</div></div>}
        </div>
      </Section>

      <Section title="Калькулятор">
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="text-[11px] font-bold text-mute sm:col-span-2">Server seed<input className={input} value={f.seed} onChange={(e) => setF({ ...f, seed: e.target.value.trim() })} placeholder="раскрытый сид" data-testid="calc-seed" /></label>
          <label className="text-[11px] font-bold text-mute">Client seed (для батла — его id)<input className={input} value={f.client} onChange={(e) => setF({ ...f, client: e.target.value })} data-testid="calc-client" /></label>
          <label className="text-[11px] font-bold text-mute">Nonce (в батле: раунд×10 + место, с нуля)<input className={input} value={f.nonce} onChange={(e) => setF({ ...f, nonce: e.target.value })} inputMode="numeric" data-testid="calc-nonce" /></label>
          <label className="text-[11px] font-bold text-mute sm:col-span-2">Кейс<select className={cx(input, 'bg-panel font-sans')} value={f.case} onChange={(e) => setF({ ...f, case: e.target.value })} data-testid="calc-case">{CATALOG.cases.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
        </div>
        {calc ? (
          <div className="mt-3 grid gap-3 text-xs sm:grid-cols-[1fr_180px]" data-testid="calc-result">
            <div className="space-y-1 break-all rounded-xl bg-black/25 p-3 font-mono">
              <div><span className="text-mute">sha256(seed):</span> {calc.hash}</div>
              <div><span className="text-mute">hmac:</span> {calc.hex}</div>
              <div><span className="text-mute">билет:</span> {calc.ticket.toLocaleString('ru-RU')} из 1 000 000 000</div>
              <div><span className="text-mute">износ:</span> {(calc.drop.fi / 10000).toFixed(4)} · <span className="text-mute">счётчик:</span> {calc.drop.st ? 'да' : 'нет'}</div>
              <div><span className="text-mute">ролл апгрейда:</span> {(calc.up / 10000).toFixed(4)} % (победа, если меньше шанса)</div>
            </div>
            <ItemCard i={{ item: calc.drop.itemId, phase: calc.drop.phase, rarity: CATALOG.itemById.get(calc.drop.itemId)!.rarity, fi: calc.drop.fi, st: calc.drop.st, price: calc.drop.price }} />
          </div>
        ) : <p className="mt-3 text-xs text-mute">Вставь раскрытый сид — покажу, какой предмет он даёт.</p>}
      </Section>

      <Section title="Журнал роллов" right={<span className="text-xs text-mute">сид виден после раскрытия</span>}>
        {!rolls ? <div className="h-24 animate-pulse rounded-2xl bg-white/5" /> : rolls.length === 0 ? <Empty>Роллов пока нет</Empty> : (
          <div className="divide-y divide-line text-xs" data-testid="fair-rolls">
            {rolls.map((r) => {
              const d = r.detail
              const name = d.item ? (() => { const t = itemTitle({ item: d.item, phase: d.phase ?? 0, rarity: 0, fi: d.fi ?? 5000, st: false, price: 0 }); return `${t.weapon} | ${t.skin}` })() : ''
              return (
                <div key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                  <span className="w-20 font-bold">{r.kind === 'case' ? 'Кейс' : r.kind === 'upgrade' ? 'Апгрейд' : 'Контракт'}</span>
                  <span className="text-mute">nonce {r.nonce}</span>
                  <span className="min-w-0 flex-1 truncate">{r.kind === 'upgrade' ? `${d.win ? 'успех' : 'мимо'} · шанс ${(d.ppm / 10000).toFixed(2)} % · ролл ${(d.roll / 10000).toFixed(2)}` : name}</span>
                  {d.price ? <Money v={d.price} short size={10} /> : null}
                  {r.server_seed ? <button className="font-bold text-gold" data-testid="verify-roll" onClick={() => { setF({ seed: r.server_seed, client: r.client_seed, nonce: String(r.nonce), case: d.case ?? f.case }); window.scrollTo({ top: 0, behavior: 'smooth' }) }}>проверить</button> : <span className="text-mute">сид скрыт</span>}
                </div>
              )
            })}
          </div>
        )}
      </Section>
    </div>
  )
}
