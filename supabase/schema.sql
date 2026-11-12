-- =====================================================================================
--  ЗАЛЁТ — схема базы: таблицы, права (RLS) и вся серверная логика.
--
--  Как применить: Supabase → SQL Editor → вставить файл целиком → Run.
--  Повторный запуск безопасен: данные игроков не трогает, только обновляет функции.
--  После схемы запусти supabase/seed.sql (кейсы и экономика; генерируется `npm run gen:sql`).
--
--  Правила:
--   * клиент ходит только в функции public.* (RPC); напрямую таблицы менять не может;
--   * публичные таблицы доступны на чтение, приватные закрыты совсем (RLS без политик);
--   * внутренние функции лежат в схеме game, которая наружу не выставлена;
--   * все суммы — в копейках (1 монета = 100).
-- =====================================================================================

create schema if not exists game;

-- Старые версии функций убираем, чтобы обновление не плодило перегрузки.
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'game'
       or (n.nspname = 'public' and p.proname = any (array[
         'login','logout','sync','get_inventory','open_case','sell_items','sell_below','chat_send',
         'fair_state','fair_rotate','fair_set_client_seed','fair_rolls','leaderboard','get_profile','set_avatar',
         'upgrade','contract','battle_create','battle_join','battle_add_bot','battle_leave','get_battle',
         'coinflip_create','coinflip_join','coinflip_bot','coinflip_cancel','crash_state','crash_bet','crash_cashout','raid_create','raid_contribute','raid_leave','raid_cancel','raid_list','get_raid','collection_get','collection_claim',
         'claim','bonus_free_case','bonus_daily','bonus_second_chance','promo_redeem','rain_join']))
  loop
    execute 'drop function if exists ' || r.sig || ' cascade';
  end loop;
end $$;

-- =====================================================================================
--  ТАБЛИЦЫ
-- =====================================================================================

-- ---------- публичные (читать может любой) ----------
create table if not exists public.profiles (
  id            uuid primary key default gen_random_uuid(),
  nick          text not null,
  nick_lower    text generated always as (lower(nick)) stored,
  avatar        int not null default 0,
  balance       bigint not null default 0 check (balance >= 0),
  xp            int not null default 0,
  stats         jsonb not null default '{}'::jsonb,   -- счётчики за всё время и рекорды
  best          jsonb not null default '[]'::jsonb,   -- витрина: лучшие дропы
  tickets       jsonb not null default '{}'::jsonb,   -- бесплатные открытия: {case_id: n}
  inv_rev       bigint not null default 0,            -- растёт при любом изменении инвентаря
  free_case_at  timestamptz,
  daily_at      timestamptz,
  daily_streak  int not null default 0,
  second_at     timestamptz,
  last_chat_at  timestamptz,
  last_seen     timestamptz not null default now(),
  created_at    timestamptz not null default now()
);
create unique index if not exists profiles_nick_lower_key on public.profiles (nick_lower);
create index if not exists profiles_balance_idx on public.profiles (balance desc);

create table if not exists public.feed (
  id          bigint generated always as identity primary key,
  profile_id  uuid,
  nick        text not null,
  avatar      int not null default 0,
  kind        text not null,            -- drop | upgrade | contract | battle | coinflip
  data        jsonb not null,
  created_at  timestamptz not null default now()
);

create table if not exists public.chat (
  id          bigint generated always as identity primary key,
  profile_id  uuid,
  nick        text not null,
  avatar      int not null default 0,
  level       int not null default 0,
  kind        text not null default 'msg',  -- msg | system
  body        text not null,
  created_at  timestamptz not null default now()
);

