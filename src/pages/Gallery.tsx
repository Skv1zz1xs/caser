import { CATALOG } from '../shared/catalog'
import { CaseCover, ItemArt } from '../components/ui'

/** Служебная страница #/gallery: проверка 3D-графики. */
export default function Gallery() {
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
