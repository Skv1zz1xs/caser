/**
 * npm run stack — локальный «мини-Supabase» для разработки и e2e-тестов без облака.
 *
 * Поднимает на http://127.0.0.1:54321 то, чем клиент пользуется у настоящего Supabase:
 *   /auth/v1/*            анонимные сессии (JWT HS256)
 *   /rest/v1/rpc/<fn>     вызов функций public.* (как PostgREST: аргументы через json_to_record)
 *   /realtime/v1/websocket  события postgres_changes (LISTEN/NOTIFY)
 *
 * Нужен локальный Postgres: DEV_PG_URL (по умолчанию postgres://postgres:postgres@127.0.0.1:5432/postgres).
 * База zalet_dev создаётся сама; `npm run stack -- --reset` пересоздаёт её с нуля.
 * Клиент: `npm run dev:stack` (берёт адрес и ключ из .env.stack).
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { createHmac, randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import pg from 'pg'
import { WebSocketServer, type WebSocket } from 'ws'
import { buildSeedSql } from '../lib/seed'

const BASE = process.env.DEV_PG_URL ?? 'postgres://postgres:postgres@127.0.0.1:5432/postgres'
const DB = process.env.DEV_DB ?? 'zalet_dev'
const PORT = Number(process.env.STACK_PORT ?? 54321)
const SECRET = 'zalet-local-dev-secret-not-for-production'
const WATCHED = ['feed', 'chat', 'battles', 'coinflips', 'rain']

/* ------------------------------- JWT ------------------------------------ */
const b64 = (s: string | Buffer) => Buffer.from(s).toString('base64url')
function sign(payload: object): string {
  const body = b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' })) + '.' + b64(JSON.stringify(payload))
  return body + '.' + createHmac('sha256', SECRET).update(body).digest('base64url')
}
function verify(token: string | undefined): any | null {
  if (!token) return null
  const [h, p, s] = token.split('.')
  if (!h || !p || !s) return null
  if (createHmac('sha256', SECRET).update(h + '.' + p).digest('base64url') !== s) return null
  const payload = JSON.parse(Buffer.from(p, 'base64url').toString())
  return payload.exp && payload.exp < Date.now() / 1000 ? null : payload
}
const userOf = (id: string) => ({
  id, aud: 'authenticated', role: 'authenticated', email: '', phone: '', is_anonymous: true,
  app_metadata: {}, user_metadata: {}, identities: [], created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
})
function session(id: string) {
  const now = Math.floor(Date.now() / 1000)
  const expires_in = 3600 * 24 * 7
  return {
    access_token: sign({ sub: id, role: 'authenticated', aud: 'authenticated', is_anonymous: true, iat: now, exp: now + expires_in }),
    token_type: 'bearer', expires_in, expires_at: now + expires_in,
    refresh_token: sign({ sub: id, kind: 'refresh' }), user: userOf(id),
  }
}

/* ------------------------------ База ------------------------------------ */
async function prepareDb(): Promise<pg.Pool> {
  const root = new pg.Client(BASE)
  await root.connect()
  if (process.argv.includes('--reset')) await root.query('drop database if exists ' + DB + ' with (force)')
  const exists = (await root.query('select 1 from pg_database where datname = $1', [DB])).rowCount
  if (!exists) await root.query('create database ' + DB)
  await root.end()
  const url = new URL(BASE)
  url.pathname = '/' + DB
  const pool = new pg.Pool({ connectionString: url.toString(), max: 10 })
  pg.types.setTypeParser(20, (v) => Number(v))
  await pool.query(readFileSync(new URL('./bootstrap.sql', import.meta.url), 'utf8'))
  await pool.query(readFileSync(new URL('../../supabase/schema.sql', import.meta.url), 'utf8'))
  await pool.query(buildSeedSql())
  // уведомления об изменениях — замена Supabase Realtime
  await pool.query(`
    create or replace function public.devstack_notify() returns trigger language plpgsql as $f$
    begin perform pg_notify('zalet_changes', tg_table_name); return null; end $f$;`)
  for (const t of WATCHED)
    await pool.query(`drop trigger if exists devstack_notify on public.${t};
      create trigger devstack_notify after insert or update or delete on public.${t} for each statement execute function public.devstack_notify();`)
  return pool
}

