import { create } from 'zustand'
import { CATALOG } from '../shared/catalog'
import { configured, ensureSession, rpc, supabase, type GameEvent, type Battle, type ChatMsg, type Coinflip, type FeedMsg, type Item, type Me, type Rain, type SyncData } from '../lib/api'

export interface Toast { id: number; kind: 'ok' | 'err' | 'info' | 'gold'; text: string }

interface State {
  phase: 'boot' | 'setup' | 'login' | 'ready' | 'error'
  error: string
  me: Me | null
  items: Item[]
  itemsRev: number
  itemsLoaded: boolean
  chat: ChatMsg[]
  feed: FeedMsg[]
  battles: Battle[]
  coinflips: Coinflip[]
  rain: Rain | null
  event: GameEvent | null
  online: number
  /** серверное время − локальное, мс */
  offset: number
  versionMismatch: boolean
  realtime: boolean
  net: 'ok' | 'offline'
  toasts: Toast[]
  chatOpen: boolean
  unread: number
  sound: boolean
  fast: boolean

  boot(): Promise<void>
  login(nick: string, pin: string, avatar: number): Promise<string | null>
  logout(): Promise<void>
  sync(): Promise<void>
  setMe(me: Me): void
  loadItems(force?: boolean): Promise<void>
  addItems(items: Item[]): void
  removeItems(ids: number[]): void
  toast(text: string, kind?: Toast['kind']): void
  dropToast(id: number): void
  /** обёртка для действий: ловит ошибку, показывает тост, пересинхронизируется */
  run<T>(fn: () => Promise<T>): Promise<T | null>
  set(p: Partial<State>): void
  now(): number
}

const LS = { sound: 'zalet-sound', fast: 'zalet-fast' }
let toastId = 1
let timer: ReturnType<typeof setTimeout> | null = null
let syncing = false
let again = false
let booted = false

