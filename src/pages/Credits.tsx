import credits from '../art/credits.json'
import { Section } from '../components/ui'

/** Авторы 3D-моделей: лицензия CC-BY требует указывать их. */
export default function Credits() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="display text-xl sm:text-2xl font-extrabold">Авторы моделей</h1>
        <p className="text-xs text-mute">3D-модели оружия, ножей и перчаток взяты с Sketchfab по лицензиям Creative Commons. Мы сжали текстуры, убрали лишние предметы из сцен и наложили свои скины.</p>
      </div>
      <Section>
        <div className="divide-y divide-line text-sm" data-testid="credits">
          {credits.map((c, i) => (
            <div key={c.shape + i} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5">
              <a className="min-w-0 flex-1 truncate font-semibold hover:text-gold" href={c.url} target="_blank" rel="noreferrer">{c.title}</a>
              <a className="text-mute hover:text-white" href={c.authorUrl} target="_blank" rel="noreferrer">{c.author}</a>
              <a className="rounded-lg bg-white/8 px-2 py-0.5 text-xs font-semibold text-mute hover:text-white" href={c.licenseUrl} target="_blank" rel="noreferrer">{c.license}</a>
            </div>
          ))}
        </div>
      </Section>
    </div>
  )
}