/* ------------------------------ RPC ------------------------------------- */
const sigCache = new Map<string, { name: string; type: string }[]>()
async function signature(pool: pg.Pool, fn: string) {
  if (sigCache.has(fn)) return sigCache.get(fn)!
  const r = await pool.query(
    `select coalesce(p.proargnames, '{}') as names, array(select format_type(t, null) from unnest(p.proargtypes::oid[]) t) as types
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = $1`,
    [fn],
  )
  if (!r.rowCount) return null
  const args = (r.rows[0].types as string[]).map((type, i) => ({ name: r.rows[0].names[i] as string, type }))
  sigCache.set(fn, args)
  return args
}

async function callRpc(pool: pg.Pool, fn: string, claims: any, body: Record<string, unknown>) {
  if (!/^[a-z_]+$/.test(fn)) return { status: 404, json: { code: 'PGRST202', message: 'Function not found' } }
  const sig = await signature(pool, fn)
  if (!sig) return { status: 404, json: { code: 'PGRST202', message: `Could not find the function public.${fn} in the schema cache` } }
  const used = sig.filter((a) => a.name in body)
  const unknown = Object.keys(body).filter((k) => !sig.some((a) => a.name === k))
  if (unknown.length) return { status: 404, json: { code: 'PGRST202', message: `Could not find the function public.${fn}(${unknown.join(', ')})` } }
  const sql = used.length
    ? `select public.${fn}(${used.map((a) => `${a.name} => x.${a.name}`).join(', ')}) as r from json_to_record($1::json) as x(${used.map((a) => `${a.name} ${a.type}`).join(', ')})`
    : `select public.${fn}() as r`
  const c = await pool.connect()
  try {
    await c.query('begin')
    await c.query('set local role authenticated')
    await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims)])
    const res = await c.query(sql, used.length ? [JSON.stringify(body)] : [])
    await c.query('commit')
    return { status: 200, json: res.rows[0].r }
  } catch (e: any) {
    await c.query('rollback').catch(() => {})
    return { status: 400, json: { code: e.code ?? 'P0001', message: e.message, details: e.detail ?? null, hint: e.hint ?? null } }
  } finally {
    c.release()
  }
}

/* ------------------------------ HTTP ------------------------------------ */
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
  'Access-Control-Max-Age': '86400',
}
function send(res: ServerResponse, status: number, json?: unknown) {
  res.writeHead(status, { ...CORS, 'Content-Type': 'application/json; charset=utf-8' })
  res.end(json === undefined ? '' : JSON.stringify(json))
}
function readBody(req: IncomingMessage): Promise<any> {
  return new Promise((resolve) => {
    let data = ''
    req.on('data', (c) => (data += c))
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {})
      } catch {
        resolve({})
      }
    })
  })
}
const bearer = (req: IncomingMessage) => verify(String(req.headers.authorization ?? '').replace(/^Bearer\s+/i, ''))

