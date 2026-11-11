/**
 * Процедурная графика предметов: силуэт + «скин» (паттерн и палитра из id предмета и темы кейса).
 * Результат — SVG в data-URI: браузер растеризует картинку один раз и переиспользует её в ленте и сетках.
 */
import { CATALOG, type ItemDef } from '../shared/catalog'
import { SHAPES } from './shapes'

/* ------------------------------- цвет ----------------------------------- */
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
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
function toHsl(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16)
  const r = ((n >> 16) & 255) / 255
  const g = ((n >> 8) & 255) / 255
  const b = (n & 255) / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  if (max === min) return [0, 0, l * 100]
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  return [h * 60, s * 100, l * 100]
}
const hsl = (h: number, s: number, l: number) =>
  `hsl(${Math.round(((h % 360) + 360) % 360)} ${Math.round(Math.max(0, Math.min(100, s)))}% ${Math.round(Math.max(0, Math.min(100, l)))}%)`


/** 'hsl(H S% L%)' → [r,g,b] 0..255 */
function parseHslParts(css: string): [number, number, number] {
  const m = css.match(/hsl\((\d+)\s+(\d+)%\s+(\d+)%\)/)
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : [0, 0, 50]
}
function parseHsl(css: string): [number, number, number] {
  const [h, s, l] = parseHslParts(css)
  const a = (s / 100) * Math.min(l / 100, 1 - l / 100)
  const f = (n: number) => {
    const k = (n + h / 30) % 12
    return Math.round(255 * (l / 100 - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))))
  }
  return [f(0), f(8), f(4)]
}

/* ------------------------------ паттерны -------------------------------- */
interface Pal { a: string; b: string; c: string; dark: string; light: string }
type Finish = (p: Pal, r: () => number) => { defs: string; fill: string; over?: string }

const pat = (id: string, w: number, h: number, body: string, rot = 0) =>
  `<pattern id="${id}" width="${w}" height="${h}" patternUnits="userSpaceOnUse" patternTransform="rotate(${rot})">${body}</pattern>`
const lin = (id: string, stops: string[], x2 = 1, y2 = 0) =>
  `<linearGradient id="${id}" x1="0" y1="0" x2="${x2}" y2="${y2}">${stops
    .map((c, i) => `<stop offset="${i / (stops.length - 1)}" stop-color="${c}"/>`)
    .join('')}</linearGradient>`

