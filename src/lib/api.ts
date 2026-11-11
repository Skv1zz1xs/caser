import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const URL_ = import.meta.env.VITE_SUPABASE_URL as string | undefined
const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

/** Заданы ли ключи Supabase (иначе показываем экран настройки). */
export const configured = Boolean(URL_ && KEY && !URL_.includes('xxxxxxxx'))

export const supabase: SupabaseClient | null = configured
  ? createClient(URL_!, KEY!, { auth: { persistSession: true, autoRefreshToken: true, storageKey: 'zalet-auth' } })
  : null

/* ------------------------------- типы ----------------------------------- */
export interface Item {
  id: number
  case: string
  idx: number
  item: string
  phase: number
  rarity: number
  fi: number
  st: boolean
  price: number
  src: string
  at: number
  /** множитель к цене кейса ×100 (только у свежих дропов) */
  x?: number
  nonce?: number
}

export interface Me {
  id: string
  nick: string
  avatar: number
  balance: number
  xp: number
  level: number
  stats: Record<string, number>
  best: Item[]
  tickets: Record<string, number>
  inv_rev: number
  inv_count: number
  inv_value: number
  pending: number
  free_case_at: number | null
  daily_at: number | null
  daily_streak: number
  second_at: number | null
  day: string
  week: string
  counters: { day: Record<string, number>; week: Record<string, number> }
  claims: string[]
  fair: { hash: string; client_seed: string; nonce: number; seed_id: number }
}

export interface ChatMsg { id: number; pid: string | null; nick: string; avatar: number; level: number; kind: string; body: string; at: number }
export interface FeedMsg { id: number; pid: string | null; nick: string; avatar: number; kind: string; data: any; at: number }
export interface BattlePlayer { slot: number; pid: string | null; nick: string; avatar: number; bot: boolean }
export interface BattleDrop { case: string; idx: number; item: string; phase: number; rarity: number; fi: number; st: boolean; price: number }
export interface Battle {
  id: string
  status: 'open' | 'done' | 'cancelled'
  mode: string
  format: string
  cases: string[]
  cost: number
  private: boolean
  created_by: string
  players: (BattlePlayer | null)[]
  seed_hash: string
  created_at: number
  started_at: number | null
  ends_at: number | null
  rounds: BattleDrop[][]
  summary: { sums: number[]; teamSums: number[]; pot: number; winnerTeam: number; payouts: number[]; tie: number } | null
  seed: string | null
  now: number
}
export interface Coinflip {
  id: number
  status: string
  stake: number
  creator: string
  creator_nick: string
  creator_avatar: number
  creator_side: number
  joiner: string | null
  joiner_nick: string | null
  joiner_avatar: number | null
  joiner_bot: boolean
  seed_hash: string
  result: number | null
  winner: string | null
  payout: number | null
  server_seed: string | null
  started_at: number | null
  ends_at: number | null
  created_at: number
}
export interface Rain { id: number; active: boolean; pot: number; ends_at: number; joiners: number; joined: boolean; share: number; next_at: number }
export interface GameEvent { on: boolean; ends_at: number; next_at: number }
export interface SyncData {
  event?: GameEvent
  now: number
  version: string | null
  me: Me | null
  chat?: ChatMsg[]
  feed?: FeedMsg[]
  battles?: Battle[]
  coinflips?: Coinflip[]
  rain?: Rain | null
  online?: number
}

/** Вызов серверной функции. Ошибка сервера → Error с русским текстом. */
export async function rpc<T = any>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  if (!supabase) throw new Error('Supabase не настроен')
  const { data, error } = await supabase.rpc(fn, args)
  if (error) {
    const m = error.message || 'Ошибка сервера'
    throw new Error(/fetch|network|Failed/i.test(m) ? 'Нет связи с сервером' : m)
  }
  return data as T
}

/** Анонимная сессия Supabase (создаётся один раз на устройство). */
export async function ensureSession(): Promise<void> {
  if (!supabase) throw new Error('Supabase не настроен')
  const { data } = await supabase.auth.getSession()
  if (data.session) return
  const { error } = await supabase.auth.signInAnonymously()
  if (error) {
    if (/anonymous/i.test(error.message)) throw new Error('В Supabase выключен анонимный вход: Authentication → Sign In / Providers → Anonymous')
    throw new Error('Не удалось создать сессию: ' + error.message)
  }
}
