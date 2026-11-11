/**
 * Подготовка моделей для игры: убирает лишние предметы (подставки, патроны, ножны), сжимает текстуры в WebP 1024
 * и геометрию в meshopt, пишет public/models/<форма>.glb.
 * Запуск: node scripts/models/prepare.mjs <папка с распакованными glTF из Sketchfab> [форма ...]
 * Исходники в репозиторий не кладутся, только результат. Авторы и лицензии — CREDITS.md.
 */
import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { dedup, flatten, meshopt, prune, textureCompress } from '@gltf-transform/functions'
import { MeshoptEncoder } from 'meshoptimizer'
import sharp from 'sharp'
import fs from 'node:fs'
import path from 'node:path'

const [srcRoot, ...only] = process.argv.slice(2)
if (!srcRoot) throw new Error('Укажи папку с исходниками')
const manifest = JSON.parse(fs.readFileSync(new URL('./manifest.json', import.meta.url), 'utf8'))
await MeshoptEncoder.ready
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder })

for (const [shape, variants] of Object.entries(manifest))
  for (const [vi, cfg] of variants.entries()) {
  if (only.length && !only.includes(shape)) continue
  const dir = path.join(srcRoot, cfg.src)
  const file = fs.readdirSync(dir).find((f) => f.endsWith('.gltf') || f.endsWith('.glb'))
  const doc = await io.read(path.join(dir, file))
  for (const node of doc.getRoot().listNodes()) {
    if (!node.getMesh()) continue
    // имя узла или любого его предка
    const chain = []
    for (let n = node; n; n = n.getParentNode()) chain.push(n.getName())
    const kept = !cfg.keep || chain.some((c) => cfg.keep.includes(c))
    const dropped = cfg.drop && chain.some((c) => cfg.drop.includes(c))
    if (!kept || dropped) node.setMesh(null)
  }
  await doc.transform(
    prune(),
    flatten(),
    dedup(),
    textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [1024, 1024], quality: 82 }),
    meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
  )
  const out = new URL(`../../public/models/${shape}${vi ? '-' + vi : ''}.glb`, import.meta.url).pathname
  await io.write(out, doc)
  console.log((shape + (vi ? '-' + vi : '')).padEnd(12), (fs.statSync(out).size / 1024).toFixed(0).padStart(6), 'KB')
}
