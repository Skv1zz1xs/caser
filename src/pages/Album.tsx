import { useEffect, useMemo, useState } from 'react'
import { Check, Library } from 'lucide-react'
import { ALBUM, RARITIES } from '../config/economy'
import { CATEGORIES, type CaseCategory } from '../config/cases'
import { CATALOG, type CaseDef } from '../shared/catalog'
import { rpc, type Me } from '../lib/api'
import { applyMe, useGame } from '../store/game'
import { sfx } from '../audio/sfx'
import { Bar, Btn, CaseCover, Empty, ItemArt, Modal, Money, Section, cx, rc } from '../components/ui'

interface AlbumData { items: string[]; claimed: string[] }

const itemsOf = (c: CaseDef) => c.items.filter((i, k, a) => a.findIndex((x) => x.id === i.id) === k)

export default function Album() {
  const run = useGame((s) => s.run)
  const [data, setData] = useState<AlbumData | null>(null)
  const [cat, setCat] = useState<CaseCategory | 'all'>('all')
  const [open, setOpen] = useState<CaseDef | null>(null)
  const [busy, setBusy] = useState(false)
  const load = () => void rpc<AlbumData>('collection_get').then(setData).catch(() => setData({ items: [], claimed: [] }))
  useEffect(load, [])
  const have = useMemo(() => new Set(data?.items ?? []), [data])
  const cases = CATALOG.cases.filter((c) => c.category !== 'free' && (cat === 'all' || c.category === cat))
  const total = CATALOG.cases.filter((c) => c.category !== 'free').reduce((a, c) => a + itemsOf(c).length, 0)
  const got = CATALOG.cases.filter((c) => c.category !== 'free').reduce((a, c) => a + itemsOf(c).filter((i) => have.has(i.id)).length, 0)

  const claim = async (c: CaseDef) => {
    setBusy(true)
    const r = await run(async () => applyMe(await rpc<{ reward: number; me: Me }>('collection_claim', { p_case: c.id })))
    setBusy(false)
    if (r) {
      sfx('win')
      useGame.getState().toast(`Кейс «${c.name}» собран полностью! Награда: ${Math.round(r.reward / 100)} монет`, 'gold')
      load()
    }
  }
  return (
    <div className="space-y-4">
      <div>
        <h1 className="display text-xl font-extrabold sm:text-2xl">Альбом скинов</h1>
        <p className="text-xs text-mute">Сюда записывается всё, что тебе когда-либо выпадало, даже проданное. Собери все предметы кейса и забери награду: {ALBUM.rewardMult}× цены кейса.</p>
      </div>
      <Section>
        <div className="mb-1 flex items-end justify-between text-sm"><span className="font-bold">Всего собрано</span><span className="tabular-nums" data-testid="album-total">{got} / {total}</span></div>
        <Bar v={got} max={total} />
      </Section>
      <div className="no-scrollbar flex gap-2 overflow-x-auto">
        {[{ id: 'all' as const, name: 'Все' }, ...CATEGORIES.filter((g) => CATALOG.cases.some((c) => c.category === g.id))].map((g) => (
          <button key={g.id} onClick={() => setCat(g.id)} className={cx('h-10 shrink-0 rounded-xl px-4 text-sm font-bold', cat === g.id ? 'bg-white/14 text-gold' : 'glass text-mute')}>{g.name}</button>
        ))}
      </div>
      {!data ? <div className="h-40 animate-pulse rounded-3xl bg-white/5" /> : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5" data-testid="album-grid">
          {cases.map((c) => {
            const list = itemsOf(c)
            const n = list.filter((i) => have.has(i.id)).length
            const full = n === list.length
            const claimed = data.claimed.includes(c.id)
            return (
              <button key={c.id} onClick={() => setOpen(c)} data-testid={'album-' + c.id} className={cx('relative flex flex-col items-center rounded-3xl border bg-gradient-to-b from-[#121a33] to-[#0a1024] px-2 pb-3 pt-2 text-center transition hover:-translate-y-1', full ? 'border-gold/50' : 'border-[#2c4aa8]/40')}>
                {claimed && <span className="absolute right-2 top-2 grid size-6 place-items-center rounded-full bg-ok/20 text-ok"><Check size={14} /></span>}
                <CaseCover c={c} size={96} />
                <div className="display mt-1 w-full truncate text-[13px] font-bold">{c.name}</div>
                <div className="mt-1.5 w-full px-2"><Bar v={n} max={list.length} color={full ? 'var(--color-gold)' : undefined} /></div>
                <div className="mt-1 text-[11px] tabular-nums text-mute">{n} / {list.length}</div>
              </button>
            )
          })}
        </div>
      )}
      <Modal open={!!open} onClose={() => setOpen(null)} title={open?.name} wide>
        {open && data && (() => {
          const list = itemsOf(open)
          const full = list.every((i) => have.has(i.id))
          const claimed = data.claimed.includes(open.id)
          return (
            <div className="space-y-3">
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-6" data-testid="album-items">
                {list.map((i) => {
                  const owned = have.has(i.id)
                  return (
                    <div key={i.id} className="item-card p-1.5 text-center" style={{ '--rc': owned ? rc(i.rarity) : '#334' } as React.CSSProperties}>
                      <div className={cx(!owned && 'brightness-0 opacity-30')}><ItemArt i={{ item: i.id, phase: 0, fi: 3000 }} className="h-12 w-full" /></div>
                      <div className="mt-1 truncate text-[10px] font-bold" style={{ color: owned ? rc(i.rarity) : undefined }}>{owned ? i.skin : '???'}</div>
                      <div className="text-[9px] text-mute">{RARITIES[i.rarity].name}</div>
                    </div>
                  )
                })}
              </div>
              <Btn kind={full && !claimed ? 'gold' : 'soft'} className="h-12 w-full" disabled={!full || claimed} busy={busy} onClick={() => claim(open)} testId="album-claim">
                {claimed ? 'Награда получена' : full ? <>Забрать награду <Money v={open.price * ALBUM.rewardMult} short /></> : `Собрано ${list.filter((i) => have.has(i.id)).length} из ${list.length}`}
              </Btn>
            </div>
          )
        })()}
      </Modal>
      {data && data.items.length === 0 && <Empty icon={Library}>Альбом пуст. Открой кейс, и первые скины запишутся сами.</Empty>}
    </div>
  )
}
