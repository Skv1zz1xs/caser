import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { CATALOG } from '../shared/catalog'
import { Cinematic, type CineKind } from '../components/Cinematic'
import { renderItem } from '../art/three3d'
import modelManifest from '../../scripts/models/manifest.json'
import { CaseCover, ItemArt } from '../components/ui'

function VariantCell({ itemId, variant, label }: { itemId: string; variant: number; label: string }) {
  const [src, setSrc] = useState('')
  useEffect(() => {
    let on = true
    void renderItem({ item: itemId, phase: 0, wear: 0, variant }).then((u) => on && u && setSrc(u))
    return () => {
      on = false
    }
  }, [itemId, variant])
  return (
    <div className="item-card p-1"><img src={src || undefined} alt="" className="h-28 w-full object-contain" /><div className="text-center text-[10px] text-mute">{label}</div></div>
  )
}

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
  if (sp.get('variants')) {
    const cells = Object.entries(modelManifest as Record<string, unknown[]>).flatMap(([shape, list]) => {
      const item = CATALOG.cases.flatMap((c) => c.items).find((i) => i.shape === shape)
      return item ? list.map((_, v) => ({ shape, v, id: item.id })) : []
    })
    return (
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-6" data-testid="variants">
        {cells.map((c) => <VariantCell key={c.shape + c.v} itemId={c.id} variant={c.v} label={c.shape + '-' + c.v} />)}
      </div>
    )
  }
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
