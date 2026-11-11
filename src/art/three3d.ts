/**
 * Настоящая 3D-графика на three.js (всё процедурно, без внешних моделей):
 *  • оружие, ножи и перчатки — объёмные выдавленные модели с фасками и PBR-материалом (клеарткоут, металл, отражения студийного света);
 *    «скин» — сгенерированная текстура, натянутая на корпус; самоцветы и сверхновые светятся;
 *  • кейс — металлический сундук с открытой крышкой, светом изнутри, монетами и самым дорогим предметом коллекции над ним.
 * Один общий WebGL-рендерер рисует «снимки» в кэш (blob-URL) — в списках сотни картинок без сотен WebGL-контекстов.
 * three подгружается лениво, если WebGL недоступен — интерфейс остаётся на плоских SVG.
 */
import type * as T from 'three'
import { CATALOG, type CaseDef, type ItemDef } from '../shared/catalog'
import { skinTextureSvg } from './item'
import { SHAPES } from './shapes'
import modelManifest from '../../scripts/models/manifest.json'

interface Engine {
  THREE: typeof T
  renderer: T.WebGLRenderer
  env: T.Texture
  SVGLoader: any
  RoundedBoxGeometry: any
}

let enginePromise: Promise<Engine | null> | null = null

async function getEngine(): Promise<Engine | null> {
  if (!enginePromise)
    enginePromise = (async () => {
      try {
        const THREE = await import('three')
        const { SVGLoader } = await import('three/examples/jsm/loaders/SVGLoader.js')
        const { RoundedBoxGeometry } = await import('three/examples/jsm/geometries/RoundedBoxGeometry.js')
        const canvas = document.createElement('canvas')
        const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true, powerPreference: 'high-performance' })
        renderer.setPixelRatio(1)
        renderer.toneMapping = THREE.ACESFilmicToneMapping
        renderer.toneMappingExposure = 0.98
        renderer.outputColorSpace = THREE.SRGBColorSpace
        renderer.setClearColor(0x000000, 0)
        // студия: тёмная комната и яркие цветные софтбоксы — они и дают блики на металле и лаке
        const sc = new THREE.Scene()
        const room = new THREE.Mesh(new THREE.SphereGeometry(10, 32, 16), new THREE.MeshBasicMaterial({ color: 0x05070c, side: THREE.BackSide }))
        sc.add(room)
        const box = (w: number, h: number, pos: [number, number, number], rgb: [number, number, number], k: number) => {
          const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(rgb[0] * k, rgb[1] * k, rgb[2] * k), side: THREE.DoubleSide }))
          m.position.set(...pos)
          m.lookAt(0, 0, 0)
          sc.add(m)
        }
        box(7, 3, [0, 7, 1], [1, 1, 1], 9)
        box(1.6, 6, [-6, 1, 3], [0.35, 0.8, 1], 10)
        box(1.6, 6, [6, 1, 2], [1, 0.45, 0.85], 9)
        box(5, 1.2, [0, -2, 6], [1, 0.8, 0.5], 4)
        box(4, 1.5, [0, 2, -7], [0.7, 0.8, 1], 6)
        box(9, 0.45, [0, 3.2, 4], [1, 1, 1], 14)
        const pm = new THREE.PMREMGenerator(renderer)
        const env = pm.fromScene(sc, 0.03).texture
        return { THREE, renderer, env, SVGLoader, RoundedBoxGeometry }
      } catch {
        return null
      }
    })()
  return enginePromise
}

export const webglOk = (): Promise<boolean> => getEngine().then((e) => !!e)

