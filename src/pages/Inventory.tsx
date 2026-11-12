import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Backpack, CheckCheck, FileSignature, Search, Trash2, TrendingUp, X } from 'lucide-react'
import { RARITIES } from '../config/economy'
import { CATALOG } from '../shared/catalog'
import { COIN } from '../config/economy'
import { rpc, type Item, type Me } from '../lib/api'
import { applyMe, useGame } from '../store/game'
import { sfx } from '../audio/sfx'
import { Btn, Empty, ItemCard, Modal, Money, Section, cx, rc } from '../components/ui'

/** Загружает инвентарь при первом заходе и отдаёт его. */
export function useItems(): { items: Item[]; loaded: boolean } {
  const items = useGame((s) => s.items)
  const loaded = useGame((s) => s.itemsLoaded)
  useEffect(() => {
    void useGame.getState().loadItems().catch(() => {})
  }, [])
  return { items, loaded }
}

export type SortKey = 'price-desc' | 'price-asc' | 'new'
export function sortItems(items: Item[], sort: SortKey): Item[] {
  const a = [...items]
  if (sort === 'price-desc') a.sort((x, y) => y.price - x.price || y.id - x.id)
  if (sort === 'price-asc') a.sort((x, y) => x.price - y.price || x.id - y.id)
  if (sort === 'new') a.sort((x, y) => y.id - x.id)
  return a
}

export function RarityFilter({ value, onChange, counts }: { value: number | null; onChange: (r: number | null) => void; counts?: number[] }) {
  return (
    <div className="no-scrollbar -mx-1 flex gap-1.5 overflow-x-auto px-1">
      <button onClick={() => onChange(null)} className={cx('h-9 shrink-0 rounded-lg px-3 text-xs font-bold', value === null ? 'bg-white/15 text-white' : 'bg-white/5 text-mute')}>Все</button>
      {RARITIES.map((r, i) => (
        <button key={r.id} onClick={() => onChange(value === i ? null : i)} title={r.name}
          className={cx('flex h-9 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-xs font-bold', value === i ? 'bg-white/15 text-white' : 'bg-white/5 text-mute')}>
          <span className="size-2.5 rounded-full" style={{ background: rc(i), boxShadow: `0 0 8px ${rc(i)}` }} />
          <span className="hidden sm:inline">{r.name}</span>
          {counts && counts[i] > 0 && <span className="text-[10px] opacity-70">{counts[i]}</span>}
        </button>
      ))}
    </div>
  )
}