const FINISHES: Finish[] = [
  // 0 градиент
  (p, r) => ({ defs: lin('f', [p.a, p.b, p.c], 1, r() > 0.5 ? 1 : 0), fill: 'url(#f)' }),
  // 1 камуфляж
  (p, r) => {
    let blobs = `<rect width="70" height="70" fill="${p.dark}"/>`
    for (let i = 0; i < 9; i++) {
      const x = r() * 70, y = r() * 70, s = 8 + r() * 14
      blobs += `<path d="M${x} ${y}q${s} ${-s * 0.6} ${s * 1.3} ${s * 0.2}t${-s * 0.4} ${s}t${-s * 1.2} ${-s * 0.3}Z" fill="${[p.a, p.b, p.c][i % 3]}"/>`
    }
    return { defs: pat('f', 70, 70, blobs, r() * 40), fill: 'url(#f)' }
  },
  // 2 полосы
  (p, r) => {
    const w = 8 + Math.floor(r() * 10)
    return { defs: pat('f', w * 2, 10, `<rect width="${w * 2}" height="10" fill="${p.a}"/><rect width="${w}" height="10" fill="${p.b}"/>`, 20 + r() * 50), fill: 'url(#f)' }
  },
  // 3 карбон
  (p) => ({
    defs: pat('f', 8, 8, `<rect width="8" height="8" fill="${p.dark}"/><rect width="4" height="4" fill="${p.a}" opacity=".55"/><rect x="4" y="4" width="4" height="4" fill="${p.a}" opacity=".55"/><rect x="4" width="4" height="4" fill="${p.b}" opacity=".18"/>`, 45),
    fill: 'url(#f)',
  }),
  // 4 неон
  (p, r) => {
    let lines = ''
    for (let i = 0; i < 6; i++) {
      const y = 15 + r() * 70
      const d = `M0 ${y}L${40 + r() * 30} ${y + (r() - 0.5) * 30}L${100 + r() * 30} ${y + (r() - 0.5) * 30}L200 ${y + (r() - 0.5) * 20}`
      const c = i % 2 ? p.a : p.b
      lines += `<path d="${d}" stroke="${c}" stroke-width="5" opacity=".25" fill="none"/><path d="${d}" stroke="${c}" stroke-width="1.6" fill="none"/>`
    }
    return { defs: lin('f', ['#0b0d18', '#141a2e'], 0, 1), fill: 'url(#f)', over: lines }
  },
  // 5 огонь
  (p, r) => {
    let fl = ''
    for (let i = 0; i < 9; i++) {
      const x = i * 24 + r() * 10, h = 25 + r() * 45
      fl += `<path d="M${x - 12} 100Q${x - 6} ${100 - h * 0.6} ${x} ${100 - h}Q${x + 8} ${100 - h * 0.5} ${x + 14} 100Z" fill="${i % 2 ? '#ffd23d' : '#ff7a18'}" opacity=".85"/>`
    }
    return { defs: lin('f', ['#2a0505', '#a11212', '#ff4a1c'], 0, 1), fill: 'url(#f)', over: fl }
  },
  // 6 мрамор
  (p, r) => {
    let v = ''
    for (let i = 0; i < 7; i++) {
      const y = r() * 100
      v += `<path d="M0 ${y}C${50} ${y + (r() - 0.5) * 60} ${100} ${y + (r() - 0.5) * 60} 200 ${y + (r() - 0.5) * 50}" stroke="${i % 2 ? p.light : p.dark}" stroke-width="${1 + r() * 5}" opacity="${0.25 + r() * 0.4}" fill="none"/>`
    }
    return { defs: lin('f', [p.a, p.c, p.b], 1, 1), fill: 'url(#f)', over: v }
  },
  // 7 соты
  (p) => ({
    defs: pat('f', 14, 24, `<rect width="14" height="24" fill="${p.a}"/><path d="M7 0l7 4v8l-7 4l-7-4V4ZM7 16v8M0 12v0M14 12v0" fill="none" stroke="${p.dark}" stroke-width="1.6"/><path d="M0 16l7 4l7-4" fill="none" stroke="${p.dark}" stroke-width="1.6"/>`),
    fill: 'url(#f)',
  }),
  // 8 тигр
  (p, r) => {
    let s = ''
    for (let i = 0; i < 12; i++) {
      const x = i * 18 + r() * 8
      s += `<path d="M${x} 0Q${x + 12} 30 ${x + 2} 50T${x + 6} 100L${x + 12} 100Q${x + 10} 70 ${x + 14} 50T${x + 6} 0Z" fill="${p.dark}"/>`
    }
    return { defs: lin('f', [p.a, p.b], 1, 0), fill: 'url(#f)', over: s }
  },
  // 9 галактика
  (p, r) => {
    let st = `<circle cx="${40 + r() * 40}" cy="${30 + r() * 40}" r="38" fill="${p.a}" opacity=".45"/><circle cx="${120 + r() * 40}" cy="${40 + r() * 30}" r="34" fill="${p.b}" opacity=".4"/>`
    for (let i = 0; i < 46; i++) st += `<circle cx="${r() * 200}" cy="${r() * 100}" r="${0.4 + r() * 1.1}" fill="#fff" opacity="${0.4 + r() * 0.6}"/>`
    return { defs: lin('f', ['#070818', '#1a1040'], 1, 1), fill: 'url(#f)', over: st }
  },
  // 10 горох
  (p, r) => {
    const s = 9 + Math.floor(r() * 6)
    return { defs: pat('f', s, s, `<rect width="${s}" height="${s}" fill="${p.a}"/><circle cx="${s / 2}" cy="${s / 2}" r="${s / 4}" fill="${p.b}"/>`, 30), fill: 'url(#f)' }
  },
  // 11 микросхема
  (p, r) => {
    let c = ''
    for (let i = 0; i < 12; i++) {
      const x = r() * 180, y = 10 + r() * 80, l = 14 + r() * 30
      c += `<path d="M${x} ${y}h${l}v${(r() - 0.5) * 30}h${l * 0.6}" stroke="${p.b}" stroke-width="1.5" fill="none"/><circle cx="${x}" cy="${y}" r="2.2" fill="${p.light}"/>`
    }
    return { defs: lin('f', [p.dark, p.a], 1, 1), fill: 'url(#f)', over: c }
  },
  // 12 чешуя
  (p) => ({
    defs: pat('f', 14, 10, `<rect width="14" height="10" fill="${p.b}"/><path d="M0 0a7 7 0 0 0 14 0M-7 5a7 7 0 0 0 14 0M7 5a7 7 0 0 0 14 0" fill="${p.a}" stroke="${p.dark}" stroke-width="1"/>`),
    fill: 'url(#f)',
  }),
  // 13 пиксели
  (p, r) => {
    let px = ''
    const cols = [p.a, p.b, p.c, p.dark, p.light]
    for (let y = 0; y < 5; y++) for (let x = 0; x < 5; x++) px += `<rect x="${x * 8}" y="${y * 8}" width="8" height="8" fill="${cols[Math.floor(r() * cols.length)]}"/>`
    return { defs: pat('f', 40, 40, px), fill: 'url(#f)' }
  },
  // 14 волны
  (p, r) => {
    const h = 10 + Math.floor(r() * 8)
    return { defs: pat('f', 40, h, `<rect width="40" height="${h}" fill="${p.a}"/><path d="M0 ${h / 2}q10 ${-h} 20 0t20 0" stroke="${p.b}" stroke-width="${h / 3}" fill="none"/>`, r() * 30 - 15), fill: 'url(#f)' }
  },
  // 15 брызги
  (p, r) => {
    let s = ''
    for (let i = 0; i < 40; i++) s += `<circle cx="${r() * 200}" cy="${r() * 100}" r="${1 + r() * 7}" fill="${[p.b, p.c, p.light][i % 3]}" opacity="${0.5 + r() * 0.5}"/>`
    return { defs: lin('f', [p.dark, p.a], 1, 0), fill: 'url(#f)', over: s }
  },
  // 16 клетка
  (p, r) => {
    const s = 16 + Math.floor(r() * 8)
    return { defs: pat('f', s, s, `<rect width="${s}" height="${s}" fill="${p.a}"/><rect width="${s / 2}" height="${s}" fill="${p.b}" opacity=".55"/><rect width="${s}" height="${s / 2}" fill="${p.dark}" opacity=".45"/><path d="M0 ${s * 0.75}h${s}M${s * 0.75} 0v${s}" stroke="${p.light}" stroke-width="1"/>`, 45), fill: 'url(#f)' }
  },
  // 17 кристалл
  (p, r) => {
    let t = ''
    const cols = [p.a, p.b, p.c, p.light, p.dark]
    for (let x = 0; x < 200; x += 25)
      for (let y = 0; y < 100; y += 25) {
        const mx = x + 6 + r() * 13, my = y + 6 + r() * 13
        t += `<path d="M${x} ${y}L${x + 25} ${y}L${mx} ${my}Z" fill="${cols[Math.floor(r() * 5)]}"/><path d="M${x + 25} ${y}L${x + 25} ${y + 25}L${mx} ${my}Z" fill="${cols[Math.floor(r() * 5)]}"/><path d="M${x + 25} ${y + 25}L${x} ${y + 25}L${mx} ${my}Z" fill="${cols[Math.floor(r() * 5)]}"/><path d="M${x} ${y + 25}L${x} ${y}L${mx} ${my}Z" fill="${cols[Math.floor(r() * 5)]}"/>`
      }
    return { defs: '', fill: p.a, over: t }
  },
  // 18 мрамор: многослойные вихри (fractal noise → палитра), как «переливающийся» лак
  (p, r) => {
    const rgb = [p.dark, p.b, p.a, p.c, p.light].map(parseHsl)
    const tv = (k: number) => rgb.map((c) => (c[k] / 255).toFixed(3)).join(' ')
    const seed = Math.floor(r() * 900)
    const fx = (0.006 + r() * 0.01).toFixed(4)
    const fy = (0.02 + r() * 0.02).toFixed(4)
    const filter = `<filter id="mb" filterUnits="userSpaceOnUse" x="0" y="0" width="200" height="100" color-interpolation-filters="sRGB"><feTurbulence type="fractalNoise" baseFrequency="${fx} ${fy}" numOctaves="5" seed="${seed}"/><feComponentTransfer><feFuncR type="table" tableValues="${tv(0)}"/><feFuncG type="table" tableValues="${tv(1)}"/><feFuncB type="table" tableValues="${tv(2)}"/><feFuncA type="linear" slope="0" intercept="1"/></feComponentTransfer></filter>`
    return { defs: filter, fill: p.dark, over: '<rect width="200" height="100" filter="url(#mb)"/>' }
  },
  // 19 фейд: плавный градиент цвета по длине с мягкой зернистостью
  (p, r) => {
    const hue = parseHslParts(p.a)[0]
    const stops = [hsl(hue + 330, 90, 52), hsl(hue + 20, 95, 55), hsl(hue + 55, 95, 58), hsl(hue + 85, 90, 60)]
    const grain = `<filter id="fg" filterUnits="userSpaceOnUse" x="0" y="0" width="200" height="100"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="${Math.floor(r() * 99)}"/><feColorMatrix type="matrix" values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 .5 -.12"/></filter>`
    return { defs: lin('f', stops, 1, 0.35) + grain, fill: 'url(#f)', over: '<rect width="200" height="100" filter="url(#fg)" opacity=".35"/>' }
  },
  // 20 гидрография: жилки как у мрамора, но с резкими краями (ridge)
  (p, r) => {
    const rgb = [p.dark, p.a, p.dark, p.c, p.dark, p.b].map(parseHsl)
    const tv = (k: number) => rgb.map((c) => (c[k] / 255).toFixed(3)).join(' ')
    const seed = Math.floor(r() * 900)
    const filter = `<filter id="hy" filterUnits="userSpaceOnUse" x="0" y="0" width="200" height="100" color-interpolation-filters="sRGB"><feTurbulence type="turbulence" baseFrequency="0.01 0.035" numOctaves="3" seed="${seed}"/><feComponentTransfer><feFuncR type="discrete" tableValues="${tv(0)}"/><feFuncG type="discrete" tableValues="${tv(1)}"/><feFuncB type="discrete" tableValues="${tv(2)}"/><feFuncA type="linear" slope="0" intercept="1"/></feComponentTransfer></filter>`
    return { defs: filter, fill: p.dark, over: '<rect width="200" height="100" filter="url(#hy)"/>' }
  },
]