create table if not exists public.battles (
  id          uuid primary key default gen_random_uuid(),
  status      text not null default 'open',  -- open | done | cancelled
  mode        text not null,
  format      text not null,
  cases       text[] not null,
  cost        bigint not null,
  is_private  boolean not null default false,
  created_by  uuid not null,
  players     jsonb not null,                -- по месту: null | {slot, pid, nick, avatar, bot}
  seed_hash   text not null,
  started_at  timestamptz,
  ends_at     timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists battles_status_idx on public.battles (status, created_at desc);

create table if not exists public.coinflips (
  id              bigint generated always as identity primary key,
  status          text not null default 'open',  -- open | done | cancelled
  stake           bigint not null,
  creator         uuid not null,
  creator_nick    text not null,
  creator_avatar  int not null default 0,
  creator_side    int not null,                  -- 0 орёл, 1 решка
  joiner          uuid,
  joiner_nick     text,
  joiner_avatar   int,
  joiner_bot      boolean not null default false,
  seed_hash       text not null,
  result          int,
  winner          uuid,
  payout          bigint,
  server_seed     text,                          -- раскрывается после броска
  started_at      timestamptz,
  ends_at         timestamptz,
  created_at      timestamptz not null default now()
);
create index if not exists coinflips_status_idx on public.coinflips (status, created_at desc);

create table if not exists public.rain (
  id          bigint generated always as identity primary key,
  pot         bigint not null,
  starts_at   timestamptz not null default now(),
  ends_at     timestamptz not null,
  settled     boolean not null default false,
  joiners     int not null default 0,
  share       bigint not null default 0
);

-- ---------- приватные (клиенту недоступны) ----------
create table if not exists public.sessions (
  auth_id     uuid primary key,
  profile_id  uuid not null references public.profiles (id) on delete cascade,
  created_at  timestamptz not null default now()
);

create table if not exists public.auth_profiles (
  auth_id     uuid not null,
  profile_id  uuid not null references public.profiles (id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (auth_id, profile_id)
);

create table if not exists public.crash_rounds (
  id          bigint generated always as identity primary key,
  status      text not null default 'bet',    -- bet | run | done
  seed_id     bigint not null,
  seed_hash   text not null,
  crash_pm    int not null default 1000,      -- точка падения, промилле; клиенту не отдаётся, пока раунд не закончился
  bet_ends_at timestamptz not null,
  started_at  timestamptz,
  crashed_at  timestamptz,
  server_seed text,
  created_at  timestamptz not null default now()
);

create table if not exists public.crash_bets (
  round_id    bigint not null references public.crash_rounds (id) on delete cascade,
  profile_id  uuid not null references public.profiles (id) on delete cascade,
  amount      bigint not null,
  auto_pm     int,
  cash_pm     int,
  payout      bigint,
  primary key (round_id, profile_id)
);

create table if not exists public.raids (
  id          uuid primary key default gen_random_uuid(),
  status      text not null default 'open',   -- open | done | cancelled
  case_id     text not null,
  creator     uuid not null,
  target      bigint not null,
  pot         bigint not null default 0,
  seed_id     bigint not null,
  seed_hash   text not null,
  result      jsonb,
  payouts     jsonb,
  started_at  timestamptz,
  ends_at     timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists raids_status_idx on public.raids (status, created_at desc);

create table if not exists public.raid_shares (
  raid_id     uuid not null references public.raids (id) on delete cascade,
  profile_id  uuid not null references public.profiles (id) on delete cascade,
  amount      bigint not null,
  primary key (raid_id, profile_id)
);

create table if not exists public.collection (
  profile_id  uuid not null references public.profiles (id) on delete cascade,
  item_id     text not null,
  first_at    timestamptz not null default now(),
  primary key (profile_id, item_id)
);

create table if not exists public.seeds (
  id           bigint generated always as identity primary key,
  profile_id   uuid references public.profiles (id) on delete cascade,  -- null у сидов батлов и коинфлипов
  server_seed  text not null,
  hash         text not null,
  created_at   timestamptz not null default now(),
  revealed_at  timestamptz
);

create table if not exists public.secrets (
  profile_id    uuid primary key references public.profiles (id) on delete cascade,
  pin_hash      text not null,
  pin_salt      text not null,
  fails         int not null default 0,
  locked_until  timestamptz,
  seed_id       bigint not null references public.seeds (id),
  client_seed   text not null,
  nonce         bigint not null default 0
);

create table if not exists public.rolls (
  id           bigint generated always as identity primary key,
  profile_id   uuid not null references public.profiles (id) on delete cascade,
  kind         text not null,          -- case | upgrade | contract
  seed_id      bigint not null references public.seeds (id),
  client_seed  text not null,
  nonce        bigint not null,
  detail       jsonb not null,
  created_at   timestamptz not null default now()
);
create index if not exists rolls_profile_idx on public.rolls (profile_id, id desc);

create table if not exists public.items (
  id           bigint generated always as identity primary key,
  owner        uuid not null references public.profiles (id) on delete cascade,
  case_id      text not null,
  outcome_idx  int not null,
  item_id      text not null,
  phase        int not null default 0,
  rarity       int not null,
  fi           int not null,
  st           boolean not null default false,
  price        bigint not null,
  source       text not null default 'case',  -- case | free | upgrade | contract
  roll_id      bigint,
  created_at   timestamptz not null default now()
);
create index if not exists items_owner_idx on public.items (owner, price desc);

create table if not exists public.battle_results (
  battle_id  uuid primary key references public.battles (id) on delete cascade,
  seed_id    bigint not null references public.seeds (id),
  rounds     jsonb,
  summary    jsonb
);

create table if not exists public.pending_credits (
  id            bigint generated always as identity primary key,
  profile_id    uuid not null references public.profiles (id) on delete cascade,
  amount        bigint not null,
  available_at  timestamptz not null,
  reason        text,
  feed          jsonb
);
create index if not exists pending_profile_idx on public.pending_credits (profile_id, available_at);

create table if not exists public.counters (
  profile_id  uuid not null references public.profiles (id) on delete cascade,
  period      text not null,   -- d:2026-11-10 | w:2026-W46
  metric      text not null,
  value       bigint not null default 0,
  primary key (profile_id, period, metric)
);

create table if not exists public.claims (
  profile_id  uuid not null references public.profiles (id) on delete cascade,
  kind        text not null,   -- quest | ach | level | promo | find
  ref         text not null,
  created_at  timestamptz not null default now(),
  primary key (profile_id, kind, ref)
);

create table if not exists public.recipe_uses (
  profile_id  uuid not null references public.profiles (id) on delete cascade,
  recipe_id   text not null,
  used_at     timestamptz not null default now(),
  primary key (profile_id, recipe_id)
);

create table if not exists public.rain_joins (
  rain_id     bigint not null references public.rain (id) on delete cascade,
  profile_id  uuid not null references public.profiles (id) on delete cascade,
  primary key (rain_id, profile_id)
);

-- ---------- конфиг (заполняется из seed.sql) ----------
create table if not exists public.cfg_kv (
  key    text primary key,
  value  jsonb not null
);

create table if not exists public.cfg_cases (
  case_id       text primary key,
  ord           int not null,
  price         bigint not null,
  profile       text not null,
  contractable  boolean not null,
  name          text not null
);

create table if not exists public.cfg_outcomes (
  case_id       text not null,
  case_ord      int not null,
  idx           int not null,
  item_id       text not null,
  weapon        text not null,
  kind          text not null,
  phase         int not null,
  rarity        int not null,
  st_ok         boolean not null,
  cum           bigint not null,     -- верхняя граница диапазона билетов
  price         bigint not null,     -- базовая цена
  lo            bigint not null,     -- цена при худшем износе
  hi            bigint not null,     -- цена при лучшем износе
  contractable  boolean not null,
  primary key (case_id, idx)
);
create index if not exists cfg_outcomes_cum_idx on public.cfg_outcomes (case_id, cum);
create index if not exists cfg_outcomes_pool_idx on public.cfg_outcomes (rarity, lo, hi) where contractable;

-- =====================================================================================
--  ПРАВА: RLS на всём, публичное — только чтение
-- =====================================================================================
do $$
declare t text;
begin
  foreach t in array array['profiles','feed','chat','battles','coinflips','rain','sessions','auth_profiles','crash_rounds','crash_bets','raids','raid_shares','collection','seeds','secrets','rolls','items',
                           'battle_results','pending_credits','counters','claims','recipe_uses','rain_joins',
                           'cfg_kv','cfg_cases','cfg_outcomes']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
  foreach t in array array['profiles','feed','chat','battles','coinflips','rain']
  loop
    execute format('drop policy if exists "public read" on public.%I', t);
    execute format('create policy "public read" on public.%I for select using (true)', t);
    execute format('grant select on public.%I to anon, authenticated', t);
  end loop;
end $$;

revoke all on schema game from public, anon, authenticated;

-- Realtime: события этих таблиц «пинают» клиентов (сами данные клиент берёт через sync).
do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['feed','chat','battles','coinflips','rain']
    loop
      if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;

-- =====================================================================================
--  ВНУТРЕННИЕ ФУНКЦИИ (схема game)
-- =====================================================================================

create function game.cfg(p_key text) returns jsonb language sql stable as $$
  select value from public.cfg_kv where key = p_key
$$;

create function game.num(p_key text) returns bigint language sql stable as $$
  select (value ->> p_key)::bigint from public.cfg_kv where key = 'num'
$$;

create function game.ms(p_ts timestamptz) returns bigint language sql immutable as $$
  select (extract(epoch from p_ts) * 1000)::bigint
$$;

-- «Час залёта»: каждые 40 минут окно в 5 минут, когда весь опыт удваивается. Расписание считает сервер по now().
create function game.event_start() returns bigint language sql stable as $$
  select (extract(epoch from now())::bigint / 2400) * 2400
$$;
create function game.event_on() returns boolean language sql stable as $$
  select extract(epoch from now())::bigint - game.event_start() < 300
     and coalesce(current_setting('game.no_event', true), '') <> 'on'
$$;
create function game.xpm() returns int language sql stable as $$
  select case when game.event_on() then 2 else 1 end
$$;
create function game.event_view() returns jsonb language sql stable as $$
  select jsonb_build_object('on', game.event_on(), 'ends_at', (game.event_start() + 300) * 1000,
    'next_at', (game.event_start() + 2400) * 1000)
$$;

-- «Игровые сутки» и неделя (со сдвигом часового пояса из конфига).
create function game.day_key() returns text language sql stable as $$
  select 'd:' || to_char((now() at time zone 'utc') + make_interval(hours => game.num('tz_hours')::int), 'YYYY-MM-DD')
$$;
create function game.week_key() returns text language sql stable as $$
  select 'w:' || to_char((now() at time zone 'utc') + make_interval(hours => game.num('tz_hours')::int), 'IYYY-"W"IW')
$$;

-- Профиль текущего пользователя (по анонимной сессии Supabase).
create function game.pid() returns uuid language plpgsql stable as $$
declare v uuid;
begin
  select profile_id into v from public.sessions where auth_id = auth.uid();
  if v is null then raise exception 'Нужно войти в игру'; end if;
  return v;
end $$;

-- ---------- provably fair ----------
-- HMAC-SHA256 на чистом PL/pgSQL (без расширений). Ключ и сообщение — UTF-8 строки, результат — hex.
create function game.hmac_hex(p_key text, p_msg text) returns text language plpgsql immutable as $$
declare
  k bytea := convert_to(p_key, 'UTF8');
  ipad bytea := decode(repeat('36', 64), 'hex');
  opad bytea := decode(repeat('5c', 64), 'hex');
  i int;
begin
  if length(k) > 64 then k := sha256(k); end if;
  k := k || decode(repeat('00', 64 - length(k)), 'hex');
  for i in 0..63 loop
    ipad := set_byte(ipad, i, get_byte(k, i) # 54);
    opad := set_byte(opad, i, get_byte(k, i) # 92);
  end loop;
  return encode(sha256(opad || sha256(ipad || convert_to(p_msg, 'UTF8'))), 'hex');
end $$;

create function game.sha_hex(p_text text) returns text language sql immutable as $$
  select encode(sha256(convert_to(p_text, 'UTF8')), 'hex')
$$;

create function game.hex_int(p_hex text) returns bigint language sql immutable as $$
  select ('x' || lpad(p_hex, 16, '0'))::bit(64)::bigint
$$;

-- hex HMAC → числа ролла: n0 (52 бита), n1..n3 (по 32 бита).
create function game.roll_nums(p_hex text, out n0 bigint, out n1 bigint, out n2 bigint, out n3 bigint)
language sql immutable as $$
  select game.hex_int(substr(p_hex, 1, 13)), game.hex_int(substr(p_hex, 14, 8)),
         game.hex_int(substr(p_hex, 22, 8)), game.hex_int(substr(p_hex, 30, 8))
$$;

create function game.new_seed(p_pid uuid) returns bigint language plpgsql as $$
declare v_seed text; v_id bigint;
begin
  v_seed := encode(sha256(uuid_send(gen_random_uuid()) || uuid_send(gen_random_uuid()) || uuid_send(gen_random_uuid())), 'hex');
  insert into public.seeds (profile_id, server_seed, hash) values (p_pid, v_seed, game.sha_hex(v_seed)) returning id into v_id;
  return v_id;
end $$;

-- Следующий ролл игрока: nonce + 1, HMAC(server_seed, client_seed:nonce).
create function game.next_roll(p_pid uuid, out n0 bigint, out n1 bigint, out n2 bigint, out n3 bigint,
                               out sid bigint, out cseed text, out nnc bigint)
language plpgsql as $$
declare v_seed text; h text;
begin
  update public.secrets s set nonce = s.nonce + 1 where s.profile_id = p_pid
    returning s.seed_id, s.client_seed, s.nonce into sid, cseed, nnc;
  select sd.server_seed into v_seed from public.seeds sd where sd.id = sid;
  h := game.hmac_hex(v_seed, cseed || ':' || nnc);
  select r.n0, r.n1, r.n2, r.n3 into n0, n1, n2, n3 from game.roll_nums(h) r;
end $$;

-- ---------- цены и исходы ----------
create function game.instance_price(p_base bigint, p_fi int, p_st boolean) returns bigint language plpgsql stable as $$
declare v bigint;
begin
  v := p_base * (game.num('wear_a') - game.num('wear_b') * p_fi) / 100000;
  if p_st then v := v * game.num('st_pm') / 1000; end if;
  return v;
end $$;

create function game.wear_idx(p_fi int) returns int language sql stable as $$
  select coalesce(min(ord)::int - 1, 4)
  from jsonb_array_elements_text(game.cfg('wear_max')) with ordinality t(x, ord)
  where p_fi < x::int
$$;

-- Числа ролла → дроп из кейса. Зеркало src/shared/roll.ts (rollDrop).
create function game.roll_drop(p_case text, p_n0 bigint, p_n1 bigint, p_n2 bigint,
                               out outcome_idx int, out item_id text, out phase int, out rarity int,
                               out fi int, out st boolean, out price bigint)
language plpgsql stable as $$
declare o record;
begin
  select c.idx, c.item_id, c.phase, c.rarity, c.st_ok, c.price into o
  from public.cfg_outcomes c
  where c.case_id = p_case and c.cum > p_n0 % 1000000000
  order by c.cum limit 1;
  if not found then raise exception 'Нет такого кейса: %', p_case; end if;
  outcome_idx := o.idx; item_id := o.item_id; phase := o.phase; rarity := o.rarity;
  fi := (p_n1 % game.num('fi_range'))::int;
  st := o.st_ok and (p_n2 % game.num('fi_range')) < game.num('st_limit');
  price := game.instance_price(o.price, fi, st);
end $$;

-- ---------- учёт ----------
-- Прибавляет счётчики (за всё время + день + неделя) и обновляет рекорды.
create function game.bump(p_pid uuid, p_add jsonb, p_max jsonb default '{}'::jsonb) returns void language plpgsql as $$
declare v_stats jsonb; k text; v text; dk text := game.day_key(); wk text := game.week_key();
begin
  select stats into v_stats from public.profiles where id = p_pid;
  for k, v in select e.key, e.value from jsonb_each_text(p_add) e loop
    if v::bigint <> 0 then
      v_stats := jsonb_set(v_stats, array[k], to_jsonb(coalesce((v_stats ->> k)::bigint, 0) + v::bigint));
    end if;
  end loop;
  for k, v in select e.key, e.value from jsonb_each_text(p_max) e loop
    if v::bigint > coalesce((v_stats ->> k)::bigint, 0) then
      v_stats := jsonb_set(v_stats, array[k], to_jsonb(v::bigint));
    end if;
  end loop;
  update public.profiles set stats = v_stats where id = p_pid;
  insert into public.counters (profile_id, period, metric, value)
    select p_pid, per, e.key, e.value::bigint
    from jsonb_each_text(p_add) e cross join unnest(array[dk, wk]) per
    where e.value::bigint <> 0
  on conflict (profile_id, period, metric) do update set value = public.counters.value + excluded.value;
end $$;

create function game.add_feed(p_pid uuid, p_kind text, p_data jsonb) returns void language plpgsql as $$
declare v_id bigint;
begin
  insert into public.feed (profile_id, nick, avatar, kind, data)
    select p.id, p.nick, p.avatar, p_kind, p_data from public.profiles p where p.id = p_pid
    returning id into v_id;
  if v_id % 50 = 0 then delete from public.feed where id < v_id - 300; end if;
end $$;

create function game.add_chat(p_pid uuid, p_kind text, p_body text) returns void language plpgsql as $$
declare v_id bigint;
begin
  if p_pid is null then
    insert into public.chat (nick, kind, body) values ('ЗАЛЁТ', p_kind, p_body) returning id into v_id;
  else
    insert into public.chat (profile_id, nick, avatar, level, kind, body)
      select p.id, p.nick, p.avatar, game.level_of(p.xp), p_kind, p_body from public.profiles p where p.id = p_pid
      returning id into v_id;
  end if;
  if v_id % 50 = 0 then delete from public.chat where id < v_id - 300; end if;
end $$;

-- Уровень батл-пасса по XP. Зеркало src/shared/progress.ts.
create function game.level_of(p_xp int) returns int language plpgsql stable as $$
declare c jsonb := game.cfg('pass'); v_base int := (c ->> 'base')::int; v_step int := (c ->> 'step')::int;
  v_max int := jsonb_array_length(c -> 'rewards'); v_lvl int := 0; v_rest int := p_xp;
begin
  while v_lvl < v_max and v_rest >= v_base + v_step * v_lvl loop
    v_rest := v_rest - (v_base + v_step * v_lvl);
    v_lvl := v_lvl + 1;
  end loop;
  return v_lvl;
end $$;

-- Зачисляет «созревшие» выплаты (батлы, коинфлипы) и публикует их в ленту.
create function game.settle(p_pid uuid) returns void language plpgsql as $$
declare r record; v_sum bigint := 0;
begin
  for r in delete from public.pending_credits where profile_id = p_pid and available_at <= now() returning amount, feed loop
    v_sum := v_sum + r.amount;
    if r.feed is not null then perform game.add_feed(p_pid, r.feed ->> 'kind', r.feed -> 'data'); end if;
  end loop;
  if v_sum > 0 then update public.profiles set balance = balance + v_sum where id = p_pid; end if;
end $$;

-- Блокирует профиль на время операции (защита от двойных кликов и гонок) и возвращает его.
create function game.lock(p_pid uuid) returns public.profiles language plpgsql as $$
declare p public.profiles;
begin
  perform 1 from public.profiles where id = p_pid for update;
  perform game.settle(p_pid);
  select * into p from public.profiles where id = p_pid;
  return p;
end $$;

create function game.item_json(i public.items) returns jsonb language sql stable as $$
  select jsonb_build_object('id', i.id, 'case', i.case_id, 'idx', i.outcome_idx, 'item', i.item_id, 'phase', i.phase,
    'rarity', i.rarity, 'fi', i.fi, 'st', i.st, 'price', i.price, 'src', i.source, 'at', game.ms(i.created_at))
$$;

-- Добавляет дроп в витрину лучших (топ-8 по цене).
create function game.note_best(p_pid uuid, p_item jsonb) returns void language plpgsql as $$
declare v_best jsonb; v_min bigint;
begin
  select best into v_best from public.profiles where id = p_pid;
  select min((x ->> 'price')::bigint) into v_min from jsonb_array_elements(v_best) x;
  if jsonb_array_length(v_best) >= 8 and (p_item ->> 'price')::bigint <= v_min then return; end if;
  update public.profiles set best = (
    select jsonb_agg(x order by (x ->> 'price')::bigint desc)
    from (select x from jsonb_array_elements(v_best || jsonb_build_array(p_item)) x order by (x ->> 'price')::bigint desc limit 8) t
  ) where id = p_pid;
end $$;

-- Полное состояние игрока для клиента.
create function game.me(p_pid uuid) returns jsonb language plpgsql as $$
declare p public.profiles; s record; dk text := game.day_key(); wk text := game.week_key();
begin
  select * into p from public.profiles where id = p_pid;
  select sc.client_seed, sc.nonce, sd.hash, sd.id into s
  from public.secrets sc join public.seeds sd on sd.id = sc.seed_id where sc.profile_id = p_pid;
  return jsonb_build_object(
    'id', p.id, 'nick', p.nick, 'avatar', p.avatar, 'balance', p.balance, 'xp', p.xp, 'level', game.level_of(p.xp),
    'stats', p.stats, 'best', p.best, 'tickets', p.tickets, 'inv_rev', p.inv_rev,
    'inv_count', (select count(*) from public.items where owner = p_pid),
    'inv_value', (select coalesce(sum(price), 0) from public.items where owner = p_pid),
    'pending', (select coalesce(sum(amount), 0) from public.pending_credits where profile_id = p_pid),
    'free_case_at', game.ms(p.free_case_at), 'daily_at', game.ms(p.daily_at), 'daily_streak', p.daily_streak,
    'second_at', game.ms(p.second_at), 'day', dk, 'week', wk,
    'counters', jsonb_build_object(
      'day', (select coalesce(jsonb_object_agg(metric, value), '{}'::jsonb) from public.counters where profile_id = p_pid and period = dk),
      'week', (select coalesce(jsonb_object_agg(metric, value), '{}'::jsonb) from public.counters where profile_id = p_pid and period = wk)),
    'claims', (select coalesce(jsonb_agg(kind || ':' || ref), '[]'::jsonb) from public.claims
               where profile_id = p_pid and (kind <> 'quest' or ref like '%|' || dk or ref like '%|' || wk)),
    'fair', jsonb_build_object('hash', s.hash, 'client_seed', s.client_seed, 'nonce', s.nonce, 'seed_id', s.id)
  );
end $$;

-- Хвост любой операции: обновляет пик баланса и «последний визит», возвращает состояние.
create function game.after(p_pid uuid) returns jsonb language plpgsql as $$
begin
  update public.profiles
    set stats = jsonb_set(stats, '{peak}', to_jsonb(greatest(coalesce((stats ->> 'peak')::bigint, 0), balance))),
        last_seen = now()
    where id = p_pid
      and (coalesce((stats ->> 'peak')::bigint, 0) < balance or last_seen < now() - interval '15 seconds');
  return game.me(p_pid);
end $$;

-- Один дроп из кейса: ролл, запись в журнал честности, предмет в инвентарь.
create function game.case_drop(p_pid uuid, p_case text, p_source text) returns jsonb language plpgsql as $$
declare r record; d record; v_roll bigint; i public.items;
begin
  select * into r from game.next_roll(p_pid);
  select * into d from game.roll_drop(p_case, r.n0, r.n1, r.n2);
  insert into public.rolls (profile_id, kind, seed_id, client_seed, nonce, detail)
    values (p_pid, 'case', r.sid, r.cseed, r.nnc, jsonb_build_object('case', p_case, 'ticket', r.n0 % 1000000000,
      'idx', d.outcome_idx, 'item', d.item_id, 'phase', d.phase, 'fi', d.fi, 'st', d.st, 'price', d.price))
    returning id into v_roll;
  insert into public.items (owner, case_id, outcome_idx, item_id, phase, rarity, fi, st, price, source, roll_id)
    values (p_pid, p_case, d.outcome_idx, d.item_id, d.phase, d.rarity, d.fi, d.st, d.price, p_source, v_roll)
    returning * into i;
  return game.item_json(i) || jsonb_build_object('roll', v_roll, 'nonce', r.nnc);
end $$;

-- Пачка дропов + вся статистика/лента по ним. Возвращает массив предметов.
create function game.drop_batch(p_pid uuid, p_case text, p_case_price bigint, p_count int, p_source text) returns jsonb
language plpgsql as $$
declare
  v_drops jsonb := '[]'::jsonb; d jsonb; i int; v_price bigint; v_mult bigint;
  v_best_mult bigint := 0; v_best_drop bigint := 0; v_earn bigint := 0;
  v_x10 int := 0; v_sp int := 0; v_gem int := 0; v_nova int := 0; v_con int := 0;
begin
  for i in 1..p_count loop
    d := game.case_drop(p_pid, p_case, p_source);
    v_price := (d ->> 'price')::bigint;
    v_mult := case when p_case_price > 0 then v_price * 100 / p_case_price else 0 end;
    v_earn := v_earn + v_price;
    v_best_mult := greatest(v_best_mult, v_mult);
    v_best_drop := greatest(v_best_drop, v_price);
    if v_mult >= 1000 then v_x10 := v_x10 + 1; end if;
    if (d ->> 'rarity')::int = 6 then v_sp := v_sp + 1; end if;
    if (d ->> 'rarity')::int = 7 then v_con := v_con + 1; end if;
    if (d ->> 'phase')::int = 2 then v_gem := v_gem + 1; end if;
    if (d ->> 'phase')::int = 3 then v_nova := v_nova + 1; end if;
    d := d || jsonb_build_object('x', v_mult);
    if (d ->> 'rarity')::int >= 2 or (p_case_price > 0 and v_price >= p_case_price) then
      perform game.add_feed(p_pid, 'drop', d - 'roll' - 'nonce' - 'id');
    end if;
    if (d ->> 'rarity')::int >= 3 or v_mult >= 300 then perform game.note_best(p_pid, d - 'roll' - 'nonce'); end if;
    if v_mult >= 5000 or (d ->> 'phase')::int >= 3 then
      perform game.add_chat(null, 'system', (select nick from public.profiles where id = p_pid) || ' выбил ультра дроп на ' || (v_price / 100) || ' монет');
    end if;
    v_drops := v_drops || d;
  end loop;
  perform game.bump(p_pid,
    jsonb_build_object('opened', p_count, 'earned', v_earn, 'x10', v_x10, 'specials', v_sp, 'gems', v_gem, 'novas', v_nova, 'contrabands', v_con),
    jsonb_build_object('best_mult', v_best_mult, 'best_drop', v_best_drop));
  update public.profiles
    set xp = xp + ((game.cfg('pass') #>> '{xp,open}')::int * game.xpm()) * p_count, inv_rev = inv_rev + 1
    where id = p_pid;
  return v_drops;
end $$;

-- =====================================================================================
--  ПУБЛИЧНЫЙ API (RPC). Всё — SECURITY DEFINER: права проверяются внутри функции.
-- =====================================================================================

-- ---------- вход ----------
-- Ник свободен → создаём профиль. Ник занят → нужен PIN (вход с другого устройства).
create function public.login(p_nick text, p_pin text, p_avatar int default 0) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, game, pg_temp as $$
declare
  v_uid uuid := auth.uid(); v_nick text := btrim(coalesce(p_nick, '')); v_pin text := coalesce(p_pin, '');
  p public.profiles; s public.secrets; v_seed bigint; v_salt text; v_created boolean := false;
begin
  if v_uid is null then raise exception 'Нет сессии — обнови страницу'; end if;
  if game.cfg('version') is null then raise exception 'Сервер не настроен: выполни supabase/seed.sql'; end if;
  if char_length(v_nick) < game.num('nick_min') or char_length(v_nick) > game.num('nick_max') then
    return jsonb_build_object('ok', false, 'error', format('Ник — от %s до %s символов', game.num('nick_min'), game.num('nick_max')));
  end if;
  if v_nick !~ '^[A-Za-zА-Яа-яЁё0-9_. -]+$' then
    return jsonb_build_object('ok', false, 'error', 'В нике можно буквы, цифры, пробел, точку, _ и -');
  end if;
  if char_length(v_pin) < game.num('pin_min') or char_length(v_pin) > 32 then
    return jsonb_build_object('ok', false, 'error', format('PIN — от %s символов', game.num('pin_min')));
  end if;

  select * into p from profiles where nick_lower = lower(v_nick);
  if found then
    select * into s from secrets where profile_id = p.id for update;
    if s.locked_until is not null and s.locked_until > now() then
      return jsonb_build_object('ok', false, 'error', 'Слишком много попыток. Попробуй через 10 минут');
    end if;
    if s.pin_hash <> game.sha_hex(s.pin_salt || v_pin) then
      update secrets set fails = case when fails + 1 >= 5 then 0 else fails + 1 end,
                         locked_until = case when fails + 1 >= 5 then now() + interval '10 minutes' else null end
        where profile_id = p.id;
      return jsonb_build_object('ok', false, 'error', 'Ник занят, а PIN не подходит');
    end if;
    update secrets set fails = 0, locked_until = null where profile_id = p.id;
  else
    if (select count(*) from auth_profiles where auth_id = v_uid) >= 3 then
      return jsonb_build_object('ok', false, 'error', 'С этого устройства уже создано три профиля. Войди в один из них по нику и PIN');
    end if;
    insert into profiles (nick, avatar, balance)
      values (v_nick, greatest(0, least(coalesce(p_avatar, 0), game.num('avatars')::int - 1)), (game.cfg('bonus') ->> 'start')::bigint)
      returning * into p;
    insert into auth_profiles (auth_id, profile_id) values (v_uid, p.id);
    v_seed := game.new_seed(p.id);
    v_salt := encode(sha256(uuid_send(gen_random_uuid())), 'hex');
    insert into secrets (profile_id, pin_hash, pin_salt, seed_id, client_seed)
      values (p.id, game.sha_hex(v_salt || v_pin), v_salt, v_seed, substr(encode(sha256(uuid_send(gen_random_uuid())), 'hex'), 1, 16));
    perform game.add_chat(null, 'system', v_nick || ' залетает в игру');
    v_created := true;
  end if;
  insert into sessions (auth_id, profile_id) values (v_uid, p.id)
    on conflict (auth_id) do update set profile_id = excluded.profile_id;
  return jsonb_build_object('ok', true, 'created', v_created, 'me', game.after(p.id));
end $$;

create function public.logout() returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, game, pg_temp as $$
begin
  delete from sessions where auth_id = auth.uid();
  return jsonb_build_object('ok', true);
end $$;

create function public.set_avatar(p_avatar int) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, game, pg_temp as $$
declare v_pid uuid := game.pid();
begin
  update profiles set avatar = greatest(0, least(coalesce(p_avatar, 0), game.num('avatars')::int - 1)) where id = v_pid;
  return jsonb_build_object('me', game.after(v_pid));
end $$;

-- ---------- синхронизация ----------
-- Один запрос на всё «живое»: состояние игрока, новый чат, новая лента, батлы, коинфлипы, дождь.
create function public.sync(p_chat_after bigint default 0, p_feed_after bigint default 0) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, game, pg_temp as $$
declare v_pid uuid; v_chat jsonb; v_feed jsonb;
begin
  select profile_id into v_pid from sessions where auth_id = auth.uid();
  if v_pid is null then
    return jsonb_build_object('me', null, 'version', game.cfg('version'), 'now', game.ms(now()));
  end if;
  perform game.settle(v_pid);
  perform game.rain_tick();

  select coalesce(jsonb_agg(x order by id), '[]'::jsonb) into v_chat from (
    select c.id, jsonb_build_object('id', c.id, 'pid', c.profile_id, 'nick', c.nick, 'avatar', c.avatar, 'level', c.level,
      'kind', c.kind, 'body', c.body, 'at', game.ms(c.created_at)) x
    from chat c where c.id > coalesce(p_chat_after, 0) order by c.id desc limit 80) t;

  select coalesce(jsonb_agg(x order by id), '[]'::jsonb) into v_feed from (
    select f.id, jsonb_build_object('id', f.id, 'pid', f.profile_id, 'nick', f.nick, 'avatar', f.avatar,
      'kind', f.kind, 'data', f.data, 'at', game.ms(f.created_at)) x
    from feed f where f.id > coalesce(p_feed_after, 0) order by f.id desc limit 40) t;

  return jsonb_build_object(
    'now', game.ms(now()), 'version', game.cfg('version'), 'me', game.after(v_pid),
    'chat', v_chat, 'feed', v_feed,
    'battles', game.battle_list(v_pid), 'coinflips', game.coinflip_list(), 'rain', game.rain_view(v_pid), 'event', game.event_view(),
    'online', (select count(*) from profiles where last_seen > now() - interval '40 seconds'));
end $$;

-- ---------- инвентарь ----------
create function public.get_inventory() returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, game, pg_temp as $$
declare v_pid uuid := game.pid();
begin
  return jsonb_build_object(
    'rev', (select inv_rev from profiles where id = v_pid),
    'items', (select coalesce(jsonb_agg(game.item_json(i) order by i.price desc, i.id desc), '[]'::jsonb) from items i where i.owner = v_pid));
end $$;

-- ---------- открытие кейса ----------
create function public.open_case(p_case text, p_count int default 1, p_ticket boolean default false) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, game, pg_temp as $$
declare v_pid uuid := game.pid(); c public.cfg_cases; p public.profiles; v_cost bigint := 0; v_tk int; v_drops jsonb;
begin
  select * into c from cfg_cases where case_id = p_case;
  if not found then raise exception 'Нет такого кейса'; end if;
  if c.profile = 'free' then raise exception 'Этот кейс открывается через бонусы'; end if;
  if p_count is null or p_count < 1 or p_count > game.num('open_max') then
    raise exception 'Можно открыть от 1 до % кейсов за раз', game.num('open_max');
  end if;
  p := game.lock(v_pid);
  if (select count(*) from items where owner = v_pid) + p_count > game.num('inv_limit') then
    raise exception 'Инвентарь переполнен — продай лишнее';
  end if;
  if coalesce(p_ticket, false) then
    v_tk := coalesce((p.tickets ->> p_case)::int, 0);
    if v_tk < p_count then raise exception 'Не хватает бесплатных открытий этого кейса'; end if;
    update profiles
      set tickets = case when v_tk - p_count > 0 then jsonb_set(tickets, array[p_case], to_jsonb(v_tk - p_count)) else tickets - p_case end
      where id = v_pid;
  else
    v_cost := c.price * p_count;
    if p.balance < v_cost then raise exception 'Недостаточно монет'; end if;
    update profiles set balance = balance - v_cost where id = v_pid;
  end if;
  v_drops := game.drop_batch(v_pid, p_case, c.price, p_count, 'case');
  if v_cost > 0 then perform game.bump(v_pid, jsonb_build_object('spent', v_cost)); end if;
  return jsonb_build_object('drops', v_drops, 'cost', v_cost, 'me', game.after(v_pid));
end $$;

-- ---------- продажа ----------
create function public.sell_items(p_ids bigint[]) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, game, pg_temp as $$
declare v_pid uuid := game.pid(); v_ids bigint[]; v_n int; v_sum bigint;
begin
  v_ids := array(select distinct x from unnest(coalesce(p_ids, '{}'::bigint[])) x);
  if cardinality(v_ids) = 0 then raise exception 'Нечего продавать'; end if;
  if cardinality(v_ids) > 3000 then raise exception 'Слишком много предметов за раз'; end if;
  perform game.lock(v_pid);
  with del as (delete from items where owner = v_pid and id = any (v_ids) returning price)
  select count(*), coalesce(sum(price), 0) into v_n, v_sum from del;
  if v_n <> cardinality(v_ids) then raise exception 'Каких-то предметов уже нет в инвентаре'; end if;
  update profiles set balance = balance + v_sum, inv_rev = inv_rev + 1 where id = v_pid;
  perform game.bump(v_pid, jsonb_build_object('sold', v_n, 'sold_value', v_sum));
  return jsonb_build_object('sold', v_n, 'amount', v_sum, 'removed', to_jsonb(v_ids), 'me', game.after(v_pid));
end $$;

-- Продать всё не дороже p_max_price (для «продать всё» передаётся очень большое число).
create function public.sell_below(p_max_price bigint) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, game, pg_temp as $$
declare v_pid uuid := game.pid(); v_ids bigint[]; v_sum bigint;
begin
  perform game.lock(v_pid);
  with del as (delete from items where owner = v_pid and price <= coalesce(p_max_price, 0) returning id, price)
  select coalesce(array_agg(id), '{}'::bigint[]), coalesce(sum(price), 0) into v_ids, v_sum from del;
  if cardinality(v_ids) > 0 then
    update profiles set balance = balance + v_sum, inv_rev = inv_rev + 1 where id = v_pid;
    perform game.bump(v_pid, jsonb_build_object('sold', cardinality(v_ids), 'sold_value', v_sum));
  end if;
  return jsonb_build_object('sold', cardinality(v_ids), 'amount', v_sum, 'removed', to_jsonb(v_ids), 'me', game.after(v_pid));
end $$;

-- ---------- чат ----------
create function public.chat_send(p_text text) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, game, pg_temp as $$
declare v_pid uuid := game.pid(); v_text text := btrim(regexp_replace(coalesce(p_text, ''), '\s+', ' ', 'g')); p public.profiles;
begin
  if v_text = '' then raise exception 'Пустое сообщение'; end if;
  if char_length(v_text) > game.num('chat_len') then raise exception 'Слишком длинное сообщение'; end if;
  select * into p from profiles where id = v_pid for update;
  if p.last_chat_at is not null and p.last_chat_at > now() - interval '1 second' then raise exception 'Не так быстро'; end if;
  update profiles set last_chat_at = now() where id = v_pid;
  perform game.add_chat(v_pid, 'msg', v_text);
  perform game.bump(v_pid, jsonb_build_object('chat', 1));
  return jsonb_build_object('ok', true);
end $$;

-- ---------- честность ----------
create function public.fair_state() returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, game, pg_temp as $$
declare v_pid uuid := game.pid();
begin
  return game.me(v_pid) -> 'fair';
end $$;

create function public.fair_set_client_seed(p_seed text) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, game, pg_temp as $$
declare v_pid uuid := game.pid(); v_seed text := btrim(coalesce(p_seed, ''));
begin
  if char_length(v_seed) < 1 or char_length(v_seed) > 64 then raise exception 'Client seed — от 1 до 64 символов'; end if;
  if v_seed ~ '[:\s]' then raise exception 'В client seed нельзя двоеточие и пробелы'; end if;
  update secrets set client_seed = v_seed where profile_id = v_pid;
  return game.me(v_pid) -> 'fair';
end $$;

-- Раскрывает текущий server seed и выдаёт новый (nonce обнуляется).
create function public.fair_rotate() returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, game, pg_temp as $$
declare v_pid uuid := game.pid(); v_old bigint; v_new bigint; v_seed text; v_hash text;
begin
  perform game.lock(v_pid);
  select seed_id into v_old from secrets where profile_id = v_pid for update;
  update seeds set revealed_at = now() where id = v_old returning server_seed, hash into v_seed, v_hash;
  v_new := game.new_seed(v_pid);
  update secrets set seed_id = v_new, nonce = 0 where profile_id = v_pid;
  return jsonb_build_object('revealed', jsonb_build_object('seed_id', v_old, 'server_seed', v_seed, 'hash', v_hash),
                            'fair', game.me(v_pid) -> 'fair');
end $$;

-- Журнал роллов игрока. server_seed виден только у раскрытых сидов.
create function public.fair_rolls(p_before bigint default null, p_limit int default 30) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, game, pg_temp as $$
declare v_pid uuid := game.pid();
begin
  return (select coalesce(jsonb_agg(x order by id desc), '[]'::jsonb) from (
    select r.id, jsonb_build_object('id', r.id, 'kind', r.kind, 'nonce', r.nonce, 'client_seed', r.client_seed,
      'seed_id', r.seed_id, 'hash', s.hash, 'server_seed', case when s.revealed_at is not null then s.server_seed end,
      'detail', r.detail, 'at', game.ms(r.created_at)) x
    from rolls r join seeds s on s.id = r.seed_id
    where r.profile_id = v_pid and (p_before is null or r.id < p_before)
    order by r.id desc limit greatest(1, least(coalesce(p_limit, 30), 100))) t);
end $$;

-- ---------- лидерборд и профили ----------
create function public.leaderboard() returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, game, pg_temp as $$
begin
  perform game.pid();
  return jsonb_build_object(
    'balance', (select coalesce(jsonb_agg(x order by v desc), '[]'::jsonb) from (
      select p.balance + coalesce(i.v, 0) v, jsonb_build_object('nick', p.nick, 'avatar', p.avatar, 'level', game.level_of(p.xp),
        'value', p.balance + coalesce(i.v, 0), 'balance', p.balance) x
      from profiles p left join (select owner, sum(price) v from items group by owner) i on i.owner = p.id
      order by 1 desc limit 50) t),
    'best', (select coalesce(jsonb_agg(x order by v desc), '[]'::jsonb) from (
      select (p.stats ->> 'best_drop')::bigint v, jsonb_build_object('nick', p.nick, 'avatar', p.avatar, 'level', game.level_of(p.xp),
        'value', (p.stats ->> 'best_drop')::bigint, 'item', p.best -> 0) x
      from profiles p where coalesce((p.stats ->> 'best_drop')::bigint, 0) > 0 order by 1 desc limit 50) t),
    'tonight', (select coalesce(jsonb_agg(x order by v desc), '[]'::jsonb) from (
      select (f.data ->> 'price')::bigint v, jsonb_build_object('nick', f.nick, 'avatar', f.avatar, 'kind', f.kind, 'data', f.data, 'at', game.ms(f.created_at)) x
      from feed f where f.kind in ('drop', 'upgrade', 'contract') and f.created_at > now() - interval '12 hours'
      order by 1 desc limit 20) t),
    'battles', (select coalesce(jsonb_agg(x order by v desc), '[]'::jsonb) from (
      select (p.stats ->> 'battle_winnings')::bigint v, jsonb_build_object('nick', p.nick, 'avatar', p.avatar, 'level', game.level_of(p.xp),
        'value', (p.stats ->> 'battle_winnings')::bigint, 'wins', coalesce((p.stats ->> 'battle_wins')::bigint, 0)) x
      from profiles p where coalesce((p.stats ->> 'battle_winnings')::bigint, 0) > 0 order by 1 desc limit 50) t));
end $$;

create function public.get_profile(p_nick text) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, game, pg_temp as $$
declare p public.profiles;
begin
  perform game.pid();
  select * into p from profiles where nick_lower = lower(btrim(coalesce(p_nick, '')));
  if not found then raise exception 'Игрок не найден'; end if;
  return jsonb_build_object('id', p.id, 'nick', p.nick, 'avatar', p.avatar, 'xp', p.xp, 'level', game.level_of(p.xp),
    'balance', p.balance, 'stats', p.stats, 'best', p.best,
    'inv_count', (select count(*) from items where owner = p.id),
    'inv_value', (select coalesce(sum(price), 0) from items where owner = p.id),
    'ach', (select coalesce(jsonb_agg(ref), '[]'::jsonb) from claims where profile_id = p.id and kind = 'ach'),
    'online', p.last_seen > now() - interval '40 seconds', 'created_at', game.ms(p.created_at));
end $$;

-- =====================================================================================
--  АПГРЕЙДЕР
-- =====================================================================================
-- шанс (ppm) = (предметы + монеты) × edge / цена цели; допустим только коридор из конфига.
create function public.upgrade(p_ids bigint[], p_coins bigint, p_case text, p_idx int) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, game, pg_temp as $$
declare
  v_pid uuid := game.pid(); p public.profiles; t record; v_ids bigint[]; v_n int; v_in bigint;
  v_coins bigint := greatest(coalesce(p_coins, 0), 0); v_total bigint; v_target bigint; v_ppm bigint;
  r record; v_roll bigint; v_win boolean; i public.items; v_item jsonb := null; v_roll_id bigint;
begin
  v_ids := array(select distinct x from unnest(coalesce(p_ids, '{}'::bigint[])) x);
  if cardinality(v_ids) > game.num('up_max_items') then raise exception 'Максимум % предметов', game.num('up_max_items'); end if;
  p := game.lock(v_pid);
  select count(*), coalesce(sum(price), 0) into v_n, v_in from items where owner = v_pid and id = any (v_ids);
  if v_n <> cardinality(v_ids) then raise exception 'Каких-то предметов уже нет в инвентаре'; end if;
  if v_coins > p.balance then raise exception 'Недостаточно монет'; end if;
  v_total := v_in + v_coins;
  if v_total <= 0 then raise exception 'Положи предметы или монеты'; end if;

  select o.item_id, o.phase, o.rarity, o.price, c.profile into t
  from cfg_outcomes o join cfg_cases c on c.case_id = o.case_id where o.case_id = p_case and o.idx = p_idx;
  if not found or t.profile = 'free' then raise exception 'Нет такой цели'; end if;
  v_target := game.instance_price(t.price, (game.num('fi_range') / 2)::int, false);
  v_ppm := v_total * game.num('up_edge') / v_target;
  if v_ppm < game.num('up_min') or v_ppm > game.num('up_max') then
    raise exception 'Шанс должен быть от % до % процентов', game.num('up_min') / 10000, game.num('up_max') / 10000;
  end if;

  select * into r from game.next_roll(v_pid);
  v_roll := r.n0 % 1000000;
  v_win := v_roll < v_ppm;

  delete from items where owner = v_pid and id = any (v_ids);
  update profiles set balance = balance - v_coins, inv_rev = inv_rev + 1,
                      xp = xp + ((game.cfg('pass') #>> '{xp,upgrade}')::int * game.xpm()) where id = v_pid;
  insert into rolls (profile_id, kind, seed_id, client_seed, nonce, detail)
    values (v_pid, 'upgrade', r.sid, r.cseed, r.nnc, jsonb_build_object('input', v_in, 'coins', v_coins, 'case', p_case, 'idx', p_idx,
      'item', t.item_id, 'target', v_target, 'ppm', v_ppm, 'roll', v_roll, 'win', v_win))
    returning id into v_roll_id;
  if v_win then
    insert into items (owner, case_id, outcome_idx, item_id, phase, rarity, fi, st, price, source, roll_id)
      values (v_pid, p_case, p_idx, t.item_id, t.phase, t.rarity, (game.num('fi_range') / 2)::int, false, v_target, 'upgrade', v_roll_id)
      returning * into i;
    v_item := game.item_json(i);
    perform game.add_feed(v_pid, 'upgrade', (v_item - 'id') || jsonb_build_object('ppm', v_ppm, 'from', v_total));
  end if;
  perform game.bump(v_pid, jsonb_build_object('upgrades', 1, 'upgrade_wins', v_win::int, 'lucky_ups', (v_win and v_ppm <= 50000)::int));
  return jsonb_build_object('win', v_win, 'roll', v_roll, 'ppm', v_ppm, 'target', v_target, 'item', v_item,
    'removed', to_jsonb(v_ids), 'nonce', r.nnc, 'me', game.after(v_pid));
end $$;

-- =====================================================================================
--  КОНТРАКТЫ
-- =====================================================================================
-- Множитель контракта в промилле. Зеркало src/shared/contract.ts (contractMult).
create function game.contract_mult(p_n0 bigint, p_n1 bigint) returns bigint language plpgsql stable as $$
declare b jsonb; t bigint := p_n0 % 1000000;
begin
  for b in select x from jsonb_array_elements(game.cfg('contract') -> 'buckets') with ordinality q(x, ord) order by ord loop
    if t < (b ->> 'cum')::bigint then
      return (b ->> 'from')::bigint + ((b ->> 'to')::bigint - (b ->> 'from')::bigint) * (p_n1 % 10000) / 10000;
    end if;
  end loop;
  raise exception 'Конфиг контрактов повреждён';
end $$;

-- Подбор предмета нужной редкости под цену. Зеркало contractResult.
create function game.contract_pick(p_value bigint, p_rarity int, p_n2 bigint,
                                   out case_id text, out idx int, out item_id text, out phase int, out fi int, out price bigint)
language plpgsql stable as $$
declare o record; v_cnt int;
begin
  select count(*) into v_cnt from public.cfg_outcomes c
    where c.contractable and c.rarity = p_rarity and c.lo <= p_value and p_value <= c.hi;
  if v_cnt > 0 then
    select c.* into o from public.cfg_outcomes c
      where c.contractable and c.rarity = p_rarity and c.lo <= p_value and p_value <= c.hi
      order by c.case_ord, c.idx offset (p_n2 % v_cnt) limit 1;
    fi := greatest(0, least(game.num('fi_range') - 1,
      (game.num('wear_a') * o.price - p_value * 100000) / (game.num('wear_b') * o.price)))::int;
  else
    select c.* into o from public.cfg_outcomes c
      where c.contractable and c.rarity = p_rarity
      order by (case when p_value < c.lo then c.lo - p_value else p_value - c.hi end), c.case_ord, c.idx limit 1;
    if not found then raise exception 'Нет предметов такой редкости'; end if;
    fi := case when p_value < o.lo then game.num('fi_range')::int - 1 else 0 end;
  end if;
  case_id := o.case_id; idx := o.idx; item_id := o.item_id; phase := o.phase;
  price := game.instance_price(o.price, fi, false);
end $$;

-- Особые сочетания предметов. Возвращает рецепт (с пометкой cooling) или null.
create function game.recipe_match(p_pid uuid, p_ids bigint[], p_n int, p_rarity int) returns jsonb language plpgsql as $$
declare rc jsonb; c jsonb; v_cases text[]; v_all_st boolean; v_wears int[]; v_weapons text[]; v_ok boolean; v_used timestamptz;
  v_ids_n int; v_wear_one int;
begin
  select count(distinct i.item_id), case when count(distinct game.wear_idx(i.fi)) = 1 then min(game.wear_idx(i.fi)) end
    into v_ids_n, v_wear_one from public.items i where i.owner = p_pid and i.id = any (p_ids);
  select array_agg(distinct i.case_id), bool_and(i.st), array_agg(distinct game.wear_idx(i.fi)), array_agg(distinct o.weapon)
    into v_cases, v_all_st, v_wears, v_weapons
  from public.items i join public.cfg_outcomes o on o.case_id = i.case_id and o.idx = i.outcome_idx
  where i.owner = p_pid and i.id = any (p_ids);
  for rc in select x from jsonb_array_elements(coalesce(game.cfg('recipes'), '[]'::jsonb)) with ordinality q(x, ord) order by ord loop
    continue when p_n < (rc ->> 'minItems')::int or p_rarity >= (rc ->> 'target')::int;
    c := rc -> 'cond';
    v_ok := case c ->> 'type'
      when 'cases_each' then (select bool_and(x = any (v_cases)) from jsonb_array_elements_text(c -> 'cases') x)
      when 'same_case' then cardinality(v_cases) = 1 and p_rarity >= (c ->> 'rarityMin')::int
      when 'all_st' then v_all_st
      when 'all_wears' then cardinality(v_wears) = 5
      when 'weapon_all' then cardinality(v_weapons) = 1 and v_weapons[1] = c ->> 'weapon'
      when 'same_item' then v_ids_n = 1
      when 'all_wear' then v_wear_one is not null and v_wear_one = (c ->> 'idx')::int
      else false end;
    if coalesce(v_ok, false) then
      select used_at into v_used from public.recipe_uses where profile_id = p_pid and recipe_id = rc ->> 'id';
      if v_used is not null and v_used + make_interval(mins => (rc ->> 'cooldownMin')::int) > now() then
        return rc || jsonb_build_object('cooling', true,
          'left', ceil(extract(epoch from (v_used + make_interval(mins => (rc ->> 'cooldownMin')::int) - now())))::int);
      end if;
      return rc || jsonb_build_object('cooling', false);
    end if;
  end loop;
  return null;
end $$;

create function public.contract(p_ids bigint[]) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, game, pg_temp as $$
declare
  v_pid uuid := game.pid(); cfg jsonb := game.cfg('contract'); v_ids bigint[]; v_n int; v_cnt int; v_sum bigint;
  v_rmin int; v_rmax int; v_r int; v_lo bigint; v_hi bigint; r record; v_mult bigint; v_value bigint; v_target int;
  rc jsonb; v_secret jsonb := null; pk record; i public.items; v_roll_id bigint; v_item jsonb;
begin
  v_ids := array(select distinct x from unnest(coalesce(p_ids, '{}'::bigint[])) x);
  v_n := cardinality(v_ids);
  if v_n < (cfg ->> 'min')::int then raise exception 'Нужно минимум % предмета', cfg ->> 'min'; end if;
  if v_n > (cfg ->> 'max')::int then raise exception 'Максимум % предметов', cfg ->> 'max'; end if;
  perform game.lock(v_pid);
  select count(*), coalesce(sum(price), 0), min(rarity), max(rarity) into v_cnt, v_sum, v_rmin, v_rmax
    from items where owner = v_pid and id = any (v_ids);
  if v_cnt <> v_n then raise exception 'Каких-то предметов уже нет в инвентаре'; end if;
  if v_rmin <> v_rmax then raise exception 'Все предметы должны быть одной редкости'; end if;
  v_r := v_rmin;
  if v_r >= 7 then raise exception 'Выше контрабанды редкости нет'; end if;
  select min(lo), max(hi) into v_lo, v_hi from cfg_outcomes where contractable and rarity = v_r + 1;
  if v_sum * (cfg ->> 'min_pm')::bigint / 1000 < v_lo then raise exception 'Набор слишком дешёвый для следующей редкости'; end if;
  if v_sum * (cfg ->> 'max_pm')::bigint / 1000 > v_hi then raise exception 'Набор слишком дорогой для следующей редкости'; end if;

  select * into r from game.next_roll(v_pid);
  v_mult := game.contract_mult(r.n0, r.n1);
  v_target := v_r + 1;

  rc := game.recipe_match(v_pid, v_ids, v_n, v_r);
  if rc is not null then
    if (rc ->> 'cooling')::boolean then
      v_secret := jsonb_build_object('name', rc ->> 'name', 'cooling', true, 'left', (rc ->> 'left')::int);
    else
      insert into recipe_uses (profile_id, recipe_id) values (v_pid, rc ->> 'id')
        on conflict (profile_id, recipe_id) do update set used_at = now();
      insert into claims (profile_id, kind, ref) values (v_pid, 'find', rc ->> 'name') on conflict do nothing;
      if r.n3 % 10000 < (rc ->> 'chance')::bigint then
        v_mult := (rc ->> 'from')::bigint + ((rc ->> 'to')::bigint - (rc ->> 'from')::bigint) * (r.n1 % 10000) / 10000;
        v_target := (rc ->> 'target')::int;
        v_secret := jsonb_build_object('name', rc ->> 'name', 'cooling', false, 'hit', true);
      else
        v_secret := jsonb_build_object('name', rc ->> 'name', 'cooling', false, 'hit', false);
      end if;
    end if;
  end if;

  v_value := v_sum * v_mult / 1000;
  select * into pk from game.contract_pick(v_value, v_target, r.n2);

  delete from items where owner = v_pid and id = any (v_ids);
  insert into rolls (profile_id, kind, seed_id, client_seed, nonce, detail)
    values (v_pid, 'contract', r.sid, r.cseed, r.nnc, jsonb_build_object('sum', v_sum, 'rarity', v_r, 'mult', v_mult, 'value', v_value,
      'target', v_target, 'case', pk.case_id, 'idx', pk.idx, 'item', pk.item_id, 'phase', pk.phase, 'fi', pk.fi, 'price', pk.price,
      'special', coalesce((v_secret ->> 'hit')::boolean, false)))
    returning id into v_roll_id;
  insert into items (owner, case_id, outcome_idx, item_id, phase, rarity, fi, st, price, source, roll_id)
    values (v_pid, pk.case_id, pk.idx, pk.item_id, pk.phase, v_target, pk.fi, false, pk.price, 'contract', v_roll_id)
    returning * into i;
  v_item := game.item_json(i);
  update profiles set inv_rev = inv_rev + 1, xp = xp + ((game.cfg('pass') #>> '{xp,contract}')::int * game.xpm()) where id = v_pid;
  perform game.bump(v_pid, jsonb_build_object('contracts', 1, 'specials', (v_target = 6)::int, 'contrabands', (v_target = 7)::int));
  if v_target >= 3 then perform game.add_feed(v_pid, 'contract', (v_item - 'id') || jsonb_build_object('from', v_sum)); end if;
  return jsonb_build_object('item', v_item, 'mult', v_mult, 'value', v_value, 'sum', v_sum, 'secret', v_secret,
    'removed', to_jsonb(v_ids), 'nonce', r.nnc, 'me', game.after(v_pid));
end $$;

-- =====================================================================================
--  БАТЛЫ
-- =====================================================================================
-- Победитель и выплаты. Зеркало src/shared/battle.ts (resolveBattle).
-- p_values — [[цена дропа по местам] по раундам], p_tie — 52-битное число ролла (ничьи и «джекпот»).
create function game.battle_resolve(p_mode text, p_format text, p_values jsonb, p_tie bigint) returns jsonb
language plpgsql stable as $$
declare
  v_teams int[] := array(select x::int from jsonb_array_elements_text(game.cfg('battle') -> 'formats' -> p_format) with ordinality t(x, ord) order by ord);
  v_slots int := cardinality(v_teams);
  v_nt int := (select max(x) + 1 from unnest(v_teams) x);
  v_nr int := jsonb_array_length(p_values);
  v_sums bigint[]; v_ts bigint[]; v_score bigint[]; v_pay bigint[]; v_tied int[] := '{}';
  v_pot bigint := 0; v bigint; v_best bigint; v_acc bigint := 0; v_roll bigint; v_win int := -1; v_members int; v_each bigint; r int; s int;
begin
  if v_slots is null or v_slots = 0 then raise exception 'Неизвестный формат батла'; end if;
  v_sums := array_fill(0::bigint, array[v_slots]);
  v_ts := array_fill(0::bigint, array[v_nt]);
  for r in 0..v_nr - 1 loop
    for s in 1..v_slots loop
      v := (p_values -> r ->> (s - 1))::bigint;
      v_sums[s] := v_sums[s] + v;
      v_ts[v_teams[s] + 1] := v_ts[v_teams[s] + 1] + v;
      v_pot := v_pot + v;
    end loop;
  end loop;

  if p_mode = 'shared' then
    v_each := v_pot / v_slots;
    v_pay := array_fill(v_each, array[v_slots]);
  else
    if p_mode = 'jackpot' then
      v_roll := p_tie % v_pot;
      v_win := v_nt - 1;
      for s in 1..v_nt loop
        v_acc := v_acc + v_ts[s];
        if v_roll < v_acc then v_win := s - 1; exit; end if;
      end loop;
    else
      v_score := v_ts;
      if p_mode = 'terminal' then
        v_score := array_fill(0::bigint, array[v_nt]);
        for s in 1..v_slots loop
          v_score[v_teams[s] + 1] := v_score[v_teams[s] + 1] + (p_values -> (v_nr - 1) ->> (s - 1))::bigint;
        end loop;
      end if;
      if p_mode = 'crazy' then select min(x) into v_best from unnest(v_score) x;
      else select max(x) into v_best from unnest(v_score) x; end if;
      for s in 1..v_nt loop
        if v_score[s] = v_best then v_tied := v_tied || (s - 1); end if;
      end loop;
      v_win := v_tied[(p_tie % cardinality(v_tied)) + 1];
    end if;
    select count(*) into v_members from unnest(v_teams) x where x = v_win;
    v_each := v_pot / v_members;
    v_pay := array(select case when v_teams[i] = v_win then v_each else 0 end from generate_series(1, v_slots) i);
  end if;
  return jsonb_build_object('sums', to_jsonb(v_sums), 'teamSums', to_jsonb(v_ts), 'pot', v_pot, 'winnerTeam', v_win, 'payouts', to_jsonb(v_pay));
end $$;

-- Вид батла для клиента. Раунды и итог открываются по серверному времени — подсмотреть исход заранее нельзя.
create function game.battle_view(p_id uuid, p_full boolean) returns jsonb language plpgsql as $$
declare b public.battles; r public.battle_results; cfg jsonb := game.cfg('battle');
  v_rounds jsonb := '[]'::jsonb; v_sum jsonb := null; v_seed text := null; v_el numeric; v_n int;
begin
  select * into b from public.battles where id = p_id;
  if not found then return null; end if;
  if p_full and b.started_at is not null then
    select * into r from public.battle_results where battle_id = p_id;
    -- раунд отдаём за 1.5 с до начала его прокрутки
    v_el := extract(epoch from (now() - b.started_at)) * 1000 - (cfg ->> 'countdown_ms')::numeric + 1500;
    v_n := case when v_el < 0 then 0 else least(cardinality(b.cases), floor(v_el / (cfg ->> 'round_ms')::numeric)::int + 1) end;
    select coalesce(jsonb_agg(x order by ord), '[]'::jsonb) into v_rounds
      from jsonb_array_elements(r.rounds) with ordinality t(x, ord) where ord <= v_n;
    if now() >= b.ends_at - make_interval(secs => (cfg ->> 'end_ms')::numeric / 1000) then v_sum := r.summary; end if;
    if now() >= b.ends_at then select server_seed into v_seed from public.seeds where id = r.seed_id; end if;
  end if;
  return jsonb_build_object('id', b.id, 'status', b.status, 'mode', b.mode, 'format', b.format, 'cases', to_jsonb(b.cases),
    'cost', b.cost, 'private', b.is_private, 'created_by', b.created_by, 'players', b.players, 'seed_hash', b.seed_hash,
    'created_at', game.ms(b.created_at), 'started_at', game.ms(b.started_at), 'ends_at', game.ms(b.ends_at),
    'rounds', v_rounds, 'summary', v_sum, 'seed', v_seed, 'now', game.ms(now()));
end $$;

create function game.battle_list(p_pid uuid) returns jsonb language sql as $$
  select coalesce(jsonb_agg(game.battle_view(b.id, false) order by b.created_at desc), '[]'::jsonb)
  from (
    select id, created_at from public.battles
    where (status = 'open' and (not is_private or created_by = p_pid
             or exists (select 1 from jsonb_array_elements(players) x where x ->> 'pid' = p_pid::text)))
       or (status = 'done' and ends_at > now() - interval '3 minutes' and not is_private)
    order by created_at desc limit 40
  ) b
$$;

-- Старт: все дропы всех раундов считаются сразу по сиду батла, выплаты «созревают» к концу анимации.
create function game.battle_start(p_id uuid) returns void language plpgsql as $$
declare
  b public.battles; cfg jsonb := game.cfg('battle'); v_seed text; v_slots int;
  v_rounds jsonb := '[]'::jsonb; v_vals jsonb := '[]'::jsonb; v_round jsonb; v_rv jsonb; h text; d record;
  v_tie bigint; v_res jsonb; v_ends timestamptz; pl jsonb; v_pid uuid; v_pay bigint; v_won boolean; v_team int; r int; s int;
begin
  select * into b from public.battles where id = p_id for update;
  select sd.server_seed into v_seed from public.battle_results br join public.seeds sd on sd.id = br.seed_id where br.battle_id = p_id;
  v_slots := jsonb_array_length(b.players);
  for r in 0..cardinality(b.cases) - 1 loop
    v_round := '[]'::jsonb; v_rv := '[]'::jsonb;
    for s in 0..v_slots - 1 loop
      h := game.hmac_hex(v_seed, b.id::text || ':' || (r * 10 + s));
      select * into d from game.roll_drop(b.cases[r + 1], game.hex_int(substr(h, 1, 13)), game.hex_int(substr(h, 14, 8)), game.hex_int(substr(h, 22, 8)));
      v_round := v_round || jsonb_build_object('case', b.cases[r + 1], 'idx', d.outcome_idx, 'item', d.item_id, 'phase', d.phase,
        'rarity', d.rarity, 'fi', d.fi, 'st', d.st, 'price', d.price);
      v_rv := v_rv || to_jsonb(d.price);
    end loop;
    v_rounds := v_rounds || jsonb_build_array(v_round);
    v_vals := v_vals || jsonb_build_array(v_rv);
  end loop;
  v_tie := game.hex_int(substr(game.hmac_hex(v_seed, b.id::text || ':1000'), 1, 13));
  v_res := game.battle_resolve(b.mode, b.format, v_vals, v_tie);
  v_ends := now() + make_interval(secs => ((cfg ->> 'countdown_ms')::numeric + cardinality(b.cases) * (cfg ->> 'round_ms')::numeric + (cfg ->> 'end_ms')::numeric) / 1000);
  update public.battles set status = 'done', started_at = now(), ends_at = v_ends where id = p_id;
  update public.battle_results set rounds = v_rounds, summary = v_res || jsonb_build_object('tie', v_tie) where battle_id = p_id;

  for s in 0..v_slots - 1 loop
    pl := b.players -> s;
    continue when coalesce((pl ->> 'bot')::boolean, false);
    v_pid := (pl ->> 'pid')::uuid;
    v_pay := (v_res -> 'payouts' ->> s)::bigint;
    v_team := (cfg -> 'formats' -> b.format ->> s)::int;
    v_won := b.mode <> 'shared' and v_team = (v_res ->> 'winnerTeam')::int;
    if v_pay > 0 then
      insert into public.pending_credits (profile_id, amount, available_at, reason, feed)
        values (v_pid, v_pay, v_ends, 'battle',
          case when v_won then jsonb_build_object('kind', 'battle', 'data',
            jsonb_build_object('amount', v_pay, 'cost', b.cost, 'mode', b.mode, 'format', b.format, 'battle', b.id)) end);
    end if;
    perform game.bump(v_pid, jsonb_build_object('battles', 1, 'battle_wins', v_won::int, 'battle_winnings', case when v_won then v_pay else 0 end));
    update public.profiles set xp = xp + ((game.cfg('pass') #>> '{xp,battle}')::int * game.xpm()) where id = v_pid;
  end loop;
end $$;

create function game.battle_full(p_players jsonb) returns boolean language sql immutable as $$
  select not exists (select 1 from jsonb_array_elements(p_players) x where jsonb_typeof(x) = 'null')
$$;

create function public.battle_create(p_cases text[], p_format text, p_mode text, p_private boolean default false) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, game, pg_temp as $$
declare v_pid uuid := game.pid(); p public.profiles; cfg jsonb := game.cfg('battle'); v_teams jsonb; v_n int; v_cnt int; v_cost bigint;
  v_seed bigint; v_hash text; v_players jsonb; v_id uuid; i int;
begin
  v_n := coalesce(cardinality(p_cases), 0);
  if v_n < 1 or v_n > (cfg ->> 'max_rounds')::int then raise exception 'В батле от 1 до % кейсов', cfg ->> 'max_rounds'; end if;
  v_teams := cfg -> 'formats' -> p_format;
  if v_teams is null then raise exception 'Неизвестный формат батла'; end if;
  if not (cfg -> 'modes') ? p_mode then raise exception 'Неизвестный режим батла'; end if;
  select count(*), coalesce(sum(c.price), 0) into v_cnt, v_cost
    from unnest(p_cases) x join cfg_cases c on c.case_id = x and c.profile <> 'free';
  if v_cnt <> v_n then raise exception 'В списке есть неизвестный кейс'; end if;
  p := game.lock(v_pid);
  if (select count(*) from battles where created_by = v_pid and status = 'open') >= 3 then raise exception 'Слишком много открытых батлов'; end if;
  if p.balance < v_cost then raise exception 'Недостаточно монет'; end if;
  update profiles set balance = balance - v_cost where id = v_pid;
  v_seed := game.new_seed(null);
  select hash into v_hash from seeds where id = v_seed;
  v_players := jsonb_build_array(jsonb_build_object('slot', 0, 'pid', v_pid, 'nick', p.nick, 'avatar', p.avatar, 'bot', false));
  for i in 2..jsonb_array_length(v_teams) loop v_players := v_players || 'null'::jsonb; end loop;
  insert into battles (mode, format, cases, cost, is_private, created_by, players, seed_hash)
    values (p_mode, p_format, p_cases, v_cost, coalesce(p_private, false), v_pid, v_players, v_hash) returning id into v_id;
  insert into battle_results (battle_id, seed_id) values (v_id, v_seed);
  perform game.bump(v_pid, jsonb_build_object('spent', v_cost));
  return jsonb_build_object('battle', game.battle_view(v_id, true), 'me', game.after(v_pid));
end $$;

create function public.battle_join(p_id uuid, p_slot int default null) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, game, pg_temp as $$
declare v_pid uuid := game.pid(); b public.battles; p public.profiles; v_slot int := p_slot;
begin
  select * into b from battles where id = p_id for update;
  if not found then raise exception 'Батл не найден'; end if;
  if b.status <> 'open' then raise exception 'Батл уже начался или отменён'; end if;
  if exists (select 1 from jsonb_array_elements(b.players) x where x ->> 'pid' = v_pid::text) then raise exception 'Ты уже в этом батле'; end if;
  if v_slot is null then
    select min(ord)::int - 1 into v_slot from jsonb_array_elements(b.players) with ordinality t(x, ord) where jsonb_typeof(x) = 'null';
  end if;
  if v_slot is null or v_slot < 0 or v_slot >= jsonb_array_length(b.players) or jsonb_typeof(b.players -> v_slot) <> 'null' then
    raise exception 'Это место уже занято';
  end if;
  p := game.lock(v_pid);
  if p.balance < b.cost then raise exception 'Недостаточно монет'; end if;
  update profiles set balance = balance - b.cost where id = v_pid;
  perform game.bump(v_pid, jsonb_build_object('spent', b.cost));
  update battles set players = jsonb_set(players, array[v_slot::text],
      jsonb_build_object('slot', v_slot, 'pid', v_pid, 'nick', p.nick, 'avatar', p.avatar, 'bot', false))
    where id = p_id returning * into b;
  if game.battle_full(b.players) then perform game.battle_start(p_id); end if;
  return jsonb_build_object('battle', game.battle_view(p_id, true), 'me', game.after(v_pid));
end $$;

-- Создатель сажает ботов: на одно место или (p_slot = null) на все свободные.
create function public.battle_add_bot(p_id uuid, p_slot int default null) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, game, pg_temp as $$
declare v_pid uuid := game.pid(); b public.battles; bots jsonb := game.cfg('battle') -> 'bots'; v_off int; s int; v_done boolean := false;
begin
  select * into b from battles where id = p_id for update;
  if not found then raise exception 'Батл не найден'; end if;
  if b.status <> 'open' then raise exception 'Батл уже начался или отменён'; end if;
  if b.created_by <> v_pid then raise exception 'Ботов может позвать только создатель'; end if;
  v_off := (game.ms(b.created_at) / 1000 % jsonb_array_length(bots))::int;
  for s in 0..jsonb_array_length(b.players) - 1 loop
    if (p_slot is null or p_slot = s) and jsonb_typeof(b.players -> s) = 'null' then
      b.players := jsonb_set(b.players, array[s::text], jsonb_build_object('slot', s, 'pid', null,
        'nick', bots ->> ((v_off + s) % jsonb_array_length(bots)), 'avatar', (v_off + s * 5) % game.num('avatars')::int, 'bot', true));
      v_done := true;
    end if;
  end loop;
  if not v_done then raise exception 'Свободных мест нет'; end if;
  update battles set players = b.players where id = p_id;
  if game.battle_full(b.players) then perform game.battle_start(p_id); end if;
  return jsonb_build_object('battle', game.battle_view(p_id, true), 'me', game.after(v_pid));
end $$;

create function game.battle_refund(b public.battles, p_only uuid) returns void language plpgsql as $$
declare pl jsonb; v_pid uuid;
begin
  for pl in select x from jsonb_array_elements(b.players) x where jsonb_typeof(x) = 'object' and not coalesce((x ->> 'bot')::boolean, false) loop
    v_pid := (pl ->> 'pid')::uuid;
    continue when p_only is not null and v_pid <> p_only;
    update public.profiles set balance = balance + b.cost where id = v_pid;
    perform game.bump(v_pid, jsonb_build_object('spent', -b.cost));
  end loop;
end $$;

-- Выйти из лобби: взнос возвращается. Если уходит создатель — батл отменяется, взносы возвращаются всем.
create function public.battle_leave(p_id uuid) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, game, pg_temp as $$
declare v_pid uuid := game.pid(); b public.battles; v_slot int;
begin
  select * into b from battles where id = p_id for update;
  if not found then raise exception 'Батл не найден'; end if;
  if b.status <> 'open' then raise exception 'Батл уже начался или отменён'; end if;
  if b.created_by = v_pid then
    perform game.battle_refund(b, null);
    update battles set status = 'cancelled' where id = p_id;
  else
    select (x ->> 'slot')::int into v_slot from jsonb_array_elements(b.players) x where x ->> 'pid' = v_pid::text;
    if v_slot is null then raise exception 'Тебя нет в этом батле'; end if;
    perform game.battle_refund(b, v_pid);
    update battles set players = jsonb_set(players, array[v_slot::text], 'null'::jsonb) where id = p_id;
  end if;
  return jsonb_build_object('battle', game.battle_view(p_id, true), 'me', game.after(v_pid));
end $$;

create function public.get_battle(p_id uuid) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, game, pg_temp as $$
declare v jsonb;
begin
  perform game.pid();
  v := game.battle_view(p_id, true);
  if v is null then raise exception 'Батл не найден'; end if;
  return v;
end $$;

-- =====================================================================================
--  КОИНФЛИП
-- =====================================================================================
create function game.coinflip_json(c public.coinflips) returns jsonb language sql stable as $$
  select jsonb_build_object('id', c.id, 'status', c.status, 'stake', c.stake, 'creator', c.creator, 'creator_nick', c.creator_nick,
    'creator_avatar', c.creator_avatar, 'creator_side', c.creator_side, 'joiner', c.joiner, 'joiner_nick', c.joiner_nick,
    'joiner_avatar', c.joiner_avatar, 'joiner_bot', c.joiner_bot, 'seed_hash', c.seed_hash, 'result', c.result, 'winner', c.winner,
    'payout', c.payout, 'server_seed', c.server_seed, 'started_at', game.ms(c.started_at), 'ends_at', game.ms(c.ends_at),
    'created_at', game.ms(c.created_at))
$$;

create function game.coinflip_list() returns jsonb language sql as $$
  select coalesce(jsonb_agg(game.coinflip_json(c) order by c.id desc), '[]'::jsonb)
  from (select * from public.coinflips
        where status = 'open' or (status = 'done' and ends_at > now() - interval '45 seconds')
        order by id desc limit 40) c
$$;

create function game.coinflip_resolve(p_id bigint) returns void language plpgsql as $$
declare c public.coinflips; cfg jsonb := game.cfg('coinflip'); v_seed text; v_res int; v_winner uuid; v_bot_won boolean; v_pay bigint; v_ends timestamptz; v_loser uuid;
begin
  select * into c from public.coinflips where id = p_id for update;
  select s.server_seed into v_seed from public.seeds s where s.hash = c.seed_hash order by s.id desc limit 1;
  v_res := (game.hex_int(substr(game.hmac_hex(v_seed, 'coinflip-' || c.id || ':0'), 1, 13)) % 2)::int;
  v_bot_won := c.joiner_bot and v_res <> c.creator_side;
  v_winner := case when v_res = c.creator_side then c.creator when c.joiner_bot then null else c.joiner end;
  v_loser := case when v_res = c.creator_side then c.joiner else c.creator end;
  v_pay := c.stake * 2 * (100 - (cfg ->> 'rake_pct')::bigint) / 100;
  v_ends := now() + make_interval(secs => (cfg ->> 'flip_ms')::numeric / 1000);
  update public.coinflips set status = 'done', result = v_res, winner = v_winner, payout = v_pay, server_seed = v_seed,
    started_at = now(), ends_at = v_ends where id = p_id;
  update public.seeds set revealed_at = now() where hash = c.seed_hash;
  if v_winner is not null then
    insert into public.pending_credits (profile_id, amount, available_at, reason, feed)
      values (v_winner, v_pay, v_ends, 'coinflip', jsonb_build_object('kind', 'coinflip', 'data', jsonb_build_object('amount', v_pay, 'stake', c.stake)));
    perform game.bump(v_winner, jsonb_build_object('coinflips', 1, 'coinflip_wins', 1));
    update public.profiles set xp = xp + ((game.cfg('pass') #>> '{xp,coinflip}')::int * game.xpm()) where id = v_winner;
  end if;
  if v_loser is not null and not (c.joiner_bot and not v_bot_won) then
    perform game.bump(v_loser, jsonb_build_object('coinflips', 1));
    update public.profiles set xp = xp + ((game.cfg('pass') #>> '{xp,coinflip}')::int * game.xpm()) where id = v_loser;
  end if;
end $$;

create function public.coinflip_create(p_stake bigint, p_side int) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, game, pg_temp as $$
declare v_pid uuid := game.pid(); p public.profiles; cfg jsonb := game.cfg('coinflip'); v_seed bigint; v_hash text; v_id bigint;
begin
  if p_stake is null or p_stake < (cfg ->> 'min')::bigint or p_stake > (cfg ->> 'max')::bigint then
    raise exception 'Ставка от % до % монет', (cfg ->> 'min')::bigint / 100, (cfg ->> 'max')::bigint / 100;
  end if;
  if p_side is null or p_side not in (0, 1) then raise exception 'Выбери сторону монеты'; end if;
  p := game.lock(v_pid);
  if p.balance < p_stake then raise exception 'Недостаточно монет'; end if;
  if (select count(*) from coinflips where creator = v_pid and status = 'open') >= 5 then raise exception 'Слишком много открытых коинфлипов'; end if;
  update profiles set balance = balance - p_stake where id = v_pid;
  v_seed := game.new_seed(null);
  select hash into v_hash from seeds where id = v_seed;
  insert into coinflips (stake, creator, creator_nick, creator_avatar, creator_side, seed_hash)
    values (p_stake, v_pid, p.nick, p.avatar, p_side, v_hash) returning id into v_id;
  return jsonb_build_object('id', v_id, 'me', game.after(v_pid));
end $$;

create function public.coinflip_join(p_id bigint) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, game, pg_temp as $$
declare v_pid uuid := game.pid(); c public.coinflips; p public.profiles;
begin
  select * into c from coinflips where id = p_id for update;
  if not found then raise exception 'Коинфлип не найден'; end if;
  if c.status <> 'open' then raise exception 'Этот коинфлип уже сыгран'; end if;
  if c.creator = v_pid then raise exception 'Нельзя играть с самим собой — позови бота'; end if;
  p := game.lock(v_pid);
  if p.balance < c.stake then raise exception 'Недостаточно монет'; end if;
  update profiles set balance = balance - c.stake where id = v_pid;
  update coinflips set joiner = v_pid, joiner_nick = p.nick, joiner_avatar = p.avatar where id = p_id;
  perform game.coinflip_resolve(p_id);
  return jsonb_build_object('id', p_id, 'me', game.after(v_pid));
end $$;

create function public.coinflip_bot(p_id bigint) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, game, pg_temp as $$
declare v_pid uuid := game.pid(); c public.coinflips; bots jsonb := game.cfg('battle') -> 'bots';
begin
  select * into c from coinflips where id = p_id for update;
  if not found then raise exception 'Коинфлип не найден'; end if;
  if c.status <> 'open' then raise exception 'Этот коинфлип уже сыгран'; end if;
  if c.creator <> v_pid then raise exception 'Бота может позвать только создатель'; end if;
  update coinflips set joiner_bot = true, joiner_nick = bots ->> (c.id % jsonb_array_length(bots))::int,
    joiner_avatar = (c.id % game.num('avatars'))::int where id = p_id;
  perform game.coinflip_resolve(p_id);
  return jsonb_build_object('id', p_id, 'me', game.after(v_pid));
end $$;

create function public.coinflip_cancel(p_id bigint) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, game, pg_temp as $$
declare v_pid uuid := game.pid(); c public.coinflips;
begin
  select * into c from coinflips where id = p_id for update;
  if not found then raise exception 'Коинфлип не найден'; end if;
  if c.status <> 'open' then raise exception 'Этот коинфлип уже сыгран'; end if;
  if c.creator <> v_pid then raise exception 'Это не твой коинфлип'; end if;
  update coinflips set status = 'cancelled' where id = p_id;
  update profiles set balance = balance + c.stake where id = v_pid;
  return jsonb_build_object('id', p_id, 'me', game.after(v_pid));
end $$;

-- Уборка: зависшие лобби (создатель закрыл вкладку) отменяются с возвратом взносов.
create function game.gc() returns void language plpgsql as $$
declare b public.battles; c public.coinflips; r record;
begin
  for b in select * from public.battles where status = 'open' and created_at < now() - interval '30 minutes' for update skip locked loop
    perform game.battle_refund(b, null);
    update public.battles set status = 'cancelled' where id = b.id;
  end loop;
  for c in select * from public.coinflips where status = 'open' and created_at < now() - interval '30 minutes' for update skip locked loop
    update public.coinflips set status = 'cancelled' where id = c.id;
    update public.profiles set balance = balance + c.stake where id = c.creator;
  end loop;
  for r in select id from public.raids where status = 'open' and created_at < now() - interval '30 minutes' for update skip locked loop
    perform game.raid_refund(r.id);
  end loop;
  delete from public.counters where period like 'd:%' and period < 'd:' || to_char(now() - interval '21 days', 'YYYY-MM-DD');
  delete from public.battles where status <> 'open' and created_at < now() - interval '7 days';
  delete from public.coinflips where status <> 'open' and created_at < now() - interval '2 days';
  delete from public.raids where status in ('done', 'cancelled') and created_at < now() - interval '2 days';
  delete from public.crash_rounds where status = 'done' and created_at < now() - interval '1 day';
end $$;

-- =====================================================================================
--  БОНУСЫ, НАГРАДЫ, ПРОМОКОДЫ, ДОЖДЬ
-- =====================================================================================
create function game.grant(p_pid uuid, p_coins bigint, p_case text, p_n int) returns void language plpgsql as $$
begin
  update public.profiles
    set balance = balance + coalesce(p_coins, 0),
        tickets = case when p_case is not null and coalesce(p_n, 0) > 0
                       then jsonb_set(tickets, array[p_case], to_jsonb(coalesce((tickets ->> p_case)::int, 0) + p_n))
                       else tickets end
    where id = p_pid;
end $$;

create function public.bonus_free_case() returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, game, pg_temp as $$
declare v_pid uuid := game.pid(); p public.profiles; v_cd int := (game.cfg('bonus') ->> 'free_cd_min')::int; v_drops jsonb;
begin
  p := game.lock(v_pid);
  if p.free_case_at is not null and p.free_case_at + make_interval(mins => v_cd) > now() then raise exception 'Бесплатный кейс ещё не готов'; end if;
  if (select count(*) from items where owner = v_pid) + 1 > game.num('inv_limit') then raise exception 'Инвентарь переполнен — продай лишнее'; end if;
  update profiles set free_case_at = now() where id = v_pid;
  v_drops := game.drop_batch(v_pid, 'free', 0, 1, 'free');
  perform game.bump(v_pid, jsonb_build_object('free_cases', 1));
  return jsonb_build_object('drops', v_drops, 'me', game.after(v_pid));
end $$;

create function public.bonus_daily() returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, game, pg_temp as $$
declare v_pid uuid := game.pid(); p public.profiles; c jsonb := game.cfg('bonus'); v_streak int; v_amount bigint;
begin
  p := game.lock(v_pid);
  if p.daily_at is not null and p.daily_at + make_interval(hours => (c ->> 'daily_cd_h')::int) > now() then
    raise exception 'Ежедневный бонус уже получен';
  end if;
  v_streak := case when p.daily_at is not null and p.daily_at + make_interval(hours => (c ->> 'daily_reset_h')::int) > now()
                   then p.daily_streak + 1 else 1 end;
  v_amount := (c -> 'daily' ->> (least(v_streak, jsonb_array_length(c -> 'daily')) - 1))::bigint;
  update profiles set balance = balance + v_amount, daily_at = now(), daily_streak = v_streak where id = v_pid;
  perform game.bump(v_pid, jsonb_build_object('dailies', 1), jsonb_build_object('streak', v_streak));
  return jsonb_build_object('amount', v_amount, 'streak', v_streak, 'me', game.after(v_pid));
end $$;

create function public.bonus_second_chance() returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, game, pg_temp as $$
declare v_pid uuid := game.pid(); p public.profiles; c jsonb := game.cfg('bonus') -> 'second'; v_net bigint;
begin
  p := game.lock(v_pid);
  v_net := p.balance + (select coalesce(sum(price), 0) from items where owner = v_pid)
                     + (select coalesce(sum(amount), 0) from pending_credits where profile_id = v_pid)
                     + (select coalesce(sum(stake), 0) from coinflips where creator = v_pid and status = 'open')
                     + (select coalesce(sum(cost), 0) from battles b where b.status = 'open'
                          and exists (select 1 from jsonb_array_elements(b.players) x where x ->> 'pid' = v_pid::text));
  if v_net >= (c ->> 'max_net')::bigint then raise exception 'Второй шанс — только когда всё слито'; end if;
  if p.second_at is not null and p.second_at + make_interval(mins => (c ->> 'cd_min')::int) > now() then
    raise exception 'Второй шанс ещё перезаряжается';
  end if;
  update profiles set balance = balance + (c ->> 'amount')::bigint, second_at = now() where id = v_pid;
  perform game.bump(v_pid, jsonb_build_object('second_chances', 1));
  return jsonb_build_object('amount', (c ->> 'amount')::bigint, 'me', game.after(v_pid));
end $$;

create function public.promo_redeem(p_code text) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, game, pg_temp as $$
declare v_pid uuid := game.pid(); v_code text := upper(btrim(coalesce(p_code, ''))); pr jsonb;
begin
  pr := game.cfg('promo') -> v_code;
  if v_code = '' or pr is null then raise exception 'Такого промокода нет'; end if;
  perform game.lock(v_pid);
  insert into claims (profile_id, kind, ref) values (v_pid, 'promo', v_code) on conflict do nothing;
  if not found then raise exception 'Ты уже вводил этот промокод'; end if;
  perform game.grant(v_pid, (pr ->> 'coins')::bigint, pr ->> 'case', (pr ->> 'n')::int);
  return jsonb_build_object('coins', (pr ->> 'coins')::bigint, 'case', pr ->> 'case', 'n', (pr ->> 'n')::int, 'me', game.after(v_pid));
end $$;

-- Забрать награду: p_kind = quest | ach | level, p_id — id задания/достижения или номер уровня.
create function public.claim(p_kind text, p_id text) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, game, pg_temp as $$
declare v_pid uuid := game.pid(); p public.profiles; q jsonb; v_per text; v_val bigint; v_lvl int; v_reward jsonb;
begin
  p := game.lock(v_pid);
  if p_kind = 'quest' then
    q := game.cfg('quests') -> p_id;
    if q is null then raise exception 'Нет такого задания'; end if;
    v_per := case q ->> 'period' when 'day' then game.day_key() else game.week_key() end;
    select value into v_val from counters where profile_id = v_pid and period = v_per and metric = q ->> 'metric';
    if coalesce(v_val, 0) < (q ->> 'goal')::bigint then raise exception 'Задание ещё не выполнено'; end if;
    insert into claims (profile_id, kind, ref) values (v_pid, 'quest', p_id || '|' || v_per) on conflict do nothing;
    if not found then raise exception 'Награда уже получена'; end if;
    update profiles set balance = balance + (q ->> 'coins')::bigint, xp = xp + (q ->> 'xp')::int where id = v_pid;
    v_reward := jsonb_build_object('coins', (q ->> 'coins')::bigint, 'xp', (q ->> 'xp')::int);
  elsif p_kind = 'ach' then
    q := game.cfg('achievements') -> p_id;
    if q is null then raise exception 'Нет такого достижения'; end if;
    v_val := coalesce((p.stats ->> (q ->> 'metric'))::bigint, 0);
    if q ->> 'metric' = 'peak' then v_val := greatest(v_val, p.balance); end if;
    if v_val < (q ->> 'goal')::bigint then raise exception 'Достижение ещё не выполнено'; end if;
    insert into claims (profile_id, kind, ref) values (v_pid, 'ach', p_id) on conflict do nothing;
    if not found then raise exception 'Награда уже получена'; end if;
    update profiles set balance = balance + (q ->> 'coins')::bigint where id = v_pid;
    v_reward := jsonb_build_object('coins', (q ->> 'coins')::bigint);
  elsif p_kind = 'level' then
    v_lvl := p_id::int;
    if v_lvl < 1 or v_lvl > game.level_of(p.xp) then raise exception 'Уровень ещё не достигнут'; end if;
    q := game.cfg('pass') -> 'rewards' -> (v_lvl - 1);
    insert into claims (profile_id, kind, ref) values (v_pid, 'level', (game.cfg('pass') ->> 'season') || '|' || v_lvl) on conflict do nothing;
    if not found then raise exception 'Награда уже получена'; end if;
    perform game.grant(v_pid, (q ->> 'coins')::bigint, q ->> 'case', (q ->> 'n')::int);
    v_reward := jsonb_build_object('coins', (q ->> 'coins')::bigint, 'case', q ->> 'case', 'n', (q ->> 'n')::int);
  else
    raise exception 'Неизвестный тип награды';
  end if;
  return jsonb_build_object('reward', v_reward, 'me', game.after(v_pid));
end $$;

-- ---------- дождь ----------
-- Состояние двигается «лениво» — при любом sync: запуск, завершение и раздача.
create function game.rain_tick() returns void language plpgsql as $$
declare c jsonb := game.cfg('bonus') -> 'rain'; r public.rain; v_n int; v_share bigint; j record;
begin
  if c is null or not pg_try_advisory_xact_lock(770177) then return; end if;
  if random() < 0.01 then perform game.gc(); end if;
  select * into r from public.rain order by id desc limit 1 for update;
  if not found then
    insert into public.rain (pot, starts_at, ends_at, settled) values (0, now(), now(), true);
    return;
  end if;
  if not r.settled and now() >= r.ends_at then
    select count(*) into v_n from public.rain_joins where rain_id = r.id;
    v_share := case when v_n > 0 then least((c ->> 'max_share')::bigint, r.pot / v_n) else 0 end;
    if v_n > 0 then
      update public.profiles set balance = balance + v_share where id in (select profile_id from public.rain_joins where rain_id = r.id);
      for j in select profile_id from public.rain_joins where rain_id = r.id loop
        perform game.bump(j.profile_id, jsonb_build_object('rains', 1));
      end loop;
      perform game.add_chat(null, 'system', format('Дождь прошёл: игроков под ним — %s, каждому по %s монет', v_n, v_share / 100));
    else
      perform game.add_chat(null, 'system', 'Дождь прошёл мимо — никто не успел');
    end if;
    update public.rain set settled = true, joiners = v_n, share = v_share where id = r.id;
  elsif r.settled and now() >= r.ends_at + make_interval(mins => (c ->> 'every_min')::int) then
    insert into public.rain (pot, ends_at) values ((c ->> 'pot')::bigint, now() + make_interval(secs => (c ->> 'duration_sec')::int));
    perform game.add_chat(null, 'system', 'Пошёл дождь! Жми «Под дождь», пока не кончился');
  end if;
end $$;

create function game.rain_view(p_pid uuid) returns jsonb language plpgsql as $$
declare c jsonb := game.cfg('bonus') -> 'rain'; r public.rain;
begin
  select * into r from public.rain order by id desc limit 1;
  if not found then return null; end if;
  return jsonb_build_object('id', r.id, 'active', (not r.settled and now() < r.ends_at), 'pot', r.pot, 'ends_at', game.ms(r.ends_at),
    'joiners', (select count(*) from public.rain_joins where rain_id = r.id),
    'joined', exists (select 1 from public.rain_joins where rain_id = r.id and profile_id = p_pid),
    'share', r.share, 'next_at', game.ms(r.ends_at + make_interval(mins => (c ->> 'every_min')::int)));
end $$;

create function public.rain_join() returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, game, pg_temp as $$
declare v_pid uuid := game.pid(); r public.rain;
begin
  select * into r from rain order by id desc limit 1;
  if not found or r.settled or now() >= r.ends_at then raise exception 'Дождя сейчас нет'; end if;
  insert into rain_joins (rain_id, profile_id) values (r.id, v_pid) on conflict do nothing;
  return jsonb_build_object('rain', game.rain_view(v_pid));
end $$;


-- =====================================================================================
--  КРАШ: общий раунд. Точка падения выбирается из HMAC(server seed, 'crash:<id>'), хеш сида виден заранее.
-- =====================================================================================
-- Точка падения в промилле. Целочисленно, зеркало src/shared/crash.ts.
create function game.crash_pm(p_hex text) returns int language sql stable as $$
  select least(1000000, greatest(1000,
    ((100 - (game.cfg('crash') ->> 'edge')::bigint) * 10 * 4503599627370496 / (4503599627370496 - game.hex_int(substr(p_hex, 1, 13))))::int))
$$;

-- Множитель (промилле) через p_ms мс после старта.
create function game.crash_mult(p_ms numeric) returns int language sql stable as $$
  select floor(1000 * exp((game.cfg('crash') ->> 'growth')::numeric * p_ms / 1000))::int
$$;

-- Двигает состояние раунда по времени: ставки → полёт → падение → пауза → новый раунд.
create function game.crash_tick() returns void language plpgsql as $$
declare c jsonb := game.cfg('crash'); r public.crash_rounds; v_seed bigint; v_srv text; v_id bigint; b record; v_pay bigint; i int;
begin
  if c is null then return; end if;
  perform pg_advisory_xact_lock(770188);
  for i in 1..3 loop
    select * into r from public.crash_rounds order by id desc limit 1;
    if r.id is null or (r.status = 'done' and now() >= r.crashed_at + make_interval(secs => (c ->> 'pause_ms')::numeric / 1000)) then
      v_seed := game.new_seed(null);
      select server_seed into v_srv from public.seeds where id = v_seed;
      insert into public.crash_rounds (seed_id, seed_hash, bet_ends_at)
        values (v_seed, game.sha_hex(v_srv), now() + make_interval(secs => (c ->> 'bet_ms')::numeric / 1000)) returning id into v_id;
      update public.crash_rounds set crash_pm = game.crash_pm(game.hmac_hex(v_srv, 'crash:' || v_id)) where id = v_id;
    elsif r.status = 'bet' and now() >= r.bet_ends_at then
      update public.crash_rounds set status = 'run', started_at = bet_ends_at,
        crashed_at = bet_ends_at + make_interval(secs => ln(crash_pm / 1000.0) / (c ->> 'growth')::numeric)
        where id = r.id;
    elsif r.status = 'run' and now() >= r.crashed_at then
      update public.crash_rounds set status = 'done', server_seed = (select server_seed from public.seeds where id = r.seed_id) where id = r.id;
      update public.seeds set revealed_at = now() where id = r.seed_id;
      -- автовывод: сработал, если выбранный множитель не выше точки падения
      for b in select * from public.crash_bets where round_id = r.id and cash_pm is null and auto_pm is not null and auto_pm <= r.crash_pm loop
        v_pay := b.amount * b.auto_pm / 1000;
        update public.crash_bets set cash_pm = b.auto_pm, payout = v_pay where round_id = r.id and profile_id = b.profile_id;
        update public.profiles set balance = balance + v_pay where id = b.profile_id;
        perform game.bump(b.profile_id, jsonb_build_object('crash_wins', 1, 'crash_won', v_pay - b.amount));
      end loop;
    else
      exit;
    end if;
  end loop;
end $$;

create function public.crash_state() returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, game, pg_temp as $$
declare v_pid uuid := game.pid(); r public.crash_rounds; v_my jsonb;
begin
  perform game.crash_tick();
  select * into r from crash_rounds order by id desc limit 1;
  if r.id is null then return jsonb_build_object('now', game.ms(now()), 'round', null); end if;
  select jsonb_build_object('amount', amount, 'auto_pm', auto_pm, 'cash_pm', cash_pm, 'payout', payout) into v_my
    from crash_bets where round_id = r.id and profile_id = v_pid;
  return jsonb_build_object(
    'now', game.ms(now()),
    'cfg', jsonb_build_object('min', game.cfg('crash') -> 'min', 'max', game.cfg('crash') -> 'max', 'growth', game.cfg('crash') -> 'growth', 'max_auto', game.cfg('crash') -> 'max_auto'),
    'round', jsonb_build_object('id', r.id, 'status', r.status, 'seed_hash', r.seed_hash, 'bet_ends_at', game.ms(r.bet_ends_at),
      'started_at', game.ms(r.started_at),
      'crashed_at', case when r.status = 'done' then game.ms(r.crashed_at) end,
      'crash_pm', case when r.status = 'done' then r.crash_pm end,
      'seed', case when r.status = 'done' then r.server_seed end),
    'my', v_my,
    'bets', (select coalesce(jsonb_agg(jsonb_build_object('nick', p.nick, 'avatar', p.avatar, 'amount', b.amount, 'cash_pm', b.cash_pm, 'payout', b.payout) order by b.amount desc), '[]'::jsonb)
             from crash_bets b join profiles p on p.id = b.profile_id where b.round_id = r.id),
    'history', (select coalesce(jsonb_agg(h.crash_pm order by h.id desc), '[]'::jsonb) from (select id, crash_pm from crash_rounds where status = 'done' order by id desc limit 14) h));
end $$;

create function public.crash_bet(p_amount bigint, p_auto int default null) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, game, pg_temp as $$
declare v_pid uuid := game.pid(); c jsonb := game.cfg('crash'); r public.crash_rounds; p public.profiles;
begin
  perform game.crash_tick();
  select * into r from crash_rounds order by id desc limit 1;
  if r.id is null or r.status <> 'bet' or now() >= r.bet_ends_at then raise exception 'Ставки сейчас не принимаются. Дождись следующего раунда'; end if;
  if p_amount is null or p_amount < (c ->> 'min')::bigint or p_amount > (c ->> 'max')::bigint then
    raise exception 'Ставка от % до % монет', (c ->> 'min')::bigint / 100, (c ->> 'max')::bigint / 100;
  end if;
  if p_auto is not null and (p_auto < 1010 or p_auto > (c ->> 'max_auto')::int) then raise exception 'Автовывод от x1.01 до x%', (c ->> 'max_auto')::int / 1000; end if;
  p := game.lock(v_pid);
  if exists (select 1 from crash_bets where round_id = r.id and profile_id = v_pid) then raise exception 'Ты уже поставил в этом раунде'; end if;
  if p.balance < p_amount then raise exception 'Недостаточно монет'; end if;
  update profiles set balance = balance - p_amount, xp = xp + ((game.cfg('pass') #>> '{xp,crash}')::int * game.xpm()) where id = v_pid;
  insert into crash_bets (round_id, profile_id, amount, auto_pm) values (r.id, v_pid, p_amount, p_auto);
  perform game.bump(v_pid, jsonb_build_object('crash_bets', 1, 'spent', p_amount));
  return jsonb_build_object('ok', true, 'me', game.after(v_pid));
end $$;

create function public.crash_cashout() returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, game, pg_temp as $$
declare v_pid uuid := game.pid(); r public.crash_rounds; b public.crash_bets; v_m int; v_pay bigint;
begin
  perform game.crash_tick();
  perform game.lock(v_pid);
  select * into r from crash_rounds order by id desc limit 1;
  select * into b from crash_bets where round_id = r.id and profile_id = v_pid for update;
  if not found then raise exception 'У тебя нет ставки в этом раунде'; end if;
  if b.cash_pm is not null then raise exception 'Ты уже забрал выигрыш'; end if;
  if r.status = 'bet' then raise exception 'Раунд ещё не начался'; end if;
  if r.status <> 'run' then raise exception 'Поздно: ракета уже упала'; end if;
  v_m := game.crash_mult(extract(epoch from (now() - r.started_at)) * 1000);
  v_pay := b.amount * v_m / 1000;
  update crash_bets set cash_pm = v_m, payout = v_pay where round_id = r.id and profile_id = v_pid;
  update profiles set balance = balance + v_pay where id = v_pid;
  perform game.bump(v_pid, jsonb_build_object('crash_wins', 1, 'crash_won', v_pay - b.amount));
  return jsonb_build_object('ok', true, 'mult', v_m, 'payout', v_pay, 'me', game.after(v_pid));
end $$;


-- =====================================================================================
--  РЕЙД-КЕЙС: комната копит банк на один дорогой кейс, выигрыш делится по долям вклада
-- =====================================================================================
create function game.raid_view(p_id uuid, p_pid uuid) returns jsonb language plpgsql as $$
declare r public.raids; v_seed text; v_ended boolean;
begin
  select * into r from public.raids where id = p_id;
  if not found then return null; end if;
  v_ended := r.ends_at is not null and now() >= r.ends_at;
  if v_ended then select server_seed into v_seed from public.seeds where id = r.seed_id; end if;
  return jsonb_build_object('id', r.id, 'status', r.status, 'case', r.case_id, 'target', r.target, 'pot', r.pot,
    'creator', r.creator, 'seed_hash', r.seed_hash, 'started_at', game.ms(r.started_at), 'ends_at', game.ms(r.ends_at), 'now', game.ms(now()),
    'mine', coalesce((select amount from public.raid_shares where raid_id = r.id and profile_id = p_pid), 0),
    'shares', (select coalesce(jsonb_agg(jsonb_build_object('nick', p.nick, 'avatar', p.avatar, 'amount', s.amount, 'pid', s.profile_id) order by s.amount desc), '[]'::jsonb)
               from public.raid_shares s join public.profiles p on p.id = s.profile_id where s.raid_id = r.id),
    'result', r.result,
    'payouts', case when v_ended then r.payouts end,
    'seed', v_seed);
end $$;

create function game.raid_start(p_id uuid) returns void language plpgsql as $$
declare r public.raids; cfg jsonb := game.cfg('raid'); v_srv text; h text; d record; v_val bigint; v_ends timestamptz; sh record; v_pay bigint; v_left bigint; v_big uuid; pays jsonb := '[]'::jsonb;
begin
  select * into r from public.raids where id = p_id for update;
  select server_seed into v_srv from public.seeds where id = r.seed_id;
  h := game.hmac_hex(v_srv, r.id::text || ':0');
  select * into d from game.roll_drop(r.case_id, game.hex_int(substr(h, 1, 13)), game.hex_int(substr(h, 14, 8)), game.hex_int(substr(h, 22, 8)));
  v_val := d.price;
  v_ends := now() + make_interval(secs => ((cfg ->> 'roll_ms')::numeric + (cfg ->> 'end_ms')::numeric) / 1000);
  v_left := v_val;
  select profile_id into v_big from public.raid_shares where raid_id = r.id order by amount desc, profile_id limit 1;
  for sh in select * from public.raid_shares where raid_id = r.id loop
    v_pay := v_val * sh.amount / r.target;
    v_left := v_left - v_pay;
    pays := pays || jsonb_build_array(jsonb_build_object('pid', sh.profile_id, 'amount', v_pay));
  end loop;
  -- остаток от деления — самому крупному вкладчику
  pays := (select jsonb_agg(case when x ->> 'pid' = v_big::text then jsonb_set(x, '{amount}', to_jsonb((x ->> 'amount')::bigint + v_left)) else x end) from jsonb_array_elements(pays) x);
  update public.raids set status = 'done', started_at = now(), ends_at = v_ends, payouts = pays,
    result = jsonb_build_object('case', r.case_id, 'idx', d.outcome_idx, 'item', d.item_id, 'phase', d.phase, 'rarity', d.rarity, 'fi', d.fi, 'st', d.st, 'price', d.price)
    where id = r.id;
  update public.seeds set revealed_at = v_ends where id = r.seed_id;
  for sh in select (x ->> 'pid')::uuid pid, (x ->> 'amount')::bigint amt from jsonb_array_elements(pays) x loop
    insert into public.pending_credits (profile_id, amount, available_at, reason) values (sh.pid, sh.amt, v_ends, 'raid');
    perform game.bump(sh.pid, jsonb_build_object('raids', 1, 'raid_won', sh.amt));
    if coalesce((select amount from public.raid_shares where raid_id = r.id and profile_id = sh.pid), 0) * 10 >= r.target then
      update public.profiles set xp = xp + ((game.cfg('pass') #>> '{xp,raid}')::int * game.xpm()) where id = sh.pid;
    end if;
  end loop;
  if v_val >= r.target * 5 then
    perform game.add_chat(null, 'system', 'Рейд-кейс выбил предмет на ' || (v_val / 100) || ' монет — делим на всех участников');
  end if;
end $$;

create function public.raid_create(p_case text) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, game, pg_temp as $$
declare v_pid uuid := game.pid(); cfg jsonb := game.cfg('raid'); c public.cfg_cases; v_seed bigint; v_hash text; v_id uuid;
begin
  select * into c from cfg_cases where case_id = p_case;
  if not found or c.profile = 'free' then raise exception 'Нет такого кейса'; end if;
  if c.price < (cfg ->> 'min_case')::bigint then raise exception 'Для рейда нужен кейс от % монет', (cfg ->> 'min_case')::bigint / 100; end if;
  perform game.lock(v_pid);
  if (select count(*) from raids where creator = v_pid and status = 'open') >= (cfg ->> 'open_max')::int then raise exception 'Слишком много открытых рейдов'; end if;
  v_seed := game.new_seed(null);
  select hash into v_hash from seeds where id = v_seed;
  insert into raids (case_id, creator, target, seed_id, seed_hash) values (p_case, v_pid, c.price, v_seed, v_hash) returning id into v_id;
  return jsonb_build_object('raid', game.raid_view(v_id, v_pid), 'me', game.after(v_pid));
end $$;

create function public.raid_contribute(p_id uuid, p_amount bigint) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, game, pg_temp as $$
declare v_pid uuid := game.pid(); cfg jsonb := game.cfg('raid'); r public.raids; p public.profiles; v_take bigint;
begin
  select * into r from raids where id = p_id for update;
  if not found then raise exception 'Рейд не найден'; end if;
  if r.status <> 'open' then raise exception 'Рейд уже закончился или отменён'; end if;
  if cfg is null or p_amount is null or p_amount <= 0 or p_amount < (cfg ->> 'min_share')::bigint then raise exception 'Минимальный вклад — % монет', coalesce((cfg ->> 'min_share')::bigint, 100) / 100; end if;
  v_take := least(p_amount, r.target - r.pot);
  p := game.lock(v_pid);
  if p.balance < v_take then raise exception 'Недостаточно монет'; end if;
  update profiles set balance = balance - v_take where id = v_pid;
  insert into raid_shares (raid_id, profile_id, amount) values (r.id, v_pid, v_take)
    on conflict (raid_id, profile_id) do update set amount = raid_shares.amount + excluded.amount;
  update raids set pot = pot + v_take where id = r.id returning * into r;
  perform game.bump(v_pid, jsonb_build_object('spent', v_take));
  if r.pot >= r.target then perform game.raid_start(r.id); end if;
  return jsonb_build_object('raid', game.raid_view(r.id, v_pid), 'me', game.after(v_pid));
end $$;

create function public.raid_leave(p_id uuid) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, game, pg_temp as $$
declare v_pid uuid := game.pid(); r public.raids; v_amt bigint;
begin
  select * into r from raids where id = p_id for update;
  if not found then raise exception 'Рейд не найден'; end if;
  if r.status <> 'open' then raise exception 'Рейд уже закончился или отменён'; end if;
  delete from raid_shares where raid_id = r.id and profile_id = v_pid returning amount into v_amt;
  if v_amt is null then raise exception 'У тебя нет вклада в этом рейде'; end if;
  perform game.lock(v_pid);
  update profiles set balance = balance + v_amt where id = v_pid;
  update raids set pot = pot - v_amt where id = r.id;
  perform game.bump(v_pid, jsonb_build_object('spent', -v_amt));
  return jsonb_build_object('raid', game.raid_view(r.id, v_pid), 'me', game.after(v_pid));
end $$;

create function game.raid_refund(p_id uuid) returns void language plpgsql as $$
declare sh record;
begin
  for sh in select * from public.raid_shares where raid_id = p_id loop
    update public.profiles set balance = balance + sh.amount where id = sh.profile_id;
    perform game.bump(sh.profile_id, jsonb_build_object('spent', -sh.amount));
  end loop;
  delete from public.raid_shares where raid_id = p_id;
  update public.raids set status = 'cancelled', pot = 0 where id = p_id;
end $$;

create function public.raid_cancel(p_id uuid) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, game, pg_temp as $$
declare v_pid uuid := game.pid(); r public.raids;
begin
  select * into r from raids where id = p_id for update;
  if not found then raise exception 'Рейд не найден'; end if;
  if r.status <> 'open' then raise exception 'Рейд уже закончился или отменён'; end if;
  if r.creator <> v_pid then raise exception 'Отменить может только создатель'; end if;
  perform game.raid_refund(r.id);
  return jsonb_build_object('raid', game.raid_view(r.id, v_pid), 'me', game.after(v_pid));
end $$;

create function public.get_raid(p_id uuid) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, game, pg_temp as $$
declare v_pid uuid := game.pid(); v jsonb;
begin
  perform game.settle(v_pid);
  v := game.raid_view(p_id, v_pid);
  if v is null then raise exception 'Рейд не найден'; end if;
  return v;
end $$;

create function public.raid_list() returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, game, pg_temp as $$
declare v_pid uuid := game.pid();
begin
  return (select coalesce(jsonb_agg(game.raid_view(x.id, v_pid) order by x.created_at desc), '[]'::jsonb)
          from (select id, created_at from raids where status = 'open' or (status = 'done' and ends_at > now() - interval '3 minutes')
                order by created_at desc limit 20) x);
end $$;


-- =====================================================================================
--  АЛЬБОМ СКИНОВ: всё, что когда-либо оказывалось в инвентаре (даже проданное). Заполняет триггер.
-- =====================================================================================
create function game.collection_note() returns trigger language plpgsql as $$
begin
  insert into public.collection (profile_id, item_id) values (new.owner, new.item_id) on conflict do nothing;
  return new;
end $$;
drop trigger if exists collection_note on public.items;
create trigger collection_note after insert on public.items for each row execute function game.collection_note();
insert into public.collection (profile_id, item_id) select distinct owner, item_id from public.items on conflict do nothing;

create function public.collection_get() returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, game, pg_temp as $$
declare v_pid uuid := game.pid();
begin
  return jsonb_build_object(
    'items', (select coalesce(jsonb_agg(item_id), '[]'::jsonb) from collection where profile_id = v_pid),
    'claimed', (select coalesce(jsonb_agg(ref), '[]'::jsonb) from claims where profile_id = v_pid and kind = 'album'));
end $$;

-- Закрытый кейс: собраны все предметы кейса (в любой фазе и с любым износом). Награда выдаётся один раз.
create function public.collection_claim(p_case text) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, game, pg_temp as $$
declare v_pid uuid := game.pid(); c public.cfg_cases; v_need int; v_have int; v_reward bigint;
begin
  select * into c from cfg_cases where case_id = p_case;
  if not found or c.profile = 'free' then raise exception 'Нет такого кейса'; end if;
  select count(distinct item_id) into v_need from cfg_outcomes where case_id = p_case;
  select count(distinct o.item_id) into v_have from cfg_outcomes o join collection k on k.item_id = o.item_id and k.profile_id = v_pid where o.case_id = p_case;
  if v_have < v_need then raise exception 'Собрано % из % предметов', v_have, v_need; end if;
  perform game.lock(v_pid);
  insert into claims (profile_id, kind, ref) values (v_pid, 'album', p_case) on conflict do nothing;
  if not found then raise exception 'Награда за этот кейс уже получена'; end if;
  v_reward := c.price * (game.cfg('album') ->> 'reward_mult')::bigint;
  update profiles set balance = balance + v_reward where id = v_pid;
  perform game.bump(v_pid, jsonb_build_object('albums', 1));
  return jsonb_build_object('reward', v_reward, 'me', game.after(v_pid));
end $$;

-- =====================================================================================
--  ДОСТУП К ФУНКЦИЯМ: только вошедшим (authenticated), анонимной роли — ничего
-- =====================================================================================
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = any (array[
      'login','logout','sync','get_inventory','open_case','sell_items','sell_below','chat_send',
      'fair_state','fair_rotate','fair_set_client_seed','fair_rolls','leaderboard','get_profile','set_avatar',
      'upgrade','contract','battle_create','battle_join','battle_add_bot','battle_leave','get_battle',
      'coinflip_create','coinflip_join','coinflip_bot','coinflip_cancel','crash_state','crash_bet','crash_cashout','raid_create','raid_contribute','raid_leave','raid_cancel','raid_list','get_raid','collection_get','collection_claim',
      'claim','bonus_free_case','bonus_daily','bonus_second_chance','promo_redeem','rain_join'])
  loop
    execute 'revoke all on function ' || r.sig || ' from public, anon';
    execute 'grant execute on function ' || r.sig || ' to authenticated';
  end loop;
end $$;

-- Чтобы API Supabase сразу увидел новые функции.
notify pgrst, 'reload schema';
