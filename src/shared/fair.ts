/**
 * Provably fair: hex = HMAC_SHA256(key = server_seed, msg = client_seed:nonce).
 * Своя реализация SHA-256 — чтобы проверка работала в любом браузере (в т. ч. по http в локалке)
 * и синхронно в скриптах. Сверена с эталонными векторами (tests/fair.test.ts).
 */
import type { RollNums } from './roll'

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01,
  0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
  0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
  0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08,
  0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
])

const enc = new TextEncoder()

export function sha256(data: Uint8Array): Uint8Array {
  const h = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19])
  const len = data.length
  const padded = new Uint8Array((((len + 8) >> 6) + 1) << 6)
  padded.set(data)
  padded[len] = 0x80
  const dv = new DataView(padded.buffer)
  dv.setUint32(padded.length - 8, Math.floor((len * 8) / 2 ** 32))
  dv.setUint32(padded.length - 4, (len * 8) >>> 0)
  const w = new Uint32Array(64)
  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4)
    for (let i = 16; i < 64; i++) {
      const a = w[i - 15]
      const b = w[i - 2]
      const s0 = ((a >>> 7) | (a << 25)) ^ ((a >>> 18) | (a << 14)) ^ (a >>> 3)
      const s1 = ((b >>> 17) | (b << 15)) ^ ((b >>> 19) | (b << 13)) ^ (b >>> 10)
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0
    }
    let [a, b, c, d, e, f, g, hh] = h
    for (let i = 0; i < 64; i++) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7))
      const ch = (e & f) ^ (~e & g)
      const t1 = (hh + S1 + ch + K[i] + w[i]) >>> 0
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10))
      const maj = (a & b) ^ (a & c) ^ (b & c)
      const t2 = (S0 + maj) >>> 0
      hh = g
      g = f
      f = e
      e = (d + t1) >>> 0
      d = c
      c = b
      b = a
      a = (t1 + t2) >>> 0
    }
    h[0] += a; h[1] += b; h[2] += c; h[3] += d; h[4] += e; h[5] += f; h[6] += g; h[7] += hh
  }
  const out = new Uint8Array(32)
  const odv = new DataView(out.buffer)
  for (let i = 0; i < 8; i++) odv.setUint32(i * 4, h[i])
  return out
}

function hmac(key: Uint8Array, msg: Uint8Array): Uint8Array {
  const k = new Uint8Array(64)
  k.set(key.length > 64 ? sha256(key) : key)
  const ipad = new Uint8Array(64 + msg.length)
  const opad = new Uint8Array(64 + 32)
  for (let i = 0; i < 64; i++) {
    ipad[i] = k[i] ^ 0x36
    opad[i] = k[i] ^ 0x5c
  }
  ipad.set(msg, 64)
  opad.set(sha256(ipad), 64)
  return sha256(opad)
}

const toHex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')

export const sha256HexSync = (s: string): string => toHex(sha256(enc.encode(s)))
export const hmacHexSync = (key: string, msg: string): string => toHex(hmac(enc.encode(key), enc.encode(msg)))

export const sha256Hex = async (s: string): Promise<string> => sha256HexSync(s)
export const hmacHex = async (key: string, msg: string): Promise<string> => hmacHexSync(key, msg)

/** Сообщение, которое подписывается server seed'ом. */
export const rollMessage = (clientSeed: string, nonce: number): string => `${clientSeed}:${nonce}`

/** hex HMAC → числа ролла. Зеркало SQL game.roll_nums. */
export function splitRoll(hex: string): RollNums {
  if (!/^[0-9a-f]{64}$/.test(hex)) throw new Error('Ожидался hex из 64 символов')
  return {
    n0: parseInt(hex.slice(0, 13), 16),
    n1: parseInt(hex.slice(13, 21), 16),
    n2: parseInt(hex.slice(21, 29), 16),
    n3: parseInt(hex.slice(29, 37), 16),
  }
}

/** Числа ролла для пары сидов и nonce. */
export const rollNums = (serverSeed: string, clientSeed: string, nonce: number): RollNums =>
  splitRoll(hmacHexSync(serverSeed, rollMessage(clientSeed, nonce)))

/** Случайный client seed. */
export function randomSeed(len = 16): string {
  const a = new Uint8Array(len)
  crypto.getRandomValues(a)
  return toHex(a).slice(0, len)
}