const GEMS = [
  { a: '#ff2a55', b: '#8a0022', c: '#ff8fa8' },
  { a: '#2a7bff', b: '#0a2a8a', c: '#8fc0ff' },
  { a: '#1ee08a', b: '#06603a', c: '#9dffd0' },
  { a: '#b04dff', b: '#3a0a7a', c: '#e0b0ff' },
]

function palette(item: ItemDef, r: () => number): Pal {
  const c = CATALOG.caseById.get(item.caseId)!
  const [h1, s1, l1] = toHsl(c.colors[0])
  const [h2, s2, l2] = toHsl(c.colors[1])
  const shift = (r() - 0.5) * 70
  const a = hsl(h1 + shift, Math.max(45, s1 + 15), Math.min(68, Math.max(42, l1)))
  const b = hsl(h2 + shift * 0.6, Math.max(40, s2 + 10), Math.min(52, Math.max(26, l2)))
  const c3 = hsl(h1 + shift + (r() > 0.5 ? 150 : 40), 70, 58)
  return { a, b, c: c3, dark: hsl(h2 + shift, 35, 12), light: hsl(h1 + shift, 60, 86) }
}

const cache = new Map<string, string>()

interface Skin { defs: string; fill: string; over: string; glint: string; scratches: string }

/** Скин предмета как набор SVG-частей (поле 200×100 без силуэта). */
function skinParts(item: ItemDef, phase: number, wear: number): Skin {
  const r = rng(hash(item.id))
  let pal = palette(item, r)
  let fin = FINISHES[Math.floor(r() * FINISHES.length)]
  if (phase === 2) {
    const g = GEMS[hash(item.id + 'g') % GEMS.length]
    pal = { a: g.a, b: g.b, c: g.c, dark: g.b, light: g.c }
    fin = FINISHES[17]
  } else if (phase === 3) {
    pal = { a: '#ff3df0', b: '#3df0ff', c: '#ffe14d', dark: '#12062e', light: '#ffffff' }
    fin = FINISHES[9]
  }
  const f = fin(pal, r)
  let scratches = ''
  if (wear >= 3) {
    const sr = rng(hash(item.id + 'w'))
    const n = wear === 3 ? 7 : 16
    for (let i = 0; i < n; i++) {
      const x = sr() * 190, y = sr() * 95
      scratches += `<path d="M${x} ${y}l${6 + sr() * 16} ${(sr() - 0.5) * 8}" stroke="#1a1c22" stroke-width="${0.8 + sr() * 1.6}" opacity=".7"/>`
    }
  }
  const glint = phase === 1 ? `<path d="M-20 100L60 0h26L6 100ZM70 100L150 0h10L80 100Z" fill="#fff" opacity=".32"/>` : ''
  return { defs: f.defs, fill: f.fill, over: f.over ?? '', glint, scratches }
}