/* --------------------------- вспомогательное --------------------------- */
function hash(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}
function rng(seed: number) {
  let a = seed || 1
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function svgTexture(E: Engine, svg: string, w = 1024, h = 512): Promise<T.CanvasTexture> {
  return new Promise((res, rej) => {
    const img = new Image()
    img.onload = () => {
      const c = document.createElement('canvas')
      c.width = w
      c.height = h
      c.getContext('2d')!.drawImage(img, 0, 0, w, h)
      const t = new E.THREE.CanvasTexture(c)
      t.colorSpace = E.THREE.SRGBColorSpace
      t.anisotropy = 4
      res(t)
    }
    img.onerror = rej
    img.src = 'data:image/svg+xml;utf8,' + encodeURIComponent(svg)
  })
}


/** Карта нормалей из яркости текстуры (Собель): рифление, швы и узор получают микрорельеф. */
function normalFromTexture(E: Engine, tex: T.CanvasTexture, strength = 2.2): T.CanvasTexture {
  const src = tex.image as HTMLCanvasElement
  const w = 512
  const h = 256
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const x = c.getContext('2d')!
  x.drawImage(src, 0, 0, w, h)
  const d = x.getImageData(0, 0, w, h)
  const lum = new Float32Array(w * h)
  for (let i = 0; i < w * h; i++) lum[i] = (d.data[i * 4] * 0.3 + d.data[i * 4 + 1] * 0.59 + d.data[i * 4 + 2] * 0.11) / 255
  const at = (px: number, py: number) => lum[Math.min(h - 1, Math.max(0, py)) * w + Math.min(w - 1, Math.max(0, px))]
  for (let py = 0; py < h; py++)
    for (let px = 0; px < w; px++) {
      const dx = (at(px + 1, py - 1) + 2 * at(px + 1, py) + at(px + 1, py + 1)) - (at(px - 1, py - 1) + 2 * at(px - 1, py) + at(px - 1, py + 1))
      const dy = (at(px - 1, py + 1) + 2 * at(px, py + 1) + at(px + 1, py + 1)) - (at(px - 1, py - 1) + 2 * at(px, py - 1) + at(px + 1, py - 1))
      let nx = -dx * strength
      let ny = dy * strength
      const nz = 1
      const l = Math.hypot(nx, ny, nz)
      nx /= l
      ny /= l
      const i = (py * w + px) * 4
      d.data[i] = (nx * 0.5 + 0.5) * 255
      d.data[i + 1] = (ny * 0.5 + 0.5) * 255
      d.data[i + 2] = (nz / l * 0.5 + 0.5) * 255
      d.data[i + 3] = 255
    }
  x.putImageData(d, 0, 0)
  const t = new E.THREE.CanvasTexture(c)
  t.colorSpace = E.THREE.NoColorSpace
  return t
}

const geoCache = new Map<string, T.ExtrudeGeometry>()
function extrude(E: Engine, key: string, d: string, depth: number, bevel: number, offsetZ: number): T.ExtrudeGeometry {
  const ck = key + depth
  const hit = geoCache.get(ck)
  if (hit) return hit
  // ось Y в SVG направлена вниз — переворачиваем трансформом, UV потом берём из позиций
  const data = new E.SVGLoader().parse(`<svg xmlns="http://www.w3.org/2000/svg"><g transform="scale(1,-1)"><path d="${d}"/></g></svg>`)
  const shapes = data.paths.flatMap((p: any) => E.SVGLoader.createShapes(p))
  const g = new E.THREE.ExtrudeGeometry(shapes, {
    depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel * 0.8, bevelSegments: 3, curveSegments: 10,
  })
  g.translate(0, 0, offsetZ)
  const pos = g.attributes.position
  const uv = g.attributes.uv
  for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) / 200, (pos.getY(i) + 100) / 100)
  uv.needsUpdate = true
  geoCache.set(ck, g)
  return g
}

export interface ItemSpec { item: string; phase: number; wear: number; variant?: number }


/* ------------------- настоящие 3D-модели (GLB из public/models) ------------------- */
const MODEL_SHAPES = new Set(Object.keys(modelManifest))
const VARIANTS = (shape: string) => (modelManifest as Record<string, unknown[]>)[shape]?.length ?? 0

/** Дополнительный поворот после автовыравнивания (градусы XYZ): ствол/лезвие вправо, верх вверх. */
/** Модели с почти чёрной родной текстурой: поднимаем яркость для маски покраски. */
const LIFT: Record<string, number> = { shotgun: 0.03, pdw: 0.03 }

const ORIENT: Record<string, { auto?: boolean; r?: [number, number, number] }> = {
  // у этих моделей ствол после автовыравнивания смотрит влево — разворачиваем вокруг вертикали
  'revolver-1': { r: [0, 180, 0] },
  'revolver-2': { r: [0, 180, 0] },
  'sniper-1': { r: [0, 180, 0] },
  glove: { auto: false },
  gauntlet: { auto: false },
}

const templates = new Map<string, Promise<{ meshes: T.Mesh[]; size: T.Vector3 } | null>>()

async function loadTemplate(E: Engine, shape: string, variant = 0) {
  const tkey = variant ? `${shape}-${variant}` : shape
  let p = templates.get(tkey)
  if (p) return p
  p = (async () => {
    try {
      const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js')
      const { MeshoptDecoder } = await import('three/examples/jsm/libs/meshopt_decoder.module.js')
      const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder)
      const gltf = await loader.loadAsync(`${import.meta.env.BASE_URL}models/${tkey}.glb`)
      const { THREE } = E
      gltf.scene.updateMatrixWorld(true)
      // запекаем мировые трансформы в геометрию: дальше у мешей единичная матрица
      const meshes: T.Mesh[] = []
      gltf.scene.traverse((o: any) => {
        if (!o.isMesh || o.isSkinnedMesh) return
        const g = o.geometry.clone()
        // после сжатия вершины целочисленные (quantization): переводим в float, иначе повороты их портят
        for (const name of Object.keys(g.attributes)) {
          const a = g.getAttribute(name) as T.BufferAttribute
          if ((a as any).isInterleavedBufferAttribute || (a.array as any).constructor !== Float32Array) {
            const arr = new Float32Array(a.count * a.itemSize)
            for (let i = 0; i < a.count; i++) {
              arr[i * a.itemSize] = a.getX(i)
              if (a.itemSize > 1) arr[i * a.itemSize + 1] = a.getY(i)
              if (a.itemSize > 2) arr[i * a.itemSize + 2] = a.getZ(i)
              if (a.itemSize > 3) arr[i * a.itemSize + 3] = a.getW(i)
            }
            g.setAttribute(name, new THREE.BufferAttribute(arr, a.itemSize))
          }
        }
        g.applyMatrix4(o.matrixWorld)
        const m = new THREE.Mesh(g, o.material)
        meshes.push(m)
      })
      if (!meshes.length) return null
      const box = new THREE.Box3()
      meshes.forEach((m) => box.expandByObject(m))
      const size = box.getSize(new THREE.Vector3())
      const cfg = ORIENT[tkey] ?? ORIENT[shape] ?? {}
      if (cfg.auto !== false) {
        const axes = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)]
        const order = [0, 1, 2].sort((a, b) => [size.x, size.y, size.z][b] - [size.x, size.y, size.z][a])
        const ex = axes[order[0]].clone()
        const ey = axes[order[1]].clone()
        const ez = new THREE.Vector3().crossVectors(ex, ey)
        const inv = new THREE.Matrix4().makeBasis(ex, ey, ez).invert()
        meshes.forEach((m) => m.geometry.applyMatrix4(inv))
      }
      if (cfg.r) {
        const rot = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(...cfg.r.map((d) => (d * Math.PI) / 180) as [number, number, number]))
        meshes.forEach((m) => m.geometry.applyMatrix4(rot))
      }
      const b2 = new THREE.Box3()
      meshes.forEach((m) => {
        m.geometry.computeBoundingBox()
        b2.union(m.geometry.boundingBox!)
      })
      meshes.forEach((m) => m.geometry.translate(-(b2.min.x + b2.max.x) / 2, -(b2.min.y + b2.max.y) / 2, -(b2.min.z + b2.max.z) / 2))
      return { meshes, size: b2.getSize(new THREE.Vector3()) }
    } catch (e) {
      console.warn('model load failed', shape, e)
      return null
    }
  })()
  templates.set(tkey, p)
  return p
}

