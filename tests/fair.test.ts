import { describe, it, expect } from 'vitest'
import { hmacHex, sha256Hex, splitRoll, rollMessage } from '../src/shared/fair'

describe('provably fair', () => {
  it('HMAC-SHA256 совпадает с эталонным вектором RFC 4231 №2', async () => {
    expect(await hmacHex('Jefe', 'what do ya want for nothing?')).toBe(
      '5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843',
    )
  })

  it('SHA-256 совпадает с эталоном', async () => {
    expect(await sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  })

  it('сообщение ролла = client_seed:nonce', () => {
    expect(rollMessage('мой-сид', 42)).toBe('мой-сид:42')
  })

  it('splitRoll режет hex на n0 (52 бита) и три 32-битных числа', () => {
    const hex = 'fffffffffffff' + '00000001' + 'ffffffff' + '0000000a' + '0'.repeat(27)
    const n = splitRoll(hex)
    expect(n.n0).toBe(2 ** 52 - 1)
    expect(n.n1).toBe(1)
    expect(n.n2).toBe(2 ** 32 - 1)
    expect(n.n3).toBe(10)
  })

  it('один и тот же сид и nonce дают один и тот же ролл, разные nonce — разный', async () => {
    const a = await hmacHex('seed', rollMessage('c', 1))
    const b = await hmacHex('seed', rollMessage('c', 1))
    const c = await hmacHex('seed', rollMessage('c', 2))
    expect(a).toBe(b)
    expect(a).not.toBe(c)
  })

  it('splitRoll отвергает мусор', () => {
    expect(() => splitRoll('xyz')).toThrow()
  })
})