/** Текстура скина для 3D: плоское поле 200×100 (вместе с гравировкой-деталями силуэта). */
export function skinTextureSvg(item: ItemDef, phase: number, wear: number): string {
  const sk = skinParts(item, phase, wear)
  const shape = SHAPES[item.shape] ?? SHAPES.pistol
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100" width="1024" height="512"><defs>${sk.defs}</defs>` +
    `<rect width="200" height="100" fill="${sk.fill}"/>${sk.over}${sk.glint}${sk.scratches}` +
    (shape.line ? `<path d="${shape.line}" fill="none" stroke="#000" stroke-opacity=".4" stroke-width="1.3" stroke-linecap="round"/>` : '') +
    `</svg>`
  )
}

/** SVG предмета как строка (плоская версия — запасной вариант, если WebGL недоступен). wear: 0..4, phase: 0..3. */
export function itemSvg(item: ItemDef, phase = 0, wear = 0): string {
  const shape = SHAPES[item.shape] ?? SHAPES.pistol
  const sk = skinParts(item, phase, wear)
  const f = { defs: sk.defs, fill: sk.fill, over: sk.over }
  const glint = sk.glint
  const scratches = sk.scratches
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100">` +
    `<defs>${f.defs}` +
    `<linearGradient id="sh" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".38"/><stop offset=".45" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".42"/></linearGradient>` +
    `<linearGradient id="mt" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#4a4f5c"/><stop offset="1" stop-color="#17191f"/></linearGradient>` +
    `<clipPath id="cp"><path d="${shape.skin}"/></clipPath></defs>` +
    `<g transform="rotate(${shape.tilt} 100 50)">` +
    `<path d="${shape.dark}" fill="url(#mt)" stroke="#0a0b0f" stroke-width="1" stroke-linejoin="round"/>` +
    `<path d="${shape.skin}" fill="${f.fill}"/>` +
    `<g clip-path="url(#cp)">${f.over ?? ''}${glint}${scratches}<rect width="200" height="100" fill="url(#sh)"/></g>` +
    `<path d="${shape.skin}" fill="none" stroke="#0a0b0f" stroke-width="1.4" stroke-linejoin="round"/>` +
    (shape.line ? `<path d="${shape.line}" fill="none" stroke="#000" stroke-opacity=".35" stroke-width="1.3" stroke-linecap="round"/>` : '') +
    `</g></svg>`
  )
}

/** data-URI картинки предмета (с кэшем). */
export function itemImage(itemId: string, phase = 0, wear = 0): string {
  const w = wear >= 3 ? wear : 0
  const key = `${itemId}:${phase}:${w}`
  let uri = cache.get(key)
  if (!uri) {
    const item = CATALOG.itemById.get(itemId)
    if (!item) return ''
    uri = 'data:image/svg+xml;utf8,' + encodeURIComponent(itemSvg(item, phase, w))
    cache.set(key, uri)
  }
  return uri
}