export default function Inventory() {
  const { items, loaded } = useItems()
  const run = useGame((s) => s.run)
  const [rarity, setRarity] = useState<number | null>(null)
  const [kind, setKind] = useState('all')
  const [q, setQ] = useState('')
  const [sort, setSort] = useState<SortKey>('price-desc')
  const [sel, setSel] = useState<Set<number>>(new Set())
  const [limit, setLimit] = useState(90)
  const [below, setBelow] = useState('')
  const [confirm, setConfirm] = useState<null | { title: string; n: number; sum: number; go: () => Promise<void> }>(null)
  const [busy, setBusy] = useState(false)
  const [fo, setFo] = useState(false)

  const view = useMemo(() => {
    const s = q.trim().toLowerCase()
    return sortItems(
      items.filter((i) => {
        if (rarity !== null && i.rarity !== rarity) return false
        const d = CATALOG.itemById.get(i.item)
        if (kind !== 'all' && d?.kind !== kind) return false
        if (s && !(d?.name.toLowerCase().includes(s) || CATALOG.caseById.get(i.case)?.name.toLowerCase().includes(s))) return false
        return true
      }),
      sort,
    )
  }, [items, rarity, kind, q, sort])
  const counts = useMemo(() => RARITIES.map((_, r) => items.filter((i) => i.rarity === r).length), [items])
  const total = items.reduce((a, i) => a + i.price, 0)
  const selItems = items.filter((i) => sel.has(i.id))
  const selSum = selItems.reduce((a, i) => a + i.price, 0)
  const belowK = Math.round((parseFloat(below.replace(',', '.')) || 0) * COIN)
  const belowItems = belowK > 0 ? items.filter((i) => i.price <= belowK) : []

  const toggle = (id: number) => {
    sfx('click')
    setSel((s) => {
      const n = new Set(s)
      n.has(id) ? n.delete(id) : n.add(id)
      return n
    })
  }
  const done = (r: { amount: number; sold: number; me: Me; removed: number[] } | null) => {
    if (!r) return
    sfx('sell')
    useGame.getState().removeItems(r.removed)
    setSel(new Set())
    useGame.getState().toast(`Продано ${r.sold} шт.`, 'ok')
  }
  const sellIds = async (ids: number[]) => done(await run(async () => applyMe(await rpc<any>('sell_items', { p_ids: ids }))))
  const sellBelow = async (max: number) => done(await run(async () => applyMe(await rpc<any>('sell_below', { p_max_price: max }))))
  const ask = (title: string, n: number, sum: number, go: () => Promise<void>) => setConfirm({ title, n, sum, go })

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="display text-xl sm:text-2xl font-extrabold">Инвентарь</h1>
          <div className="text-xs text-mute" data-testid="inv-summary">{items.length} предметов на <Money v={total} className="font-bold text-white" size={12} /></div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link to="/upgrade" className="glass flex h-10 items-center gap-1.5 rounded-xl px-3 text-xs font-bold"><TrendingUp size={14} className="text-gold" />Апгрейд</Link>
          <Link to="/contracts" className="glass flex h-10 items-center gap-1.5 rounded-xl px-3 text-xs font-bold"><FileSignature size={14} className="text-gold" />Контракт</Link>
        </div>
      </div>

      <Section className="!p-3 space-y-3">
        <button onClick={() => setFo((x) => !x)} data-testid="filters-toggle" className="flex h-11 w-full items-center justify-between rounded-xl bg-white/6 px-3 text-sm font-bold sm:hidden">Фильтры и массовая продажа<span className="text-mute">{fo ? '▲' : '▼'}</span></button>
        <div className={cx('space-y-3', !fo && 'hidden sm:block sm:space-y-3')}>
        <RarityFilter value={rarity} onChange={setRarity} counts={counts} />
        <div className="flex flex-wrap gap-2">
          <label className="relative min-w-40 flex-1">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-mute" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Поиск по названию или кейсу" className="h-10 w-full rounded-xl border border-line bg-white/5 pl-9 pr-3 text-sm outline-none focus:border-gold/50" />
          </label>
          <select value={kind} onChange={(e) => setKind(e.target.value)} className="h-10 rounded-xl border border-line bg-panel px-3 text-sm font-semibold" aria-label="Тип">
            <option value="all">Всё</option><option value="gun">Оружие</option><option value="knife">Ножи</option><option value="glove">Перчатки</option>
          </select>
          <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} className="h-10 rounded-xl border border-line bg-panel px-3 text-sm font-semibold" aria-label="Сортировка" data-testid="sort">
            <option value="price-desc">Сначала дорогие</option><option value="price-asc">Сначала дешёвые</option><option value="new">Сначала новые</option>
          </select>
        </div>
        <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
          <Btn kind="soft" className="!min-h-10 text-xs" onClick={() => setSel(new Set(sel.size === view.length ? [] : view.map((i) => i.id)))} disabled={!view.length}>
            <CheckCheck size={14} />{sel.size === view.length && view.length ? 'Снять выбор' : 'Выбрать всё на экране'}
          </Btn>
          <div className="flex items-center gap-1.5">
            <input value={below} onChange={(e) => setBelow(e.target.value)} inputMode="decimal" placeholder="дешевле, монет" data-testid="below-input" className="h-10 w-32 rounded-xl border border-line bg-white/5 px-3 text-sm outline-none focus:border-gold/50" />
            <Btn kind="soft" className="!min-h-10 text-xs" disabled={!belowItems.length} testId="sell-below"
              onClick={() => ask(`Продать всё дешевле ${below}`, belowItems.length, belowItems.reduce((a, i) => a + i.price, 0), () => sellBelow(belowK))}>
              Продать ({belowItems.length})
            </Btn>
          </div>
          <Btn kind="danger" className="!min-h-10 ml-auto text-xs" disabled={!items.length} testId="sell-all" onClick={() => ask('Продать весь инвентарь', items.length, total, () => sellBelow(1e15))}>
            <Trash2 size={14} />Продать всё
          </Btn>
        </div>
        </div>
      </Section>

      {!loaded ? (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-5 lg:grid-cols-6">{Array.from({ length: 12 }, (_, i) => <div key={i} className="h-36 animate-pulse rounded-2xl bg-white/5" />)}</div>
      ) : view.length === 0 ? (
        <Empty icon={Backpack}>{items.length ? 'Под фильтр ничего не подошло' : <>Пусто. <Link to="/" className="text-gold font-bold">Открой кейс</Link> — и здесь появятся предметы.</>}</Empty>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5 2xl:grid-cols-7" data-testid="inv-grid">
            {view.slice(0, limit).map((i) => <ItemCard key={i.id} i={i} selected={sel.has(i.id)} onClick={() => toggle(i.id)} />)}
          </div>
          {view.length > limit && <Btn kind="soft" className="mx-auto flex" onClick={() => setLimit((l) => l + 120)}>Показать ещё ({view.length - limit})</Btn>}
        </>
      )}

      {sel.size > 0 && (
        <div className="fixed inset-x-3 bottom-20 z-30 mx-auto flex max-w-xl items-center gap-3 rounded-2xl glass bg-panel/95 p-3 shadow-2xl lg:bottom-6" data-testid="sel-bar">
          <button aria-label="Снять выбор" onClick={() => setSel(new Set())} className="grid size-9 place-items-center rounded-full hover:bg-white/10"><X size={16} /></button>
          <div className="min-w-0 flex-1 text-sm"><b>{sel.size}</b> шт. на <Money v={selSum} className="font-extrabold" /></div>
          <Btn kind="gold" testId="sell-selected" onClick={() => (sel.size === 1 ? sellIds([...sel]) : ask('Продать выбранное', sel.size, selSum, () => sellIds([...sel])))}>Продать</Btn>
        </div>
      )}

      <Modal open={!!confirm} onClose={() => setConfirm(null)} title={confirm?.title}>
        {confirm && (
          <div className="space-y-4 text-center">
            <p className="text-sm text-mute">Предметов: <b className="text-white">{confirm.n}</b>. На баланс придёт</p>
            <Money v={confirm.sum} className="display text-3xl font-extrabold gold-text" size={26} />
            <div className="flex gap-2">
              <Btn kind="soft" className="flex-1" onClick={() => setConfirm(null)}>Отмена</Btn>
              <Btn kind="gold" className="flex-1" busy={busy} testId="confirm-sell" onClick={async () => { setBusy(true); await confirm.go(); setBusy(false); setConfirm(null) }}>Продать</Btn>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
