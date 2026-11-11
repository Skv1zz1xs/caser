import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { CATALOG } from '../shared/catalog'
import { Cinematic, type CineKind } from '../components/Cinematic'
import { CaseCover, ItemArt } from '../components/ui'

/** Служебная страница #/gallery: проверка 3D-графики. */
export default function Gallery() {
  const [sp] = useSearchParams()
  const kind = sp.get('cine') as CineKind | null
  const [ev, setEv] = useState(() => {
    if (!kind) return null
    const o = CATALOG.caseById.get('klinok')!.outcomes.find((x) => x.phase === 2) ?? CATALOG.caseById.get('klinok')!.outcomes.at(-1)!
    const it = CATALOG.itemById.get(o.itemId)!
    return { kind, count: 3, item: { id: 1, case: 'klinok', idx: o.idx, item: it.id, phase: o.phase, rarity: it.rarity, fi: 1500, st: false, price: 8_777_700, src: 'case', at: 0, x: 24000 } }
  })
  const byShape = new Map<string, { item: string; phase: number }[]>()
  for (const c of CATALOG.cases)
    for (const o of c.outcomes) {
      const it = CATALOG.itemById.get(o.itemId)!
      const list = byShape.get(it.shape) ?? []
      if (list.length < 3 && !list.some((x) => x.item === it.id && x.phase === o.phase)) list.push({ item: it.id, phase: o.phase })
      byShape.set(it.shape, list)
    }
  const cells = [...byShape.entries()].flatMap(([, l]) => l.slice(0, 2))
  return (
    <div className="space-y-4">
      <Cinematic ev={ev} onDone={() => setEv(null)} />
      <div className="grid grid-cols-3 gap-3 sm:grid-cols-6" data-testid="gallery-cases">
        {['sigma', 'gta', 'klinok', 'r5050', 'absolut', 'meloch'].map((id) => <CaseCover key={id} c={CATALOG.caseById.get(id)!} size={220} />)}
      </div>
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-6" data-testid="gallery-items">
        {cells.map((c, i) => (
          <div key={i} className="item-card p-1"><ItemArt i={{ item: c.item, phase: c.phase, fi: 2000 }} className="h-28 w-full" /></div>
        ))}
      </div>
    </div>
  )
}
