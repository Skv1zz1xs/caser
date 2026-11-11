/**
 * Звуки синтезируются кодом (никаких файлов и чужих сэмплов): PCM → WAV → Howler.
 */
import { Howl } from 'howler'
import { useGame } from '../store/game'

const RATE = 22050
type Gen = (t: number, dur: number) => number

function wav(dur: number, gen: Gen, vol = 0.6): string {
  const n = Math.floor(RATE * dur)
  const buf = new ArrayBuffer(44 + n * 2)
  const dv = new DataView(buf)
  const str = (o: number, s: string) => [...s].forEach((c, i) => dv.setUint8(o + i, c.charCodeAt(0)))
  str(0, 'RIFF'); dv.setUint32(4, 36 + n * 2, true); str(8, 'WAVEfmt '); dv.setUint32(16, 16, true)
  dv.setUint16(20, 1, true); dv.setUint16(22, 1, true); dv.setUint32(24, RATE, true); dv.setUint32(28, RATE * 2, true)
  dv.setUint16(32, 2, true); dv.setUint16(34, 16, true); str(36, 'data'); dv.setUint32(40, n * 2, true)
  for (let i = 0; i < n; i++) {
    const t = i / RATE
    const fade = Math.min(1, i / 60, (n - i) / 200)
    dv.setInt16(44 + i * 2, Math.max(-1, Math.min(1, gen(t, dur) * vol * fade)) * 32767, true)
  }
  let bin = ''
  const u8 = new Uint8Array(buf)
  for (let i = 0; i < u8.length; i++) bin += String.fromCharCode(u8[i])
  return 'data:audio/wav;base64,' + btoa(bin)
}

const sin = (f: number, t: number) => Math.sin(2 * Math.PI * f * t)
const env = (t: number, d: number) => Math.exp(-t / d)
let seed = 7
const noise = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1
/** арпеджио: ноты по очереди с затуханием */
const arp = (freqs: number[], step: number, decay: number): Gen => (t) =>
  freqs.reduce((a, f, i) => (t >= i * step ? a + (sin(f, t - i * step) + 0.4 * sin(f * 2, t - i * step)) * env(t - i * step, decay) : a), 0) / 1.6

const DEFS: Record<string, () => string> = {
  tick: () => wav(0.035, (t) => (sin(1900, t) * 0.6 + noise() * 0.4) * env(t, 0.008), 0.5),
  click: () => wav(0.05, (t) => sin(700 - t * 4000, t) * env(t, 0.015), 0.4),
  open: () => wav(0.35, (t, d) => noise() * env(d - t, 0.12) * 0.5 + sin(180 + t * 500, t) * 0.3 * env(t, 0.2), 0.5),
  common: () => wav(0.18, (t) => sin(330, t) * env(t, 0.06), 0.4),
  good: () => wav(0.5, arp([523, 659, 784], 0.07, 0.16), 0.5),
  rare: () => wav(0.9, arp([523, 659, 784, 1047, 1319], 0.08, 0.25), 0.55),
  gold: () => wav(1.8, (t) => arp([392, 523, 659, 784, 1047, 1319, 1568], 0.1, 0.5)(t, 0) + sin(98, t) * 0.35 * env(t, 0.9), 0.6),
  sell: () => wav(0.22, arp([1568, 2093], 0.06, 0.07), 0.35),
  coin: () => wav(0.3, arp([1319, 1760, 2637], 0.05, 0.09), 0.35),
  fail: () => wav(0.5, (t) => (sin(196 - t * 120, t) + 0.5 * sin(98 - t * 60, t)) * env(t, 0.22), 0.5),
  win: () => wav(1.0, arp([659, 784, 988, 1319, 1568], 0.09, 0.3), 0.55),
  spin: () => wav(0.06, (t) => sin(1200, t) * env(t, 0.012), 0.3),
  start: () => wav(0.45, arp([440, 440, 880], 0.14, 0.1), 0.45),
  boom: () => wav(1.4, (t) => (sin(52 - t * 22, t) * 1.4 + noise() * 0.6) * env(t, 0.32) + sin(110 - t * 40, t) * 0.5 * env(t, 0.5), 0.8),
  chat: () => wav(0.12, arp([988, 1319], 0.05, 0.05), 0.25),
  rain: () => wav(0.7, arp([784, 988, 1175, 1568], 0.12, 0.2), 0.4),
}

const cache = new Map<string, Howl>()

/** Проиграть звук. rate — высота/скорость (для тиков под конец прокрутки). */
export function sfx(name: keyof typeof DEFS | string, rate = 1): void {
  if (!useGame.getState().sound) return
  try {
    let h = cache.get(name)
    if (!h) {
      const def = DEFS[name]
      if (!def) return
      h = new Howl({ src: [def()], format: ['wav'], volume: 0.7 })
      cache.set(name, h)
    }
    const id = h.play()
    if (rate !== 1) h.rate(rate, id)
  } catch {
    /* звук не критичен */
  }
}

/** Звук под редкость дропа. */
export function dropSound(rarity: number, phase = 0): void {
  if (rarity >= 6 || phase >= 2) sfx('gold')
  else if (rarity >= 4) sfx('rare')
  else if (rarity >= 2) sfx('good')
  else sfx('common')
}
