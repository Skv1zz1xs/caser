import { type CaseDef, type Outcome, itemOf } from './catalog'
import { FI_RANGE, ST_LIMIT, TICKETS, instancePrice, wearIndex } from './money'

export { instancePrice, wearIndex }

/** Числа одного ролла (из HMAC): n0 — 52 бита, n1..n3 — по 32 бита. */
export interface RollNums { n0: number; n1: number; n2: number; n3: number }

export interface Drop {
  caseId: string
  outcomeIdx: number
  itemId: string
  phase: number
  /** износ 0..9999 */
  fi: number
  st: boolean
  /** цена экземпляра, копейки */
  price: number
}

/** Билет (0..TICKETS−1) → исход кейса. */
export function pickOutcome(c: CaseDef, ticket: number): Outcome {
  if (!Number.isInteger(ticket) || ticket < 0 || ticket >= TICKETS) throw new Error(`Билет вне диапазона: ${ticket}`)
  let lo = 0
  let hi = c.outcomes.length - 1
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (ticket < c.outcomes[mid].cum) hi = mid
    else lo = mid + 1
  }
  return c.outcomes[lo]
}

/** Полный дроп из чисел ролла. Зеркало SQL game.roll_drop. */
export function rollDrop(c: CaseDef, n: RollNums): Drop {
  const o = pickOutcome(c, n.n0 % TICKETS)
  const fi = n.n1 % FI_RANGE
  const st = itemOf(o.itemId).st && n.n2 % FI_RANGE < ST_LIMIT
  return { caseId: c.id, outcomeIdx: o.idx, itemId: o.itemId, phase: o.phase, fi, st, price: instancePrice(o.price, fi, st) }
}
