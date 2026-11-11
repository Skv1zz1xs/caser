import { CATALOG } from '../shared/catalog'
import { CaseCover, ItemArt } from '../components/ui'

/** Служебная страница #/gallery: проверка 3D-графики. */
export default function Gallery() {
  const picks = ['sigma', 'klinok', 'hvat', 'dota', 'absolut', 'gta'].flatMap((id) => {
    const c = CATALOG.caseById.get(id)!
    const seen = new Set<string>()
    return c.outcomes.filter((o) => (seen.has(o.itemId) ? false : (seen.add(o.itemId), true))).slice(-9).map((o) => ({ o, c }))
  })
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3 sm:grid-cols-6" data-testid="gallery-cases">
        {['sigma', 'gta', 'klinok', 'r5050', 'absolut', 'meloch'].map((id) => <CaseCover key={id} c={CATALOG.caseById.get(id)!} size={220} />)}
      </div>
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-6" data-testid="gallery-items">
        {picks.map(({ o }, i) => (
          <div key={i} className="item-card p-1"><ItemArt i={{ item: o.itemId, phase: o.phase, fi: i % 2 ? 9000 : 2000 }} className="h-24 w-full" /></div>
        ))}
        {CATALOG.cases.find((c) => c.id === 'klinok')!.outcomes.filter((o) => o.phase > 0).slice(0, 6).map((o, i) => (
          <div key={'p' + i} className="item-card p-1"><ItemArt i={{ item: o.itemId, phase: o.phase, fi: 1000 }} className="h-24 w-full" /></div>
        ))}
      </div>
    </div>
  )
}
