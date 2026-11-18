-- iPlayStats class sessions: database setup (v0.6.0)
-- Paste all of this into Supabase > SQL Editor > New query, then press Run.
-- Safe to run again: it replaces the functions and keeps existing tables.
-- Stored: class code, team id (gauss / nightingale / fisher / bayes),
-- a random device id, game id and best score. No names, emails or IP addresses.

create table if not exists public.class_sessions (
  code        text primary key,
  teacher_key text not null,
  title       text not null default '',
  teams       int  not null default 4,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default now() + interval '8 hours'
);

create table if not exists public.class_scores (
  code       text not null references public.class_sessions(code) on delete cascade,
  device     text not null,
  team       text not null,
  game       text not null,
  score      int  not null,
  max_score  int  not null,
  updated_at timestamptz not null default now(),
  primary key (code, device, game)
);
create index if not exists class_sessions_exp on public.class_sessions (expires_at);

-- Nobody reads or writes the tables directly; only the functions below can.
alter table public.class_sessions enable row level security;
alter table public.class_scores  enable row level security;
revoke all on public.class_sessions from anon, authenticated;
revoke all on public.class_scores  from anon, authenticated;

-- Remove sessions that ended more than a day ago (runs whenever the app is used).
create or replace function public.ips_cleanup() returns void
language sql security definer set search_path = public as $$
  delete from class_sessions where expires_at < now() - interval '1 day';
$$;

create or replace function public.ips_norm(p text) returns text
language sql immutable as $$ select upper(regexp_replace(coalesce(p,''), '[^A-Za-z0-9]', '', 'g')) $$;

-- Teacher: start a session. Returns the class code and a private teacher key.
create or replace function public.create_session(p_title text default '', p_teams int default 4)
returns json language plpgsql security definer set search_path = public as $$
declare
  alphabet text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  c text; k text; i int; tries int := 0;
begin
  perform ips_cleanup();
  if (select count(*) from class_sessions where created_at > now() - interval '1 minute') > 30 then
    raise exception 'busy';
  end if;
  loop
    c := '';
    for i in 1..4 loop
      c := c || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    end loop;
    exit when not exists (select 1 from class_sessions where code = c);
    tries := tries + 1;
    if tries > 50 then raise exception 'no code'; end if;
  end loop;
  k := replace(gen_random_uuid()::text, '-', '');
  insert into class_sessions(code, teacher_key, title, teams)
  values (c, k, left(coalesce(p_title, ''), 60), greatest(2, least(4, coalesce(p_teams, 4))));
  return json_build_object('code', c, 'key', k,
    'teams', greatest(2, least(4, coalesce(p_teams, 4))),
    'expires', (select expires_at from class_sessions where code = c));
end $$;

-- Student: check a code before joining.
create or replace function public.join_session(p_code text)
returns json language plpgsql security definer set search_path = public as $$
declare s class_sessions;
begin
  perform ips_cleanup();
  select * into s from class_sessions where code = ips_norm(p_code) and expires_at > now();
  if not found then return json_build_object('ok', false); end if;
  return json_build_object('ok', true, 'code', s.code, 'title', s.title, 'teams', s.teams, 'expires', s.expires_at);
end $$;

-- Student: send a finished game's score. Keeps each device's best score per game.
create or replace function public.submit_score(p_code text, p_device text, p_team text, p_game text, p_score int, p_max int)
returns json language plpgsql security definer set search_path = public as $$
declare s class_sessions; c text := ips_norm(p_code);
begin
  select * into s from class_sessions where code = c and expires_at > now();
  if not found then return json_build_object('ok', false, 'reason', 'ended'); end if;
  if p_device !~ '^[A-Za-z0-9_-]{8,40}$' or p_game !~ '^[a-z0-9-]{2,40}$'
     or p_team not in ('gauss','nightingale','fisher','bayes')
     or p_score is null or p_max is null or p_score < 0 or p_max < 1 or p_max > 1000 or p_score > p_max then
    return json_build_object('ok', false, 'reason', 'invalid');
  end if;
  if (select count(distinct device) from class_scores where code = c) >= 300
     and not exists (select 1 from class_scores where code = c and device = p_device) then
    return json_build_object('ok', false, 'reason', 'full');
  end if;
  update class_scores set team = p_team where code = c and device = p_device and team <> p_team;
  insert into class_scores(code, device, team, game, score, max_score)
  values (c, p_device, p_team, p_game, p_score, p_max)
  on conflict (code, device, game) do update
    set score = greatest(class_scores.score, excluded.score),
        max_score = excluded.max_score, team = excluded.team, updated_at = now();
  return json_build_object('ok', true);
end $$;

-- Anyone with the code: the team board. Team score = average of members' points.
create or replace function public.session_board(p_code text, p_game text default null)
returns json language plpgsql security definer set search_path = public as $$
declare s class_sessions; c text := ips_norm(p_code);
begin
  select * into s from class_sessions where code = c;
  if not found or s.expires_at < now() then return json_build_object('ok', false); end if;
  return json_build_object('ok', true, 'code', s.code, 'title', s.title, 'teams', s.teams, 'expires', s.expires_at,
    'games', coalesce((select json_agg(distinct game) from class_scores where code = c), '[]'::json),
    'board', coalesce((
      select json_agg(row_to_json(t)) from (
        select team, count(distinct device) as players, sum(score)::int as total,
               round(sum(score)::numeric / count(distinct device), 1) as average,
               count(*) as finishes
        from class_scores
        where code = c and (p_game is null or game = p_game)
        group by team) t), '[]'::json));
end $$;

-- Teacher: clear the scores but keep the code (a new round).
create or replace function public.reset_session(p_code text, p_key text)
returns json language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from class_sessions where code = ips_norm(p_code) and teacher_key = p_key) then
    return json_build_object('ok', false);
  end if;
  delete from class_scores where code = ips_norm(p_code);
  return json_build_object('ok', true);
end $$;

-- Teacher: end the session and delete all of its scores now.
create or replace function public.end_session(p_code text, p_key text)
returns json language plpgsql security definer set search_path = public as $$
begin
  delete from class_sessions where code = ips_norm(p_code) and teacher_key = p_key;
  return json_build_object('ok', found);
end $$;

revoke execute on all functions in schema public from public;
grant execute on function public.create_session(text, int) to anon, authenticated;
grant execute on function public.join_session(text) to anon, authenticated;
grant execute on function public.submit_score(text, text, text, text, int, int) to anon, authenticated;
grant execute on function public.session_board(text, text) to anon, authenticated;
grant execute on function public.reset_session(text, text) to anon, authenticated;
grant execute on function public.end_session(text, text) to anon, authenticated;
