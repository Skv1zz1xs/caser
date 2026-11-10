/** Помощник интеграционных тестов: свежая база на локальном Postgres + вызовы RPC от имени игрока. */
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { buildSeedSql } from '../../scripts/lib/seed'

const BASE = process.env.DEV_PG_URL ?? 'postgres://postgres:postgres@127.0.0.1:5432/postgres'
pg.types.setTypeParser(20, (v) => Number(v)) // bigint → number

export interface Db {
  admin: pg.Pool
  /** вызвать public.<fn> как пользователь uid */
  rpc<T = any>(uid: string, fn: string, args?: Record<string, unknown>): Promise<T>
  /** новая анонимная сессия + профиль */
  user(nick: string, pin?: string): Promise<{ uid: string; id: string }>
  /** выдать предмет игроку в обход рулетки */
  give(pid: string, caseId: string, idx: number, opts?: { fi?: number; st?: boolean; price?: number }): Promise<number>
  setBalance(pid: string, coins: number): Promise<void>
  balance(pid: string): Promise<number>
  close(): Promise<void>
}

export async function setupDb(): Promise<Db> {
  const name = 'zalet_t_' + randomUUID().slice(0, 8)
  const root = new pg.Client(BASE)
  await root.connect()
  await root.query('create database ' + name)
  await root.end()
  const url = new URL(BASE)
  url.pathname = '/' + name
  const admin = new pg.Pool({ connectionString: url.toString(), max: 6 })
  await admin.query(readFileSync('scripts/devstack/bootstrap.sql', 'utf8'))
  await admin.query(readFileSync('supabase/schema.sql', 'utf8'))
  await admin.query(buildSeedSql())

  const rpc = async (uid: string, fn: string, args: Record<string, unknown> = {}) => {
    const c = await admin.connect()
    try {
      await c.query('begin')
      await c.query('set local role authenticated')
      await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: uid, role: 'authenticated' })])
      const keys = Object.keys(args)
      const list = keys.map((k, i) => k + ' => $' + (i + 1)).join(', ')
      const res = await c.query('select public.' + fn + '(' + list + ') as r', keys.map((k) => args[k]))
      await c.query('commit')
      return res.rows[0].r
    } catch (e) {
      await c.query('rollback').catch(() => {})
      throw e
    } finally {
      c.release()
    }
  }

  return {
    admin,
    rpc,
    async user(nick, pin = '1234') {
      const uid = randomUUID()
      const r = await rpc(uid, 'login', { p_nick: nick, p_pin: pin, p_avatar: 1 })
      if (!r.ok) throw new Error(r.error)
      return { uid, id: r.me.id }
    },
    async give(pid, caseId, idx, opts = {}) {
      const o = (await admin.query('select * from cfg_outcomes where case_id = $1 and idx = $2', [caseId, idx])).rows[0]
      const fi = opts.fi ?? 5000
      const st = opts.st ?? false
      const price = opts.price ?? (await admin.query('select game.instance_price($1, $2, $3) p', [o.price, fi, st])).rows[0].p
      const r = await admin.query(
        'insert into items (owner, case_id, outcome_idx, item_id, phase, rarity, fi, st, price) values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id',
        [pid, caseId, idx, o.item_id, o.phase, o.rarity, fi, st, price],
      )
      return r.rows[0].id
    },
    async setBalance(pid, coins) {
      await admin.query('update profiles set balance = $2 where id = $1', [pid, Math.round(coins * 100)])
    },
    async balance(pid) {
      return (await admin.query('select balance from profiles where id = $1', [pid])).rows[0].balance
    },
    async close() {
      await admin.end()
      const r = new pg.Client(BASE)
      await r.connect()
      await r.query('drop database if exists ' + name + ' with (force)')
      await r.end()
    },
  }
}