export const useGame = create<State>((set, get) => ({
  phase: 'boot',
  error: '',
  me: null,
  items: [],
  itemsRev: -1,
  itemsLoaded: false,
  chat: [],
  feed: [],
  battles: [],
  coinflips: [],
  rain: null,
  event: null,
  online: 0,
  offset: 0,
  versionMismatch: false,
  realtime: false,
  net: 'ok',
  toasts: [],
  chatOpen: false,
  unread: 0,
  sound: localStorage.getItem(LS.sound) !== '0',
  fast: localStorage.getItem(LS.fast) === '1',

  set: (p) => {
    if (p.sound !== undefined) localStorage.setItem(LS.sound, p.sound ? '1' : '0')
    if (p.fast !== undefined) localStorage.setItem(LS.fast, p.fast ? '1' : '0')
    set(p)
  },
  now: () => Date.now() + get().offset,

  async boot() {
    if (booted) return
    booted = true
    if (!configured) return set({ phase: 'setup' })
    try {
      await ensureSession()
      await get().sync()
      set({ phase: get().me ? 'ready' : 'login' })
      startRealtime()
      schedule()
    } catch (e: any) {
      set({ phase: 'error', error: e.message })
    }
  },

  async login(nick, pin, avatar) {
    try {
      const r = await rpc<{ ok: boolean; error?: string; me?: Me }>('login', { p_nick: nick, p_pin: pin, p_avatar: avatar })
      if (!r.ok) return r.error ?? 'Не получилось войти'
      set({ me: r.me!, phase: 'ready', items: [], itemsLoaded: false, itemsRev: -1 })
      void get().sync()
      return null
    } catch (e: any) {
      return e.message
    }
  },

  async logout() {
    await rpc('logout').catch(() => {})
    set({ me: null, phase: 'login', items: [], itemsLoaded: false, itemsRev: -1 })
  },

  async sync() {
    if (syncing) {
      again = true
      return
    }
    syncing = true
    try {
      const s = get()
      const d = await rpc<SyncData>('sync', { p_chat_after: s.chat.at(-1)?.id ?? 0, p_feed_after: s.feed.at(-1)?.id ?? 0 })
      const patch: Partial<State> = { offset: d.now - Date.now(), versionMismatch: d.version !== null && d.version !== CATALOG.version }
      if (d.version === null) throw new Error('Сервер не настроен: выполни supabase/seed.sql в SQL Editor')
      if (!d.me) {
        if (s.phase === 'ready') patch.phase = 'login'
        patch.me = null
      } else {
        patch.me = d.me
        if (d.chat?.length) {
          patch.chat = [...s.chat, ...d.chat].slice(-150)
          if (!s.chatOpen && s.chat.length) patch.unread = s.unread + d.chat.filter((m) => m.pid !== d.me!.id).length
        }
        if (d.feed?.length) patch.feed = [...s.feed, ...d.feed].slice(-60)
        patch.battles = d.battles ?? []
        patch.coinflips = d.coinflips ?? []
        patch.rain = d.rain ?? null
        patch.event = d.event ?? null
        patch.online = d.online ?? 0
      }
      patch.net = 'ok'
      set(patch)
      if (d.me && get().itemsLoaded && d.me.inv_rev !== get().itemsRev) void get().loadItems(true)
    } catch (e) {
      if (/связи|fetch|network|Failed/i.test(String((e as Error).message))) set({ net: 'offline' })
      throw e
    } finally {
      syncing = false
      if (again) {
        again = false
        void get().sync()
      }
    }
  },

  setMe(me) {
    set({ me })
  },

  async loadItems(force) {
    if (get().itemsLoaded && !force) return
    const r = await rpc<{ rev: number; items: Item[] }>('get_inventory')
    set({ items: r.items, itemsRev: r.rev, itemsLoaded: true })
  },

  addItems(items) {
    const s = get()
    if (!s.itemsLoaded) return
    set({ items: [...items, ...s.items].sort((a, b) => b.price - a.price), itemsRev: s.me?.inv_rev ?? s.itemsRev })
  },

  removeItems(ids) {
    const s = get()
    const del = new Set(ids)
    set({ items: s.items.filter((i) => !del.has(i.id)), itemsRev: s.me?.inv_rev ?? s.itemsRev })
  },

  toast(text, kind = 'info') {
    const id = toastId++
    set({ toasts: [...get().toasts.slice(-3), { id, kind, text }] })
    setTimeout(() => get().dropToast(id), kind === 'gold' ? 6000 : 3500)
  },
  dropToast(id) {
    set({ toasts: get().toasts.filter((t) => t.id !== id) })
  },

  async run(fn) {
    try {
      return await fn()
    } catch (e: any) {
      const m = String(e.message ?? 'Ошибка')
      get().toast(/Failed to fetch|NetworkError|Load failed/i.test(m) ? 'Нет связи с сервером. Проверь интернет и попробуй ещё раз' : m, 'err')
      void get().sync()
      if (get().itemsLoaded) void get().loadItems(true)
      return null
    }
  },
}))

/** Применить ответ сервера с полем me (и синхронизировать версию инвентаря). */
export function applyMe<T extends { me: Me }>(r: T): T {
  const s = useGame.getState()
  useGame.setState({ me: r.me, itemsRev: s.itemsLoaded ? r.me.inv_rev : s.itemsRev })
  return r
}

/* ------------------- цикл синхронизации + realtime ---------------------- */
function schedule() {
  if (timer) clearTimeout(timer)
  const s = useGame.getState()
  const hidden = document.visibilityState === 'hidden'
  const delay = hidden ? 20000 : s.realtime ? 7000 : 2500
  timer = setTimeout(async () => {
    if (useGame.getState().phase === 'ready' || useGame.getState().phase === 'login') await useGame.getState().sync().catch(() => {})
    schedule()
  }, delay)
}

let nudge: ReturnType<typeof setTimeout> | null = null
function startRealtime() {
  if (!supabase) return
  const kick = () => {
    if (nudge) return
    nudge = setTimeout(() => {
      nudge = null
      void useGame.getState().sync().catch(() => {})
    }, 250)
  }
  let ch = supabase.channel('live')
  for (const table of ['chat', 'feed', 'battles', 'coinflips', 'rain']) ch = ch.on('postgres_changes' as any, { event: '*', schema: 'public', table }, kick)
  ch.subscribe((status) => useGame.setState({ realtime: status === 'SUBSCRIBED' }))
  window.addEventListener('offline', () => useGame.setState({ net: 'offline' }))
  window.addEventListener('online', () => void useGame.getState().sync().catch(() => {}))
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      void useGame.getState().sync().catch(() => {})
      schedule()
    }
  })
}
