import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Backpack } from 'lucide-react'
import type { Item } from '../lib/api'
import { RarityFilter, sortItems, type SortKey } from '../pages/Inventory'
import { Empty, ItemCard } from './ui'

/** Сетка своих предметов с выбором — для апгрейдера и контрактов. */
export function Picker({
  items, selected, onToggle, canPick, lockRarity, max = 400,
}: { items: Item[]; selected: Set<number>; onToggle: (i: Item) => void; canPick?: (i: Item) => boolean; lockRarity?: number | null; max?: number }) {
  const [rarity, setRarity] = useState<number | null>(null)
  const [sort, setSort] = useState<SortKey>('price-desc')
  const r = lockRarity ?? rarity
  const view = useMemo(() => sortItems(items.filter((i) => r === null || i.rarity === r), sort).slice(0, max), [items, r, sort, max])
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1"><RarityFilter value={r} onChange={setRarity} /></div>
        <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} aria-label="Сортировка" className="h-9 shrink-0 rounded-lg border border-line bg-panel px-2 text-xs font-semibold">
          <option value="price-desc">Дорогие</option><option value="price-asc">Дешёвые</option><option value="new">Новые</option>
        </select>
      </div>
      {view.length === 0 ? (
        <Empty icon={Backpack}>{items.length ? 'Таких предметов нет' : <>Инвентарь пуст. <Link to="/" className="font-bold text-gold">Открой кейс</Link></>}</Empty>
      ) : (
        <div className="grid max-h-[46dvh] grid-cols-3 gap-2 overflow-y-auto pr-1 sm:grid-cols-4" data-testid="picker">
          {view.map((i) => {
            const on = selected.has(i.id)
            const ok = on || !canPick || canPick(i)
            return <ItemCard key={i.id} i={i} compact selected={on} dim={!ok} onClick={ok ? () => onToggle(i) : undefined} />
          })}
        </div>
      )}
    </div>
  )
}