const NO_PAINT = /glass|lens|reticle|bullet|brass|casing|ammo|screen|hologram/i

/** Накладывает скин на материал: проекция с трёх сторон + сохранение яркости/деталей оригинала. */
function paintMaterial(E: Engine, src: T.Material, skin: T.Texture, size: T.Vector3, opts: { paint: number; gloss: number; glow: number; wear: number; scale: number; lift: number }): T.Material {
  const { THREE } = E
  const mat = (src as T.MeshStandardMaterial).clone()
  const std = mat as T.MeshStandardMaterial
  if (!(std as any).isMeshStandardMaterial) return mat
  if (NO_PAINT.test(src.name) || src.transparent) return mat
  std.envMapIntensity = 1.35
  const s = Math.max(size.x / 2, size.y) * opts.scale
  const uniforms = {
    uSkin: { value: skin }, uHalf: { value: new THREE.Vector3(size.x / 2, size.y / 2, size.z / 2) }, uS: { value: s },
    uWear: { value: opts.wear }, uLift: { value: opts.lift }, uPaint: { value: opts.paint }, uGloss: { value: opts.gloss }, uGlow: { value: opts.glow },
  }
  std.onBeforeCompile = (sh: any) => {
    Object.assign(sh.uniforms, uniforms)
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vOP; varying vec3 vON;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvOP = position; vON = normal;')
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vOP; varying vec3 vON; uniform sampler2D uSkin; uniform vec3 uHalf; uniform float uS, uPaint, uGloss, uGlow, uWear, uLift;\nvec3 zSkin = vec3(0.0); float zPaint = 0.0;')
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        {
          vec3 p = vOP + uHalf;
          vec3 an = pow(abs(normalize(vON)), vec3(3.0));
          an /= (an.x + an.y + an.z + 1e-4);
          vec3 sSide = texture2D(uSkin, vec2(p.x / (2.0 * uS), p.y / uS)).rgb;
          vec3 sTop  = texture2D(uSkin, vec2(p.x / (2.0 * uS), p.z / uS)).rgb;
          vec3 sEnd  = texture2D(uSkin, vec2(p.z / (2.0 * uS), p.y / uS)).rgb;
          zSkin = sSide * an.z + sTop * an.y + sEnd * an.x;
          float l = max(dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114)), uLift);
          float k = clamp(0.72 + 0.95 * pow(l, 0.65), 0.72, 1.35);
          // тёмные детали (оптика, резина, полимер) остаются родными — красится только корпус
          zPaint = uPaint * smoothstep(0.0015, 0.016, l);
          // потёртости: пятна голого металла по шумовой маске
          vec3 q = vOP * (9.0 / max(uS, 1e-3));
          float nz = fract(sin(dot(floor(q), vec3(12.9898, 78.233, 37.719))) * 43758.5453);
          float nz2 = fract(sin(dot(floor(q * 2.3), vec3(39.346, 11.135, 83.155))) * 24634.6345);
          float wearMask = smoothstep(1.0 - uWear * 1.6, 1.0, nz * 0.6 + nz2 * 0.4) * step(0.001, uWear);
          vec3 painted = zSkin * k;
          // металлические блёстки лака
          float fl = fract(sin(dot(floor(vOP * (150.0 / max(uS, 1e-3))), vec3(41.3, 17.7, 29.1))) * 43758.5453);
          painted *= 1.0 + (fl - 0.5) * 0.22;
          painted = mix(painted, vec3(0.62, 0.64, 0.68), wearMask);
          zPaint *= 1.0;
          diffuseColor.rgb = mix(diffuseColor.rgb, painted, zPaint);
          zSkin *= (1.0 - wearMask);
        }`,
      )
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\n metalnessFactor = mix(metalnessFactor, 0.3, zPaint * uGloss);')
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n roughnessFactor = mix(roughnessFactor, 0.34, zPaint * uGloss * 0.7);')
      .replace('#include <opaque_fragment>', 'float zFr = pow(1.0 - clamp(dot(normalize(vViewPosition), normal), 0.0, 1.0), 3.0);\n outgoingLight += zSkin * zFr * 0.3 * zPaint * uGloss;\n#include <opaque_fragment>')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n totalEmissiveRadiance += zSkin * uGlow * zPaint;')
  }
  std.customProgramCacheKey = () => 'skin-v4'
  return mat
}

async function buildModelItem(E: Engine, def: ItemDef, spec: ItemSpec): Promise<T.Group | null> {
  const nv = VARIANTS(def.shape)
  const variant = spec.variant ?? (nv > 1 ? hash(def.id) % nv : 0)
  const tpl = await loadTemplate(E, def.shape, variant)
  if (!tpl) return null
  const { THREE } = E
  const skin = await svgTexture(E, skinTextureSvg(def, spec.phase, spec.wear))
  skin.wrapS = skin.wrapT = THREE.MirroredRepeatWrapping
  const isGlove = def.kind === 'glove'
  const gem = spec.phase >= 2
  const opts = { paint: isGlove ? 0.88 : 0.95, gloss: isGlove ? 0.15 : 1, glow: gem ? (spec.phase === 3 ? 0.55 : 0.4) : 0, wear: spec.wear >= 4 ? 0.5 : spec.wear === 3 ? 0.24 : 0.04, scale: isGlove ? 0.4 : 1, lift: LIFT[def.shape] ?? 0 }
  const mats = new Map<T.Material, T.Material>()
  const pivot = new THREE.Group()
  for (const m of tpl.meshes) {
    let pm = mats.get(m.material as T.Material)
    if (!pm) {
      pm = paintMaterial(E, m.material as T.Material, skin, tpl.size, opts)
      mats.set(m.material as T.Material, pm)
    }
    pivot.add(new THREE.Mesh(m.geometry, pm))
  }
  const s = 0.94 * Math.min(2 / tpl.size.x, 1 / tpl.size.y)
  pivot.scale.setScalar(s)
  const root = new THREE.Group()
  root.add(pivot)
  root.userData.disposables = [skin, ...mats.values()]
  return root
}

/** Собирает 3D-модель предмета. Вызывающий отвечает за dispose (см. disposeGroup). */
async function buildItem(E: Engine, spec: ItemSpec): Promise<T.Group | null> {
  const { THREE } = E
  const def: ItemDef | undefined = CATALOG.itemById.get(spec.item)
  if (!def) return null
  if (MODEL_SHAPES.has(def.shape)) {
    const real = await buildModelItem(E, def, spec)
    if (real) return real
  }
  const shape = SHAPES[def.shape] ?? SHAPES.pistol
  const tex = await svgTexture(E, skinTextureSvg(def, spec.phase, spec.wear))
  const worn = spec.wear >= 3
  const nrm = normalFromTexture(E, tex, def.kind === 'glove' ? 3.2 : 1.8)
  const gem = spec.phase >= 2
  const skinMat = new THREE.MeshPhysicalMaterial({
    map: tex,
    normalMap: nrm,
    normalScale: new THREE.Vector2(0.7, 0.7),
    anisotropy: def.kind === 'gun' ? 0.55 : 0,
    metalness: def.kind === 'glove' ? 0.05 : gem ? 0.35 : 0.55,
    roughness: def.kind === 'glove' ? 0.75 : spec.wear >= 4 ? 0.7 : worn ? 0.52 : 0.32,
    clearcoat: def.kind === 'glove' ? 0.2 : worn ? 0.35 : 1,
    clearcoatRoughness: worn ? 0.35 : 0.08,
    envMapIntensity: 1.35,
    emissiveMap: gem ? tex : null,
    emissive: gem ? new THREE.Color(spec.phase === 3 ? 0xffffff : 0xaaaaaa) : new THREE.Color(0),
    emissiveIntensity: gem ? (spec.phase === 3 ? 0.55 : 0.4) : 0,
    iridescence: spec.phase === 1 ? 1 : 0,
    iridescenceIOR: 1.6,
    sheen: def.kind === 'glove' ? 1 : 0,
    sheenRoughness: 0.5,
    sheenColor: new THREE.Color(0x8899aa),
  })
  const sideMat = new THREE.MeshStandardMaterial({ color: 0x23262e, metalness: 0.9, roughness: 0.38, envMapIntensity: 1.2 })
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x1b1d24, metalness: 0.92, roughness: def.kind === 'glove' ? 0.8 : 0.34, envMapIntensity: 1.2 })

  const g = new THREE.Group()
  const skinDepth = def.kind === 'glove' ? 12 : def.kind === 'knife' ? 7 : 20
  const body = new THREE.Mesh(extrude(E, def.shape + ':skin', shape.skin, skinDepth, 1.6, 0), [skinMat, sideMat])
  const dark = new THREE.Mesh(extrude(E, def.shape + ':dark', shape.dark, skinDepth - 5, 1.1, 2.5), darkMat)
  g.add(dark, body)
  // дополнительный объём: прицел у снайперских и разных деталей — цилиндры по линиям
  if (def.shape === 'sniper' || def.shape === 'dmr') {
    const scope = new THREE.Mesh(new THREE.CylinderGeometry(5.2, 5.2, 58, 24), darkMat)
    scope.rotation.z = Math.PI / 2
    scope.position.set(92, -74, skinDepth / 2)
    const lensMat = new THREE.MeshPhysicalMaterial({ color: 0x2a6bff, metalness: 0.2, roughness: 0.05, clearcoat: 1, emissive: new THREE.Color(0x1a40a0), emissiveIntensity: 0.6 })
    const lens = new THREE.Mesh(new THREE.CylinderGeometry(4.2, 4.2, 1, 24), lensMat)
    lens.rotation.z = Math.PI / 2
    lens.position.set(122, -74, skinDepth / 2)
    g.add(scope, lens)
  }
  const box = new THREE.Box3().setFromObject(g)
  const size = box.getSize(new THREE.Vector3())
  const c = box.getCenter(new THREE.Vector3())
  const pivot = new THREE.Group()
  g.position.set(-c.x, -c.y, -c.z)
  pivot.add(g)
  const s = 0.94 * Math.min(2 / size.x, 1 / size.y)
  pivot.scale.setScalar(s)
  pivot.rotation.z = (-shape.tilt * Math.PI) / 180 / 1.6
  const root = new THREE.Group()
  root.add(pivot)
  root.userData.disposables = [tex, nrm, skinMat, sideMat, darkMat]
  return root
}

function disposeGroup(g: T.Object3D) {
  const list = (g.userData.disposables ?? []) as { dispose(): void }[]
  list.forEach((d) => d.dispose())
  g.traverse((o: any) => {
    if (o.userData?.ownGeometry) o.geometry.dispose()
  })
}

/* ------------------------------ кейс ----------------------------------- */
function glowTexture(E: Engine): T.CanvasTexture {
  const c = document.createElement('canvas')
  c.width = c.height = 256
  const x = c.getContext('2d')!
  const g = x.createRadialGradient(128, 128, 0, 128, 128, 128)
  g.addColorStop(0, 'rgba(255,255,255,1)')
  g.addColorStop(0.25, 'rgba(255,255,255,.45)')
  g.addColorStop(1, 'rgba(255,255,255,0)')
  x.fillStyle = g
  x.fillRect(0, 0, 256, 256)
  return new E.THREE.CanvasTexture(c)
}

function panelTexture(E: Engine, c: CaseDef): T.CanvasTexture {
  const cv = document.createElement('canvas')
  cv.width = 1024
  cv.height = 512
  const x = cv.getContext('2d')!
  const [a, b] = c.colors
  const g = x.createLinearGradient(0, 0, 1024, 512)
  g.addColorStop(0, a)
  g.addColorStop(1, b)
  x.fillStyle = g
  x.fillRect(0, 0, 1024, 512)
  // рифлёные полосы и потёртости
  const r = rng(hash(c.id))
  x.globalAlpha = 0.18
  for (let i = 0; i < 40; i++) {
    x.fillStyle = i % 2 ? '#000' : '#fff'
    x.fillRect(0, i * 13, 1024, 4)
  }
  x.globalAlpha = 1
  if (c.category === 'risk') {
    x.save()
    x.beginPath()
    x.rect(0, 0, 1024, 70)
    x.rect(0, 442, 1024, 70)
    x.clip()
    for (let i = -10; i < 40; i++) {
      x.fillStyle = i % 2 ? '#ffd23d' : '#111'
      x.beginPath()
      x.moveTo(i * 60, 0)
      x.lineTo(i * 60 + 40, 0)
      x.lineTo(i * 60 - 20, 512)
      x.lineTo(i * 60 - 60, 512)
      x.fill()
    }
    x.restore()
  }
  // табличка с названием
  x.fillStyle = 'rgba(8,10,16,.82)'
  x.beginPath()
  x.roundRect(110, 170, 804, 180, 26)
  x.fill()
  x.strokeStyle = c.category === 'elite' ? '#ffd76a' : 'rgba(255,255,255,.55)'
  x.lineWidth = c.category === 'elite' ? 8 : 4
  x.stroke()
  x.fillStyle = '#fff'
  x.textAlign = 'center'
  x.textBaseline = 'middle'
  let size = 110
  const label = c.name.toUpperCase()
  x.font = `900 ${size}px "Unbounded Variable", "Manrope Variable", sans-serif`
  while (x.measureText(label).width > 740 && size > 36) {
    size -= 6
    x.font = `900 ${size}px "Unbounded Variable", "Manrope Variable", sans-serif`
  }
  x.fillText(label, 512, 262)
  // заклёпки
  x.fillStyle = 'rgba(0,0,0,.55)'
  for (const [px, py] of [[40, 40], [984, 40], [40, 472], [984, 472]]) {
    x.beginPath()
    x.arc(px, py, 14, 0, 7)
    x.fill()
  }
  void r
  const t = new E.THREE.CanvasTexture(cv)
  t.colorSpace = E.THREE.SRGBColorSpace
  t.anisotropy = 4
  return t
}

async function buildCase(E: Engine, c: CaseDef): Promise<T.Group> {
  const { THREE, RoundedBoxGeometry } = E
  const root = new THREE.Group()
  const disposables: { dispose(): void }[] = []
  const elite = c.category === 'elite'
  const panel = panelTexture(E, c)
  disposables.push(panel)
  const bodyMat = new THREE.MeshPhysicalMaterial({ map: panel, metalness: 0.55, roughness: 0.42, clearcoat: 0.5, clearcoatRoughness: 0.3, envMapIntensity: 1.1 })
  const topMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(c.colors[1]).multiplyScalar(0.5), metalness: 0.7, roughness: 0.5 })
  const trimMat = new THREE.MeshStandardMaterial({ color: elite ? 0xffc93c : 0x2a2e38, metalness: 1, roughness: elite ? 0.22 : 0.4, envMapIntensity: 1.4 })
  disposables.push(bodyMat, topMat, trimMat)

  const body = new THREE.Mesh(new RoundedBoxGeometry(2, 1, 1.2, 4, 0.06), [bodyMat, bodyMat, topMat, topMat, bodyMat, bodyMat])
  root.add(body)
  // металлические уголки и пояс
  const trim = (w: number, h: number, d: number, x: number, y: number, z: number) => {
    const m = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 2, 0.02), trimMat)
    m.position.set(x, y, z)
    root.add(m)
  }
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) trim(0.1, 1.04, 0.1, sx * 0.97, 0, sz * 0.57)
  trim(2.04, 0.06, 1.24, 0, 0.47, 0)
  trim(2.04, 0.06, 1.24, 0, -0.47, 0)
  trim(0.09, 0.16, 0.06, 0, 0.5, 0.62) // замок
  // крышка на петле
  const hinge = new THREE.Group()
  hinge.position.set(0, 0.5, -0.6)
  hinge.rotation.x = -1.2
  const lid = new THREE.Mesh(new RoundedBoxGeometry(2.04, 0.22, 1.24, 3, 0.05), [bodyMat, bodyMat, topMat, trimMat, bodyMat, bodyMat])
  lid.position.set(0, 0.11, 0.62)
  hinge.add(lid)
  root.add(hinge)
  // свечение изнутри
  const glowCol = new THREE.Color(c.colors[0]).lerp(new THREE.Color(0xffffff), 0.35)
  const inner = new THREE.Mesh(new THREE.PlaneGeometry(1.84, 1.04), new THREE.MeshBasicMaterial({ color: glowCol.clone().multiplyScalar(2.2) }))
  inner.rotation.x = -Math.PI / 2
  inner.position.y = 0.495
  root.add(inner)
  const gt = glowTexture(E)
  disposables.push(gt)
  const sprite = (scale: number, y: number, op: number, col: T.Color) => {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: gt, color: col, transparent: true, opacity: op, blending: THREE.AdditiveBlending, depthWrite: false }))
    sp.scale.setScalar(scale)
    sp.position.set(0, y, 0.05)
    root.add(sp)
  }
  sprite(4.2, 1.0, 0.75, new THREE.Color(c.colors[0]))
  sprite(2.4, 0.85, 0.85, glowCol)
  const lightIn = new THREE.PointLight(glowCol, 9, 4.5, 1.6)
  lightIn.position.set(0, 0.9, 0.3)
  root.add(lightIn)

  // самый дорогой предмет коллекции парит над сундуком
  const top = [...c.items].sort((p, q) => q.rarity - p.rarity || q.raw - p.raw)[0]
  if (top && c.category !== 'free') {
    const m = await buildItem(E, { item: top.id, phase: 0, wear: 0 })
    if (m) {
      m.scale.setScalar(0.88)
      m.position.set(0.05, 1.28, 0.1)
      m.rotation.set(0.1, -0.35, 0.18)
      root.add(m)
      disposables.push(...((m.userData.disposables ?? []) as { dispose(): void }[]))
    }
  }
  // контактная тень под сундуком
  const sh = document.createElement('canvas')
  sh.width = sh.height = 128
  const sx = sh.getContext('2d')!
  const sg = sx.createRadialGradient(64, 64, 4, 64, 64, 64)
  sg.addColorStop(0, 'rgba(0,0,0,.75)')
  sg.addColorStop(1, 'rgba(0,0,0,0)')
  sx.fillStyle = sg
  sx.fillRect(0, 0, 128, 128)
  const shTex = new THREE.CanvasTexture(sh)
  disposables.push(shTex)
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 2.2), new THREE.MeshBasicMaterial({ map: shTex, transparent: true, depthWrite: false }))
  shadow.rotation.x = -Math.PI / 2
  shadow.position.y = -0.52
  root.add(shadow)
  // монеты и гильзы
  const r = rng(hash(c.id))
  const goldMat = new THREE.MeshStandardMaterial({ color: 0xffc93c, metalness: 1, roughness: 0.22, envMapIntensity: 1.6 })
  disposables.push(goldMat)
  const coinGeo = new THREE.CylinderGeometry(0.1, 0.1, 0.025, 20)
  const shellGeo = new THREE.CylinderGeometry(0.036, 0.04, 0.17, 12)
  for (let i = 0; i < 9; i++) {
    const coin = i < 5
    const m = new THREE.Mesh(coin ? coinGeo : shellGeo, goldMat)
    const ang = r() * Math.PI * 2
    const rad = 0.2 + r() * 0.75
    m.position.set(Math.cos(ang) * rad, 0.62 + r() * 0.9, Math.sin(ang) * rad * 0.5 + 0.1)
    m.rotation.set(r() * 3, r() * 3, r() * 3)
    root.add(m)
  }
  root.userData.disposables = disposables
  root.userData.geoShared = [coinGeo, shellGeo]
  return root
}

/* ------------------------------ снимки --------------------------------- */
function lightRig(E: Engine, scene: T.Scene) {
  const { THREE } = E
  const key = new THREE.DirectionalLight(0xffffff, 2.6)
  key.position.set(-2.5, 3.5, 4)
  const rim = new THREE.DirectionalLight(0x7fe0ff, 3.8)
  rim.position.set(1.8, 3, -4)
  const fill = new THREE.DirectionalLight(0xff9a5a, 0.9)
  fill.position.set(2.5, -1, 3)
  scene.add(key, rim, fill, new THREE.AmbientLight(0x8899bb, 0.25))
}


/* ---------- постоянный кэш снимков (IndexedDB): повторные заходы не рендерят заново ---------- */
const ART_VER = 'a8'
let dbp: Promise<IDBDatabase | null> | null = null
function idb(): Promise<IDBDatabase | null> {
  if (!dbp)
    dbp = new Promise((res) => {
      try {
        const rq = indexedDB.open('zalet-art', 1)
        rq.onupgradeneeded = () => rq.result.createObjectStore('snap')
        rq.onsuccess = () => res(rq.result)
        rq.onerror = () => res(null)
      } catch {
        res(null)
      }
    })
  return dbp
}
async function idbGet(key: string): Promise<Blob | null> {
  const db = await idb()
  if (!db) return null
  return new Promise((res) => {
    try {
      const rq = db.transaction('snap').objectStore('snap').get(ART_VER + key)
      rq.onsuccess = () => res((rq.result as Blob) ?? null)
      rq.onerror = () => res(null)
    } catch {
      res(null)
    }
  })
}
async function idbPut(key: string, blob: Blob): Promise<void> {
  const db = await idb()
  if (!db) return
  try {
    db.transaction('snap', 'readwrite').objectStore('snap').put(blob, ART_VER + key)
  } catch {
    /* кэш необязателен */
  }
}

const cache = new Map<string, string>()
const pending = new Map<string, Promise<string | null>>()
let queue: Promise<unknown> = Promise.resolve()

const keyOf = (s: ItemSpec) => `i:${s.item}:${s.phase}:${s.wear >= 3 ? s.wear : 0}${s.variant !== undefined ? ':v' + s.variant : ''}`

export const peekItem = (s: ItemSpec): string | null => cache.get(keyOf({ ...s, wear: s.wear >= 3 ? s.wear : 0 })) ?? null
export const peekCase = (id: string): string | null => cache.get('c:' + id) ?? null

function enqueue<R>(job: () => Promise<R>): Promise<R> {
  const p = queue.then(job, job)
  queue = p.catch(() => {})
  return p
}

function snapshot(E: Engine, scene: T.Scene, cam: T.Camera, w: number, h: number, crop = false): Promise<Blob | null> {
  // суперсэмплинг: рендерим вдвое больше и уменьшаем — без лесенки; на слабых устройствах в 1.5 раза
  const k = (navigator.hardwareConcurrency ?? 8) <= 4 ? 1.5 : 2
  E.renderer.setSize(Math.round(w * k), Math.round(h * k), false)
  E.renderer.render(scene, cam)
  let out = document.createElement('canvas')
  out.width = w
  out.height = h
  let ctx = out.getContext('2d', { willReadFrequently: crop })!
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(E.renderer.domElement, 0, 0, w, h)
  if (crop) {
    // обрезаем по предмету: в карточках он занимает всё доступное место
    const d = ctx.getImageData(0, 0, w, h).data
    let x0 = w, y0 = h, x1 = 0, y1 = 0
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++)
        if (d[(y * w + x) * 4 + 3] > 12) {
          if (x < x0) x0 = x
          if (x > x1) x1 = x
          if (y < y0) y0 = y
          if (y > y1) y1 = y
        }
    if (x1 > x0 && y1 > y0) {
      const mx = Math.round((x1 - x0) * 0.04) + 2
      const my = Math.round((y1 - y0) * 0.06) + 2
      const sx = Math.max(0, x0 - mx), sy = Math.max(0, y0 - my)
      const sw = Math.min(w - sx, x1 - x0 + 2 * mx), sh = Math.min(h - sy, y1 - y0 + 2 * my)
      const c2 = document.createElement('canvas')
      c2.width = sw
      c2.height = sh
      c2.getContext('2d')!.drawImage(out, sx, sy, sw, sh, 0, 0, sw, sh)
      out = c2
    }
  }
  return new Promise((res) => out.toBlob((b) => res(b), 'image/webp', 0.92))
}

/** PNG-снимок 3D-модели предмета (blob-URL). null — WebGL недоступен. */
export function renderItem(spec: ItemSpec): Promise<string | null> {
  const s = { ...spec, wear: spec.wear >= 3 ? spec.wear : 0 }
  const k = keyOf(s)
  if (cache.has(k)) return Promise.resolve(cache.get(k)!)
  if (pending.has(k)) return pending.get(k)!
  const p = (async () => {
    const stored = await idbGet(k)
    if (stored) {
      const u = URL.createObjectURL(stored)
      cache.set(k, u)
      return u
    }
    return enqueue(async () => {
    const E = await getEngine()
    if (!E) return null
    const { THREE } = E
    const model = await buildItem(E, s)
    if (!model) return null
    const scene = new THREE.Scene()
    scene.environment = E.env
    lightRig(E, scene)
    model.rotation.y = -0.38
    model.rotation.x = 0.1
    scene.add(model)
    const cam = new THREE.PerspectiveCamera(26, 2, 0.1, 50)
    cam.position.set(0, 0.12, 2.5)
    cam.lookAt(0, 0, 0)
    const blob = await snapshot(E, scene, cam, 640, 320, true)
    disposeGroup(model)
    if (!blob) return null
    void idbPut(k, blob)
    const url = URL.createObjectURL(blob)
    cache.set(k, url)
    return url
    })
  })().finally(() => pending.delete(k))
  pending.set(k, p)
  return p
}

/** PNG-снимок кейса (сундук + предмет над ним). */
export function renderCase(id: string): Promise<string | null> {
  const k = 'c:' + id
  if (cache.has(k)) return Promise.resolve(cache.get(k)!)
  if (pending.has(k)) return pending.get(k)!
  const p = (async () => {
    const stored = await idbGet(k)
    if (stored) {
      const u = URL.createObjectURL(stored)
      cache.set(k, u)
      return u
    }
    return enqueue(async () => {
    const E = await getEngine()
    const c = CATALOG.caseById.get(id)
    if (!E || !c) return null
    const { THREE } = E
    const model = await buildCase(E, c)
    const scene = new THREE.Scene()
    scene.environment = E.env
    lightRig(E, scene)
    model.rotation.y = -0.55
    scene.add(model)
    const cam = new THREE.PerspectiveCamera(30, 1, 0.1, 50)
    cam.position.set(0, 1.5, 6.5)
    cam.lookAt(0, 0.9, 0)
    const blob = await snapshot(E, scene, cam, 512, 512)
    disposeGroup(model)
    if (!blob) return null
    void idbPut(k, blob)
    const url = URL.createObjectURL(blob)
    cache.set(k, url)
    return url
    })
  })().finally(() => pending.delete(k))
  pending.set(k, p)
  return p
}

/** Прогрев кэша для кейса: все предметы по очереди. */
export function prewarmCase(c: CaseDef): void {
  const seen = new Set<string>()
  for (const o of c.outcomes) {
    const k = `${o.itemId}:${o.phase}`
    if (seen.has(k)) continue
    seen.add(k)
    void renderItem({ item: o.itemId, phase: o.phase, wear: 0 })
  }
}

/* --------------------- живой вращающийся предмет ----------------------- */
/** Рисует вращающуюся модель на 2D-канвасе. Возвращает функцию остановки. */
export function spin3d(canvas: HTMLCanvasElement, spec: ItemSpec, opts: { speed?: number; reduce?: boolean } = {}): () => void {
  let stop = false
  let model: T.Group | null = null
  let raf = 0
  void (async () => {
    const E = await getEngine()
    if (!E || stop) return
    const { THREE } = E
    model = await buildItem(E, { ...spec, wear: spec.wear >= 3 ? spec.wear : 0 })
    if (!model || stop) return
    const scene = new THREE.Scene()
    scene.environment = E.env
    lightRig(E, scene)
    scene.add(model)
    const cam = new THREE.PerspectiveCamera(26, canvas.width / canvas.height, 0.1, 50)
    cam.position.set(0, 0.1, 2.9)
    cam.lookAt(0, 0, 0)
    const ctx = canvas.getContext('2d')!
    const t0 = performance.now()
    const tick = () => {
      if (stop) return
      const t = (performance.now() - t0) / 1000
      model!.rotation.y = opts.reduce ? -0.5 : -0.5 + Math.sin(t * (opts.speed ?? 0.9)) * 0.75
      model!.rotation.x = 0.1 + Math.sin(t * 0.7) * 0.05
      E.renderer.setSize(canvas.width, canvas.height, false)
      cam.aspect = canvas.width / canvas.height
      cam.updateProjectionMatrix()
      E.renderer.render(scene, cam)
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      ctx.drawImage(E.renderer.domElement, 0, 0)
      raf = requestAnimationFrame(tick)
    }
    tick()
  })()
  return () => {
    stop = true
    cancelAnimationFrame(raf)
    if (model) disposeGroup(model)
  }
}