async function main() {
  const pool = await prepareDb()

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://x')
      if (req.method === 'OPTIONS') return send(res, 204)
      if (url.pathname === '/auth/v1/signup' && req.method === 'POST') return send(res, 200, session(randomUUID()))
      if (url.pathname === '/auth/v1/token' && req.method === 'POST') {
        const body = await readBody(req)
        const p = verify(body.refresh_token)
        if (!p || p.kind !== 'refresh') return send(res, 400, { error: 'invalid_grant', error_description: 'Invalid Refresh Token', code: 'refresh_token_not_found' })
        return send(res, 200, session(p.sub))
      }
      if (url.pathname === '/auth/v1/user') {
        const p = bearer(req)
        return p?.sub ? send(res, 200, userOf(p.sub)) : send(res, 401, { message: 'invalid JWT', code: 'bad_jwt' })
      }
      if (url.pathname === '/auth/v1/logout') return send(res, 204)
      const m = url.pathname.match(/^\/rest\/v1\/rpc\/([^/]+)$/)
      if (m && req.method === 'POST') {
        const claims = bearer(req)
        if (!claims?.sub) return send(res, 401, { code: 'PGRST301', message: 'JWT invalid' })
        const r = await callRpc(pool, m[1], claims, await readBody(req))
        return send(res, r.status, r.json)
      }
      send(res, 404, { message: 'not found' })
    } catch (e: any) {
      send(res, 500, { message: e.message })
    }
  })

  /* ---------------------------- Realtime -------------------------------- */
  interface Sub { ws: WebSocket; topic: string; tables: Map<string, number>; array: boolean }
  const subs = new Set<Sub>()
  let subId = 1
  const wss = new WebSocketServer({ server, path: '/realtime/v1/websocket' })
  wss.on('connection', (ws) => {
    ws.on('message', (raw) => {
      let msg: any
      try {
        msg = JSON.parse(raw.toString())
      } catch {
        return
      }
      const array = Array.isArray(msg)
      const [join_ref, ref, topic, event, payload] = array ? msg : [msg.join_ref, msg.ref, msg.topic, msg.event, msg.payload]
      const out = (ev: string, pl: unknown, r: string | null = ref) =>
        ws.send(JSON.stringify(array ? [join_ref ?? null, r, topic, ev, pl] : { topic, event: ev, payload: pl, ref: r, join_ref }))
      if (event === 'heartbeat') return out('phx_reply', { status: 'ok', response: {} })
      if (event === 'phx_join') {
        const wanted: any[] = payload?.config?.postgres_changes ?? []
        const tables = new Map<string, number>()
        const resp = wanted.map((w) => {
          const id = subId++
          tables.set(w.table, id)
          return { id, event: w.event, schema: w.schema, table: w.table, ...(w.filter ? { filter: w.filter } : {}) }
        })
        subs.add({ ws, topic, tables, array })
        out('phx_reply', { status: 'ok', response: { postgres_changes: resp } })
        return out('system', { status: 'ok', message: 'Subscribed to PostgreSQL', channel: String(topic).replace(/^realtime:/, ''), extension: 'postgres_changes' }, null)
      }
      if (event === 'phx_leave') {
        for (const s of subs) if (s.ws === ws && s.topic === topic) subs.delete(s)
        return out('phx_reply', { status: 'ok', response: {} })
      }
      if (ref) out('phx_reply', { status: 'ok', response: {} })
    })
    ws.on('close', () => {
      for (const s of subs) if (s.ws === ws) subs.delete(s)
    })
  })

  const listener = new pg.Client((pool as any).options.connectionString)
  await listener.connect()
  await listener.query('listen zalet_changes')
  listener.on('notification', (n) => {
    const table = n.payload ?? ''
    for (const s of subs) {
      const id = s.tables.get(table)
      if (id === undefined || s.ws.readyState !== 1) continue
      const payload = {
        ids: [id],
        data: { schema: 'public', table, commit_timestamp: new Date().toISOString(), type: 'INSERT', columns: [], record: {}, old_record: {}, errors: null },
      }
      s.ws.send(JSON.stringify(s.array ? [null, null, s.topic, 'postgres_changes', payload] : { topic: s.topic, event: 'postgres_changes', payload, ref: null }))
    }
  })

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`mini-Supabase: http://127.0.0.1:${PORT}  (база ${DB})`)
    console.log('Клиент: npm run dev:stack')
  })
  const stop = async () => {
    server.close()
    await listener.end().catch(() => {})
    await pool.end().catch(() => {})
    process.exit(0)
  }
  process.on('SIGINT', stop)
  process.on('SIGTERM', stop)
}

main().catch((e) => {
  console.error('Не удалось поднять dev-стек:', e.message)
  process.exit(1)
})
