-- ===================== Nuvvo hardening (safe to run more than once) =====================
-- 0) function lockdown: Supabase grants EXECUTE on every new function to "authenticated" by default,
--    which let any user call internal helpers directly (e.g. notify() to send fake notifications, xp_of() for anyone).
alter default privileges in schema public revoke execute on functions from anon, authenticated, public;
revoke execute on all functions in schema public from anon, authenticated, public;
grant execute on function feed_posts, summaries_list, reels_list, answers_list, toggle_like, review_card,
  add_study, my_stats, leaderboard, study_recent, delete_me, my_blocked to authenticated;
grant execute on function current_week, blocked_between, can_see, is_frozen, in_group, in_project to authenticated;

-- 1) file paths must be exactly  <your user id>/<uuid>  (blocks "../" tricks and other people's paths)
alter table profiles  drop constraint if exists profiles_avatar_owner;
alter table profiles  add  constraint profiles_avatar_owner  check (avatar_path is null or avatar_path ~ ('^' || id::text      || '/[0-9a-f-]{36}$'));
alter table posts     drop constraint if exists posts_img_owner;
alter table posts     add  constraint posts_img_owner        check (img_path    is null or img_path    ~ ('^' || user_id::text || '/[0-9a-f-]{36}$'));
alter table summaries drop constraint if exists summaries_file_owner;
alter table summaries add  constraint summaries_file_owner   check (file_path   is null or file_path   ~ ('^' || user_id::text || '/[0-9a-f-]{36}$'));
alter table reels     drop constraint if exists reels_file_owner;
alter table reels     add  constraint reels_file_owner       check (file_path ~ ('^' || user_id::text || '/[0-9a-f-]{36}$'));
alter table summaries drop constraint if exists summaries_names_len;
alter table summaries add  constraint summaries_names_len    check (char_length(file_name) <= 200 and char_length(file_type) <= 100);

-- 2) anti-spam: limit how many rows one user can create per minute
create or replace function rate_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare col text := tg_argv[0]; lim int := tg_argv[1]::int; uid uuid; n int;
begin
  uid := (to_jsonb(new) ->> col)::uuid;
  execute format('select count(*) from %I.%I where %I = $1 and created > now() - interval ''1 minute''', tg_table_schema, tg_table_name, col)
    into n using uid;
  if n >= lim then raise exception 'بتعمل حاجات كتير بسرعة، استنى شوية وجرّب تاني'; end if;
  return new;
end $$;
revoke execute on function rate_guard() from public, anon, authenticated;

drop trigger if exists rl on posts;      create trigger rl before insert on posts      for each row execute function rate_guard('user_id', 10);
drop trigger if exists rl on comments;   create trigger rl before insert on comments   for each row execute function rate_guard('user_id', 20);
drop trigger if exists rl on dms;        create trigger rl before insert on dms        for each row execute function rate_guard('from_id', 30);
drop trigger if exists rl on group_msgs; create trigger rl before insert on group_msgs for each row execute function rate_guard('user_id', 30);
drop trigger if exists rl on questions;  create trigger rl before insert on questions  for each row execute function rate_guard('user_id', 5);
drop trigger if exists rl on answers;    create trigger rl before insert on answers    for each row execute function rate_guard('user_id', 10);
drop trigger if exists rl on follows;    create trigger rl before insert on follows    for each row execute function rate_guard('follower', 30);
drop trigger if exists rl on reels;      create trigger rl before insert on reels      for each row execute function rate_guard('user_id', 5);
drop trigger if exists rl on summaries;  create trigger rl before insert on summaries  for each row execute function rate_guard('user_id', 5);
drop trigger if exists rl on groups;     create trigger rl before insert on groups     for each row execute function rate_guard('owner', 3);
drop trigger if exists rl on projects;   create trigger rl before insert on projects   for each row execute function rate_guard('owner', 3);

-- 3) uploads: exact path shape + a storage quota of 500 MB per user
drop policy if exists files_ins on storage.objects;
create policy files_ins on storage.objects for insert to authenticated
  with check (
    bucket_id = 'files'
    and name ~ ('^' || auth.uid()::text || '/[0-9a-f-]{36}$')
    and (select coalesce(sum((o.metadata ->> 'size')::bigint), 0) from storage.objects o
         where o.bucket_id = 'files' and (storage.foldername(o.name))[1] = auth.uid()::text) < 524288000);

-- 4) people lists show only users who really finished sign-up (confirmed the e-mail code or came through Google/Microsoft/GitHub)
alter table profiles add column if not exists verified boolean not null default false;
update profiles p set verified = true from auth.users u where u.id = p.id and u.email_confirmed_at is not null;

create or replace function on_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare base text; cand text; n int := 0;
begin
  if coalesce(new.raw_app_meta_data ->> 'provider', 'email') = 'email' then
    -- email sign-up: use exactly the chosen name (a duplicate makes sign-up fail, the app shows a message)
    insert into profiles(id, name, verified) values (new.id, trim(coalesce(new.raw_user_meta_data ->> 'name', '')), new.email_confirmed_at is not null);
  else
    -- Google / Microsoft / GitHub: take the provider's name, shorten it and add digits if it is taken
    base := left(trim(coalesce(nullif(new.raw_user_meta_data ->> 'name', ''), nullif(new.raw_user_meta_data ->> 'full_name', ''),
                               nullif(split_part(coalesce(new.email, ''), '@', 1), ''), 'user')), 24);
    if char_length(base) < 2 then base := 'user' || base; end if;
    cand := base;
    while exists(select 1 from profiles where lower(name) = lower(cand)) and n < 30 loop
      n := n + 1;
      cand := base || (1000 + floor(random() * 9000))::int::text;
    end loop;
    insert into profiles(id, name, verified) values (new.id, cand, true);
  end if;
  return new;
end $$;

create or replace function on_user_confirmed() returns trigger
language plpgsql security definer set search_path = public as $$
begin update profiles set verified = true where id = new.id; return new; end $$;
revoke execute on function on_user_confirmed() from public, anon, authenticated;
drop trigger if exists t_user_confirmed on auth.users;
create trigger t_user_confirmed after update of email_confirmed_at on auth.users
  for each row when (old.email_confirmed_at is null and new.email_confirmed_at is not null) execute function on_user_confirmed();

drop policy if exists p_sel on profiles;
create policy p_sel on profiles for select to authenticated
  using (id = auth.uid() or (verified and not disabled and not blocked_between(auth.uid(), id)));

create or replace function leaderboard()
returns table(id uuid, name text, avatar_path text, xp bigint, level int)
language sql stable security definer set search_path = public as $$
  select * from (
    select u.id, u.name, u.avatar_path, xp_of(u.id) as xp, (floor(sqrt(xp_of(u.id) / 25.0)) + 1)::int as level
    from profiles u where not u.disabled and u.verified
  ) t order by xp desc limit 10
$$;

-- unfinished sign-ups are deleted after 1 day so they do not keep a username reserved
create or replace function purge_unverified() returns void
language sql security definer set search_path = public, auth as $$
  delete from auth.users u using profiles p
   where p.id = u.id and not p.verified and u.created_at < now() - interval '1 day'
$$;
revoke execute on function purge_unverified() from public, anon, authenticated;
do $$ begin
  create extension if not exists pg_cron;
  perform cron.unschedule('purge-unverified') where exists (select 1 from cron.job where jobname = 'purge-unverified');
  perform cron.schedule('purge-unverified', '17 3 * * *', 'select public.purge_unverified()');
exception when others then
  raise notice 'pg_cron is not available here: run  select purge_unverified();  by hand now and then (%).', sqlerrm;
end $$;

-- 5) reports: any user can report a post / user / comment. Users cannot read reports back; you read them in Table Editor > reports.
create table if not exists reports (
  id uuid primary key default gen_random_uuid(),
  reporter uuid not null references profiles on delete cascade default auth.uid(),
  kind text not null check (kind in ('post','user','comment')),
  target_id uuid not null,
  reason text not null check (reason in ('spam','abuse','inappropriate','other')),
  note text not null default '' check (char_length(note) <= 300),
  created timestamptz not null default now(),
  unique (reporter, kind, target_id)
);
create index if not exists reports_created on reports (created desc);
alter table reports enable row level security;
drop policy if exists rp_ins on reports;
create policy rp_ins on reports for insert to authenticated with check (reporter = auth.uid());
revoke all on reports from anon, authenticated;
grant insert on reports to authenticated;
drop trigger if exists rl on reports; create trigger rl before insert on reports for each row execute function rate_guard('reporter', 10);

-- 6) private groups: only members see a group; people join with an invite code
alter table groups add column if not exists code text not null default substr(replace(gen_random_uuid()::text, '-', ''), 1, 10);
create unique index if not exists groups_code_key on groups (code);
revoke select on groups from authenticated;
grant select (id, name, owner, created) on groups to authenticated;           -- the code column is NOT readable directly

drop policy if exists g_sel on groups;
create policy g_sel on groups for select to authenticated using (owner = auth.uid() or in_group(id));
drop policy if exists gm_sel on group_members;
create policy gm_sel on group_members for select to authenticated using (user_id = auth.uid() or in_group(group_id));
drop policy if exists gm_ins on group_members;                                  -- joining only through join_group()

create or replace function join_group(p_code text) returns uuid
language plpgsql security definer set search_path = public as $$
declare g uuid;
begin
  select id into g from groups where code = lower(trim(coalesce(p_code, '')));
  if g is null then raise exception 'الكود غلط'; end if;
  insert into group_members(group_id, user_id) values (g, auth.uid()) on conflict do nothing;
  return g;
end $$;

create or replace function group_code(p_group uuid) returns text
language sql stable security definer set search_path = public as $$
  select code from groups where id = p_group and owner = auth.uid()
$$;
revoke execute on function join_group(text), group_code(uuid) from public, anon;
grant execute on function join_group(text), group_code(uuid) to authenticated;

-- 7) exam reminders (called once per session by the app) + realtime for chat and notifications
create or replace function exam_reminders() returns void
language plpgsql security definer set search_path = public as $$
declare e record; txt text;
begin
  for e in select name, date from exams where user_id = auth.uid() and date between current_date and current_date + 2 loop
    txt := 'امتحان ' || e.name || case when e.date = current_date then ' النهاردة' when e.date = current_date + 1 then ' بكرة' else ' بعد يومين' end || '، ذاكر كويس';
    if not exists (select 1 from notifications where user_id = auth.uid() and text = txt and created > now() - interval '20 hours') then
      perform notify(auth.uid(), 'exams', txt, null);
    end if;
  end loop;
end $$;
revoke execute on function exam_reminders() from public, anon;
grant execute on function exam_reminders() to authenticated;

do $$ declare t text; begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['dms', 'group_msgs', 'notifications'] loop
      begin execute format('alter publication supabase_realtime add table public.%I', t);
      exception when duplicate_object then null; end;
    end loop;
  end if;
end $$;

-- 8) moderation: people listed in `mods` can review reports and remove reported posts/comments from the app.
--    Add yourself once in the SQL editor:  insert into mods(user_id) select id from auth.users where email = 'you@example.com';
create table if not exists mods (user_id uuid primary key references profiles on delete cascade);
alter table mods enable row level security;
revoke all on mods from anon, authenticated;

create or replace function is_mod() returns boolean
language sql stable security definer set search_path = public as $$ select exists (select 1 from mods where user_id = auth.uid()) $$;

create or replace function mod_reports() returns table (id uuid, kind text, target_id uuid, reason text, note text, created timestamptz, reporter_name text, preview text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_mod() then raise exception 'مش مسموح'; end if;
  return query
    select r.id, r.kind, r.target_id, r.reason, r.note, r.created, rp.name,
      case r.kind
        when 'post' then (select left(p.text, 200) from posts p where p.id = r.target_id)
        when 'comment' then (select left(c.text, 200) from comments c where c.id = r.target_id)
        when 'user' then (select pr.name from profiles pr where pr.id = r.target_id)
      end
    from reports r join profiles rp on rp.id = r.reporter
    order by r.created desc limit 100;
end $$;

create or replace function mod_resolve(p_report uuid, p_remove boolean) returns void
language plpgsql security definer set search_path = public as $$
declare r reports;
begin
  if not is_mod() then raise exception 'مش مسموح'; end if;
  select * into r from reports where id = p_report;
  if r.id is null then return; end if;
  if p_remove then
    if r.kind = 'post' then delete from posts where id = r.target_id;
    elsif r.kind = 'comment' then delete from comments where id = r.target_id;
    end if;
  end if;
  delete from reports where kind = r.kind and target_id = r.target_id;   -- closes every report about the same item
end $$;

revoke execute on function is_mod(), mod_reports(), mod_resolve(uuid, boolean) from public, anon;
grant execute on function is_mod(), mod_reports(), mod_resolve(uuid, boolean) to authenticated;

-- 9) personal 11-digit number (chosen by the user, used to find people), profile banner, and stale-reel clean-up
alter table profiles add column if not exists banner_path text;
do $$ begin
  alter table profiles add constraint profiles_banner_owner check (banner_path is null or banner_path ~ ('^' || id::text || '/[0-9a-f-]{36}$'));
exception when duplicate_object then null; end $$;
grant update (banner_path) on profiles to authenticated;

create table if not exists user_numbers (
  user_id uuid primary key references profiles on delete cascade,
  num text not null unique check (num ~ '^[0-9]{11}$')
);
alter table user_numbers enable row level security;
revoke all on user_numbers from anon, authenticated;                 -- nobody can list numbers; only the functions below touch the table
create table if not exists number_lookups (user_id uuid not null, created timestamptz not null default now());
create index if not exists number_lookups_u on number_lookups (user_id, created desc);
alter table number_lookups enable row level security;
revoke all on number_lookups from anon, authenticated;

create or replace function my_number() returns text
language sql stable security definer set search_path = public as $$ select num from user_numbers where user_id = auth.uid() $$;

create or replace function set_number(p_num text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'مش مسموح'; end if;
  p_num := trim(coalesce(p_num, ''));
  if p_num = '' then delete from user_numbers where user_id = auth.uid(); return; end if;
  if p_num !~ '^[0-9]{11}$' then raise exception 'الرقم لازم يكون ١١ رقم'; end if;
  insert into number_lookups(user_id) values (auth.uid());
  if (select count(*) from number_lookups where user_id = auth.uid() and created > now() - interval '10 minutes') > 30 then
    raise exception 'بتعمل حاجات كتير بسرعة، استنى شوية وجرّب تاني';
  end if;
  begin
    insert into user_numbers(user_id, num) values (auth.uid(), p_num) on conflict (user_id) do update set num = excluded.num;
  exception when unique_violation then raise exception 'الرقم ده مستخدم';
  end;
end $$;

create or replace function find_by_number(p_num text) returns table (id uuid, name text, avatar_path text, bio text)
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'مش مسموح'; end if;
  if trim(coalesce(p_num, '')) !~ '^[0-9]{11}$' then raise exception 'الرقم لازم يكون ١١ رقم'; end if;
  insert into number_lookups(user_id) values (auth.uid());
  if (select count(*) from number_lookups where user_id = auth.uid() and created > now() - interval '10 minutes') > 30 then
    raise exception 'بتعمل حاجات كتير بسرعة، استنى شوية وجرّب تاني';
  end if;
  return query
    select p.id, p.name, p.avatar_path, p.bio from user_numbers n join profiles p on p.id = n.user_id
     where n.num = trim(p_num) and p.id <> auth.uid() and not p.disabled and not blocked_between(auth.uid(), p.id);
end $$;
revoke execute on function my_number(), set_number(text), find_by_number(text) from public, anon;
grant execute on function my_number(), set_number(text), find_by_number(text) to authenticated;

-- a reel with no likes after 30 days is removed. The database row goes; the video file stays in Storage until you delete the paths listed in orphan_files
create table if not exists orphan_files (path text primary key, created timestamptz not null default now());
alter table orphan_files enable row level security;
revoke all on orphan_files from anon, authenticated;
create or replace function purge_stale_reels() returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  with d as (
    delete from reels r where r.created < now() - interval '30 days'
       and not exists (select 1 from likes l where l.kind = 'reel' and l.target_id = r.id)
    returning r.file_path)
  insert into orphan_files(path) select file_path from d on conflict do nothing;
  get diagnostics n = row_count;
  return n;
end $$;
revoke execute on function purge_stale_reels() from public, anon, authenticated;
do $$ begin
  create extension if not exists pg_cron;
  perform cron.unschedule('purge-stale-reels') where exists (select 1 from cron.job where jobname = 'purge-stale-reels');
  perform cron.schedule('purge-stale-reels', '41 3 * * *', 'select public.purge_stale_reels()');
exception when others then
  raise notice 'pg_cron is not available here: run  select purge_stale_reels();  by hand now and then (%).', sqlerrm;
end $$;

-- 10) open one post by its id (used by shared links). SECURITY INVOKER, so row-level security and blocks still apply.
create or replace function post_by_id(p_id uuid)
returns table(id uuid, text text, img_path text, created timestamptz, uid uuid, name text, avatar_path text,
              likes bigint, liked boolean, comments bigint, saved boolean, following boolean)
language sql stable set search_path = public as $$
  select p.id, p.text, p.img_path, p.created, a.id, a.name, a.avatar_path,
    (select count(*) from likes l where l.kind = 'post' and l.target_id = p.id),
    exists(select 1 from likes l where l.kind = 'post' and l.target_id = p.id and l.user_id = auth.uid()),
    (select count(*) from comments c where c.post_id = p.id),
    exists(select 1 from saves s where s.post_id = p.id and s.user_id = auth.uid()),
    exists(select 1 from follows f where f.follower = auth.uid() and f.followee = a.id)
  from posts p join profiles a on a.id = p.user_id
  where p.id = p_id
$$;
revoke execute on function post_by_id(uuid) from public, anon;
grant execute on function post_by_id(uuid) to authenticated;

-- 11) admin panel, subscriptions, business accounts
--    Make yourself the admin once (SQL editor):  insert into admins(user_id) select id from auth.users where email = 'you@example.com';
create table if not exists admins (user_id uuid primary key references profiles on delete cascade);
alter table admins enable row level security;
revoke all on admins from anon, authenticated;

create or replace function is_admin() returns boolean
language sql stable security definer set search_path = public as $$ select exists (select 1 from admins where user_id = auth.uid()) $$;
create or replace function is_mod() returns boolean                         -- admins can do everything moderators can
language sql stable security definer set search_path = public as $$ select exists (select 1 from mods where user_id = auth.uid()) or exists (select 1 from admins where user_id = auth.uid()) $$;

create table if not exists admin_log (
  id bigint generated always as identity primary key,
  admin uuid not null, action text not null, target uuid, detail text not null default '', created timestamptz not null default now());
alter table admin_log enable row level security;
revoke all on admin_log from anon, authenticated;

-- banned accounts can still sign in and read, but every write is refused and they disappear from people lists
alter table profiles add column if not exists banned boolean not null default false;
drop policy if exists p_sel on profiles;
create policy p_sel on profiles for select to authenticated
  using (id = auth.uid() or (verified and not disabled and not banned and not blocked_between(auth.uid(), id)));
create or replace function rate_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare col text := tg_argv[0]; lim int := tg_argv[1]::int; uid uuid; n int;
begin
  uid := (to_jsonb(new) ->> col)::uuid;
  if exists (select 1 from profiles where id = uid and banned) then raise exception 'حسابك موقوف'; end if;
  execute format('select count(*) from %I.%I where %I = $1 and created > now() - interval ''1 minute''', tg_table_schema, tg_table_name, col)
    into n using uid;
  if n >= lim then raise exception 'بتعمل حاجات كتير بسرعة، استنى شوية وجرّب تاني'; end if;
  return new;
end $$;
revoke execute on function rate_guard() from public, anon, authenticated;

-- plans and subscriptions. Payment is manual for now: the user pays you (transfer, wallet...), sends the reference, you approve it in the panel.
create table if not exists plans (
  id text primary key, name text not null, price_egp int not null check (price_egp >= 0),
  days int not null check (days > 0), quota_mb int not null check (quota_mb > 0), active boolean not null default true);
insert into plans(id, name, price_egp, days, quota_mb) values
  ('plus', 'طالب بلس', 29, 30, 2048),
  ('business', 'حساب تجاري', 199, 30, 5120)
  on conflict (id) do nothing;
alter table plans enable row level security;
revoke all on plans from anon, authenticated; grant select on plans to authenticated;
drop policy if exists plans_sel on plans; create policy plans_sel on plans for select to authenticated using (active);

create table if not exists subscriptions (
  user_id uuid primary key references profiles on delete cascade,
  plan text not null references plans, expires timestamptz not null, created timestamptz not null default now());
alter table subscriptions enable row level security;
revoke all on subscriptions from anon, authenticated; grant select on subscriptions to authenticated;
drop policy if exists subs_sel on subscriptions; create policy subs_sel on subscriptions for select to authenticated using (user_id = auth.uid());

create table if not exists sub_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles on delete cascade default auth.uid(),
  plan text not null references plans,
  ref text not null check (char_length(ref) between 3 and 120),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created timestamptz not null default now());
create unique index if not exists sub_requests_one_pending on sub_requests (user_id) where status = 'pending';
alter table sub_requests enable row level security;
revoke all on sub_requests from anon, authenticated; grant select on sub_requests to authenticated; grant insert (plan, ref) on sub_requests to authenticated;
drop policy if exists sr_sel on sub_requests; create policy sr_sel on sub_requests for select to authenticated using (user_id = auth.uid());
drop policy if exists sr_ins on sub_requests; create policy sr_ins on sub_requests for insert to authenticated with check (user_id = auth.uid());
drop trigger if exists rl on sub_requests; create trigger rl before insert on sub_requests for each row execute function rate_guard('user_id', 3);

create or replace function my_plan() returns text
language sql stable security definer set search_path = public as $$
  select coalesce((select plan from subscriptions where user_id = auth.uid() and expires > now()), 'free') $$;

-- storage quota follows the plan: 500 MB free, more on a paid plan
create or replace function quota_bytes() returns bigint
language sql stable security definer set search_path = public as $$
  select coalesce((select p.quota_mb::bigint * 1048576 from subscriptions s join plans p on p.id = s.plan where s.user_id = auth.uid() and s.expires > now()), 524288000) $$;
drop policy if exists files_ins on storage.objects;
create policy files_ins on storage.objects for insert to authenticated
  with check (
    bucket_id = 'files'
    and name ~ ('^' || auth.uid()::text || '/[0-9a-f-]{36}$')
    and (select coalesce(sum((o.metadata ->> 'size')::bigint), 0) from storage.objects o
         where o.bucket_id = 'files' and (storage.foldername(o.name))[1] = auth.uid()::text) < quota_bytes());

-- business accounts: anyone can apply; a blue tick only after an admin approves. Changing the name or website sends it back to review.
create table if not exists businesses (
  user_id uuid primary key references profiles on delete cascade default auth.uid(),
  name text not null check (char_length(name) between 2 and 60),
  category text not null default '' check (char_length(category) <= 40),
  description text not null default '' check (char_length(description) <= 300),
  website text not null default '' check (website = '' or (website ~ '^https?://[^ ]+$' and char_length(website) <= 120)),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  verified boolean not null default false,
  created timestamptz not null default now());
alter table businesses enable row level security;
revoke all on businesses from anon, authenticated;
grant select on businesses to authenticated;
grant insert (user_id, name, category, description, website) on businesses to authenticated;
grant update (name, category, description, website) on businesses to authenticated;
drop policy if exists biz_sel on businesses; create policy biz_sel on businesses for select to authenticated using (user_id = auth.uid());
drop policy if exists biz_ins on businesses; create policy biz_ins on businesses for insert to authenticated with check (user_id = auth.uid());
drop policy if exists biz_upd on businesses; create policy biz_upd on businesses for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create or replace function biz_review() returns trigger language plpgsql as $$
begin
  if new.name is distinct from old.name or new.website is distinct from old.website then new.status := 'pending'; new.verified := false; end if;
  return new;
end $$;
drop trigger if exists biz_review on businesses; create trigger biz_review before update on businesses for each row execute function biz_review();

-- admin functions: every one checks is_admin() itself and writes to admin_log
create or replace function admin_guard() returns void language plpgsql stable security definer set search_path = public as $$
begin if not is_admin() then raise exception 'مش مسموح'; end if; end $$;

create or replace function admin_stats() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform admin_guard();
  return jsonb_build_object(
    'users', (select count(*) from profiles),
    'new_7d', (select count(*) from profiles where created > now() - interval '7 days'),
    'posts', (select count(*) from posts), 'reels', (select count(*) from reels), 'summaries', (select count(*) from summaries),
    'reports', (select count(*) from reports),
    'subs', (select count(*) from subscriptions where expires > now()),
    'requests', (select count(*) from sub_requests where status = 'pending'),
    'biz_pending', (select count(*) from businesses where status = 'pending'),
    'banned', (select count(*) from profiles where banned));
end $$;

create or replace function admin_users(p_q text default '')
returns table (id uuid, name text, email text, created timestamptz, banned boolean, plan text, expires timestamptz)
language plpgsql stable security definer set search_path = public, auth as $$
begin
  perform admin_guard();
  return query
    select p.id, p.name, u.email::text, p.created, p.banned, s.plan, s.expires
    from profiles p join auth.users u on u.id = p.id left join subscriptions s on s.user_id = p.id
    where p_q = '' or p.name ilike '%' || replace(replace(replace(p_q, '\', '\\'), '%', '\%'), '_', '\_') || '%'
       or u.email ilike '%' || replace(replace(replace(p_q, '\', '\\'), '%', '\%'), '_', '\_') || '%'
    order by p.created desc limit 50;
end $$;

create or replace function admin_set_banned(p_user uuid, p_banned boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform admin_guard();
  if exists (select 1 from admins where user_id = p_user) then raise exception 'مش مسموح'; end if;
  update profiles set banned = p_banned where id = p_user;
  insert into admin_log(admin, action, target) values (auth.uid(), case when p_banned then 'ban' else 'unban' end, p_user);
end $$;

create or replace function admin_grant(p_user uuid, p_plan text, p_days int default null) returns void
language plpgsql security definer set search_path = public as $$
declare d int; base timestamptz;
begin
  perform admin_guard();
  select days into d from plans where id = p_plan; if d is null then raise exception 'الباقة مش موجودة'; end if;
  d := least(greatest(coalesce(p_days, d), 1), 3650);
  select case when plan = p_plan and expires > now() then expires else now() end into base from subscriptions where user_id = p_user;
  insert into subscriptions(user_id, plan, expires) values (p_user, p_plan, coalesce(base, now()) + make_interval(days => d))
    on conflict (user_id) do update set plan = excluded.plan, expires = excluded.expires;
  insert into admin_log(admin, action, target, detail) values (auth.uid(), 'grant', p_user, p_plan || ' ' || d || 'd');
end $$;

create or replace function admin_revoke(p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform admin_guard();
  delete from subscriptions where user_id = p_user;
  insert into admin_log(admin, action, target) values (auth.uid(), 'revoke', p_user);
end $$;

create or replace function admin_requests() returns table (id uuid, user_id uuid, name text, plan text, ref text, created timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  perform admin_guard();
  return query select r.id, r.user_id, p.name, r.plan, r.ref, r.created from sub_requests r join profiles p on p.id = r.user_id where r.status = 'pending' order by r.created limit 100;
end $$;

create or replace function admin_decide_request(p_id uuid, p_approve boolean) returns void
language plpgsql security definer set search_path = public as $$
declare r sub_requests;
begin
  perform admin_guard();
  select * into r from sub_requests where id = p_id and status = 'pending'; if r.id is null then return; end if;
  update sub_requests set status = case when p_approve then 'approved' else 'rejected' end where id = p_id;
  if p_approve then perform admin_grant(r.user_id, r.plan, null); end if;
  insert into admin_log(admin, action, target, detail) values (auth.uid(), case when p_approve then 'approve_request' else 'reject_request' end, r.user_id, r.plan);
end $$;

drop function if exists admin_businesses();
create function admin_businesses() returns table (user_id uuid, owner text, name text, category text, description text, website text, status text, verified boolean, created timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  perform admin_guard();
  return query select b.user_id, p.name, b.name, b.category, b.description, b.website, b.status, b.verified, b.created
    from businesses b join profiles p on p.id = b.user_id order by (b.status = 'pending') desc, b.created desc limit 100;
end $$;

create or replace function admin_decide_business(p_user uuid, p_approve boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform admin_guard();
  update businesses set status = case when p_approve then 'approved' else 'rejected' end, verified = p_approve where user_id = p_user;
  insert into admin_log(admin, action, target) values (auth.uid(), case when p_approve then 'approve_business' else 'reject_business' end, p_user);
end $$;

revoke execute on function admin_guard(), is_admin(), my_plan(), quota_bytes(), admin_stats(), admin_users(text), admin_set_banned(uuid, boolean), admin_grant(uuid, text, int),
  admin_revoke(uuid), admin_requests(), admin_decide_request(uuid, boolean), admin_businesses(), admin_decide_business(uuid, boolean), is_mod() from public, anon;
grant execute on function is_admin(), my_plan(), is_mod(), admin_stats(), admin_users(text), admin_set_banned(uuid, boolean), admin_grant(uuid, text, int),
  admin_revoke(uuid), admin_requests(), admin_decide_request(uuid, boolean), admin_businesses(), admin_decide_business(uuid, boolean) to authenticated;
revoke execute on function admin_guard() from authenticated;
grant execute on function quota_bytes() to authenticated;   -- used by the storage policy; returns only the caller's own limit

-- 12) the business plan costs 200 EGP and a business can only be verified while that plan is active
insert into plans(id, name, price_egp, days, quota_mb) values ('business', 'حساب تجاري', 200, 30, 5120)
  on conflict (id) do update set price_egp = 200 where plans.price_egp = 199;

drop function if exists admin_businesses();
create function admin_businesses() returns table (user_id uuid, owner text, name text, category text, description text, website text, status text, verified boolean, created timestamptz, paid boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  perform admin_guard();
  return query select b.user_id, p.name, b.name, b.category, b.description, b.website, b.status, b.verified, b.created,
      exists (select 1 from subscriptions s where s.user_id = b.user_id and s.plan = 'business' and s.expires > now())
    from businesses b join profiles p on p.id = b.user_id order by (b.status = 'pending') desc, b.created desc limit 100;
end $$;
revoke execute on function admin_businesses() from public, anon; grant execute on function admin_businesses() to authenticated;

create or replace function admin_decide_business(p_user uuid, p_approve boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform admin_guard();
  if p_approve and not exists (select 1 from subscriptions where user_id = p_user and plan = 'business' and expires > now()) then
    raise exception 'لازم يدفع ٢٠٠ جنيه ويتفعّل اشتراك الحساب التجاري الأول';
  end if;
  update businesses set status = case when p_approve then 'approved' else 'rejected' end, verified = p_approve where user_id = p_user;
  insert into admin_log(admin, action, target) values (auth.uid(), case when p_approve then 'approve_business' else 'reject_business' end, p_user);
end $$;

-- 13) group settings: description, rename, new invite code, remove a member (owner only)
alter table groups add column if not exists description text not null default '' check (char_length(description) <= 200);
grant select (description) on groups to authenticated;
grant update (name, description) on groups to authenticated;
drop policy if exists g_upd on groups;
create policy g_upd on groups for update to authenticated using (owner = auth.uid()) with check (owner = auth.uid());

create or replace function regen_group_code(p_group uuid) returns text
language plpgsql security definer set search_path = public as $$
declare c text := substr(replace(gen_random_uuid()::text, '-', ''), 1, 10);
begin
  update groups set code = c where id = p_group and owner = auth.uid();
  if not found then raise exception 'مش مسموح'; end if;
  return c;
end $$;

create or replace function kick_member(p_group uuid, p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from groups where id = p_group and owner = auth.uid()) then raise exception 'مش مسموح'; end if;
  if p_user = auth.uid() then raise exception 'مش مسموح'; end if;
  delete from group_members where group_id = p_group and user_id = p_user;
end $$;
revoke execute on function regen_group_code(uuid), kick_member(uuid, uuid) from public, anon;
grant execute on function regen_group_code(uuid), kick_member(uuid, uuid) to authenticated;

-- ===================== 14. Egyptian curriculum: math subject renamed =====================
-- The subject list now follows the Ministry stages; "رياضة" (old value for maths) becomes "رياضيات".
update summaries set subject = 'رياضيات' where subject = 'رياضة';

-- ===================== 15. Past papers, best answer, verified tick, study board, trends, push =====================
-- 15a) summaries can be "past exam papers" with the exam year
alter table summaries add column if not exists kind text not null default 'sum';
alter table summaries add column if not exists exam_year smallint;
alter table summaries drop constraint if exists summaries_kind_chk;
alter table summaries add constraint summaries_kind_chk check (kind in ('sum', 'exam') and (exam_year is null or exam_year between 2000 and 2100));

drop function if exists summaries_list(text, text, text, text);
drop function if exists summaries_list(text, text, text, text, text);
create function summaries_list(p_subject text default '', p_year text default '', p_q text default '', p_sort text default 'new', p_kind text default 'sum')
returns table(id uuid, title text, subject text, year text, file_path text, file_name text, file_type text,
              created timestamptz, uid uuid, name text, likes bigint, liked boolean, kind text, exam_year smallint)
language sql stable set search_path = public as $$
  select * from (
    select s.id, s.title, s.subject, s.year, s.file_path, s.file_name, s.file_type, s.created, u.id as uid, u.name,
      (select count(*) from likes l where l.kind = 'summary' and l.target_id = s.id) as likes,
      exists(select 1 from likes l where l.kind = 'summary' and l.target_id = s.id and l.user_id = auth.uid()) as liked,
      s.kind, s.exam_year
    from summaries s join profiles u on u.id = s.user_id
    where s.kind = case when p_kind = 'exam' then 'exam' else 'sum' end
      and (p_subject = '' or s.subject = p_subject) and (p_year = '' or s.year = p_year)
      and (p_q = '' or s.title ilike '%' || replace(replace(replace(p_q, '\', '\\'), '%', '\%'), '_', '\_') || '%')
  ) t
  order by case when p_sort = 'likes' then t.likes end desc nulls last, t.exam_year desc nulls last, t.created desc
  limit 100
$$;

-- 15b) best answer: only the asker can pick one; it is shown first
alter table answers add column if not exists accepted boolean not null default false;
create unique index if not exists answers_one_accepted on answers (question_id) where accepted;
drop function if exists answers_list(uuid);
create function answers_list(p_question uuid)
returns table(id uuid, text text, created timestamptz, uid uuid, name text, votes bigint, voted boolean, accepted boolean)
language sql stable set search_path = public as $$
  select a.id, a.text, a.created, u.id, u.name,
    (select count(*) from likes l where l.kind = 'answer' and l.target_id = a.id),
    exists(select 1 from likes l where l.kind = 'answer' and l.target_id = a.id and l.user_id = auth.uid()),
    a.accepted
  from answers a join profiles u on u.id = a.user_id
  where a.question_id = p_question
  order by a.accepted desc, 6 desc, a.created asc limit 100
$$;
create or replace function accept_answer(p_answer uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare qid uuid; asker uuid; was boolean;
begin
  select a.question_id, q.user_id, a.accepted into qid, asker, was from answers a join questions q on q.id = a.question_id where a.id = p_answer;
  if asker is null or asker <> auth.uid() then raise exception 'مش مسموح'; end if;
  update answers set accepted = false where question_id = qid and accepted;
  if was then return false; end if;                       -- tapping it again removes the mark
  update answers set accepted = true where id = p_answer;
  return true;
end $$;
revoke execute on function accept_answer(uuid) from public, anon; grant execute on function accept_answer(uuid) to authenticated;
grant execute on function summaries_list(text, text, text, text, text), answers_list(uuid) to authenticated;
revoke execute on function summaries_list(text, text, text, text, text), answers_list(uuid) from public, anon;

-- 15c) verified business tick (business account approved AND business plan still active)
create or replace function verified_ids() returns uuid[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(b.user_id), '{}') from businesses b
  join subscriptions s on s.user_id = b.user_id and s.plan = 'business' and s.expires > now()
  where b.verified
$$;
revoke execute on function verified_ids() from public, anon; grant execute on function verified_ids() to authenticated;

-- 15d) weekly study challenge: minutes in the last 7 days, for everyone or for one group you belong to
create or replace function study_week_board(p_group uuid default null)
returns table(id uuid, name text, avatar_path text, minutes bigint)
language plpgsql stable security definer set search_path = public as $$
begin
  if p_group is not null and not exists (select 1 from group_members where group_id = p_group and user_id = auth.uid()) then
    raise exception 'مش مسموح';
  end if;
  return query
    select u.id, u.name, u.avatar_path, sum(d.minutes)::bigint as m
    from study_days d join profiles u on u.id = d.user_id
    where d.day > current_date - 7 and not u.disabled and not u.banned
      and (p_group is null or u.id in (select gm.user_id from group_members gm where gm.group_id = p_group))
      and not blocked_between(auth.uid(), u.id)
    group by u.id, u.name, u.avatar_path
    order by m desc limit 20;
end $$;
revoke execute on function study_week_board(uuid) from public, anon; grant execute on function study_week_board(uuid) to authenticated;

-- 15e) admin trends: last 14 days of sign-ups / posts / study minutes, and the busiest subjects
create or replace function admin_trends() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform admin_guard();
  return jsonb_build_object(
    'days', (select coalesce(jsonb_agg(jsonb_build_object('day', g.d::date,
        'users', (select count(*) from profiles where created::date = g.d::date),
        'posts', (select count(*) from posts where created::date = g.d::date),
        'minutes', (select coalesce(sum(minutes), 0) from study_days where day = g.d::date)) order by g.d), '[]'::jsonb)
      from generate_series(current_date - 13, current_date, interval '1 day') g(d)),
    'subjects', (select coalesce(jsonb_agg(jsonb_build_object('subject', subject, 'n', n)), '[]'::jsonb)
      from (select subject, count(*) n from summaries group by subject order by n desc limit 6) s),
    'grades', (select coalesce(jsonb_agg(jsonb_build_object('grade', grade, 'n', n)), '[]'::jsonb)
      from (select settings->>'grade' as grade, count(*) n from profiles where settings->>'grade' is not null group by 1 order by n desc limit 13) g)
  );
end $$;
revoke execute on function admin_trends() from public, anon; grant execute on function admin_trends() to authenticated;

-- 15f) browser push subscriptions (sending needs an Edge Function, see README)
create table if not exists push_subs (
  endpoint text primary key check (char_length(endpoint) <= 600),
  user_id uuid not null references profiles on delete cascade default auth.uid(),
  p256dh text not null check (char_length(p256dh) <= 200),
  auth text not null check (char_length(auth) <= 100),
  created timestamptz not null default now());
alter table push_subs enable row level security;
revoke all on push_subs from anon, authenticated; grant select, insert, delete on push_subs to authenticated;
drop policy if exists ps_sel on push_subs; create policy ps_sel on push_subs for select to authenticated using (user_id = auth.uid());
drop policy if exists ps_ins on push_subs; create policy ps_ins on push_subs for insert to authenticated with check (user_id = auth.uid());
drop policy if exists ps_del on push_subs; create policy ps_del on push_subs for delete to authenticated using (user_id = auth.uid());

-- ===================== 16. City builder (focus sessions build a city) =====================
alter table profiles add column if not exists city_name text not null default '';
alter table profiles drop constraint if exists profiles_city_name_chk;
alter table profiles add constraint profiles_city_name_chk check (char_length(city_name) <= 30);

create table if not exists city_buildings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles on delete cascade,
  kind text not null check (kind in ('house', 'flat', 'shop', 'tower', 'ruin')),
  created timestamptz not null default now());
create index if not exists city_buildings_user on city_buildings (user_id, created);
alter table city_buildings enable row level security;
revoke all on city_buildings from anon, authenticated;      -- only the security-definer functions below touch it

-- a finished focus session builds a house (<25 min), flat (<45), shop (<60) or tower; at most 12 buildings a day
create or replace function add_study(p_minutes int, p_day date default current_date) returns jsonb
language plpgsql security definer set search_path = public as $$
declare d date := p_day;
begin
  if p_minutes is null or p_minutes < 1 or p_minutes > 180 then raise exception 'عدد الدقايق مش صح'; end if;
  if d is null or abs(d - current_date) > 1 then d := current_date; end if;
  insert into study_days(user_id, day, minutes) values (auth.uid(), d, p_minutes)
    on conflict (user_id, day) do update set minutes = study_days.minutes + excluded.minutes;
  update profiles set sessions = sessions + 1 where id = auth.uid();
  if p_minutes >= 10 and (select count(*) from city_buildings where user_id = auth.uid() and kind <> 'ruin' and created > now() - interval '1 day') < 12 then
    insert into city_buildings(user_id, kind) values (auth.uid(),
      case when p_minutes < 25 then 'house' when p_minutes < 45 then 'flat' when p_minutes < 60 then 'shop' else 'tower' end);
  end if;
  return my_stats();
end $$;

-- leaving a focus session early leaves a ruin (at most 10 a day)
create or replace function city_ruin() returns void
language plpgsql security definer set search_path = public as $$
begin
  if (select count(*) from city_buildings where user_id = auth.uid() and kind = 'ruin' and created > now() - interval '1 day') < 10 then
    insert into city_buildings(user_id, kind) values (auth.uid(), 'ruin');
  end if;
end $$;

create or replace function set_city_name(p_name text) returns text
language plpgsql security definer set search_path = public as $$
declare n text := btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g'));
begin
  if char_length(n) < 2 or char_length(n) > 30 then raise exception 'اسم المدينة لازم يكون من ٢ إلى ٣٠ حرف'; end if;
  update profiles set city_name = n where id = auth.uid();
  return n;
end $$;

-- one city (yours when p_user is null): owner, name, totals and the buildings in build order (last 450)
create or replace function city_get(p_user uuid default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare u uuid := coalesce(p_user, auth.uid()); r record;
begin
  select id, name, avatar_path, city_name, disabled, banned into r from profiles where id = u;
  if r.id is null or (u <> auth.uid() and (r.disabled or r.banned or blocked_between(auth.uid(), u))) then raise exception 'المدينة مش موجودة'; end if;
  return jsonb_build_object('owner', r.id, 'owner_name', r.name, 'avatar_key', r.avatar_path, 'city_name', r.city_name, 'mine', u = auth.uid(),
    'minutes', (select coalesce(sum(minutes), 0) from study_days where user_id = u),
    'buildings', (select count(*) from city_buildings where user_id = u and kind <> 'ruin'),
    'ruins', (select count(*) from city_buildings where user_id = u and kind = 'ruin'),
    'kinds', (select coalesce(jsonb_agg(kind order by created), '[]'::jsonb) from (select kind, created from city_buildings where user_id = u order by created desc limit 450) b));
end $$;

create or replace function city_top() returns table(id uuid, name text, city_name text, avatar_path text, buildings bigint, minutes bigint)
language sql stable security definer set search_path = public as $$
  select u.id, u.name, u.city_name, u.avatar_path,
    (select count(*) from city_buildings b where b.user_id = u.id and b.kind <> 'ruin'),
    (select coalesce(sum(s.minutes), 0) from study_days s where s.user_id = u.id)
  from profiles u
  where u.city_name <> '' and not u.disabled and not u.banned and (u.id = auth.uid() or not blocked_between(auth.uid(), u.id))
  order by 5 desc, 6 desc limit 20
$$;
revoke execute on function city_ruin(), set_city_name(text), city_get(uuid), city_top() from public, anon;
grant execute on function city_ruin(), set_city_name(text), city_get(uuid), city_top(), add_study(int, date) to authenticated;

-- ===================== 17. Look at another user's profile =====================
create or replace function user_profile(p_user uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r profiles; vis boolean;
begin
  select * into r from profiles where id = p_user;
  if r.id is null or (p_user <> auth.uid() and (r.disabled or r.banned or blocked_between(auth.uid(), p_user))) then raise exception 'المستخدم مش موجود'; end if;
  vis := can_see(p_user);
  return jsonb_build_object('id', r.id, 'name', r.name, 'bio', r.bio, 'avatar_key', r.avatar_path, 'banner_key', r.banner_path, 'city_name', r.city_name,
    'followers', (select count(*) from follows where followee = p_user), 'following', (select count(*) from follows where follower = p_user),
    'posts', case when vis then (select count(*) from posts where user_id = p_user) else 0 end,
    'summaries', (select count(*) from summaries where user_id = p_user),
    'level', (floor(sqrt(xp_of(p_user) / 25.0)) + 1)::int,
    'is_following', exists(select 1 from follows where follower = auth.uid() and followee = p_user),
    'can_view', vis, 'mine', p_user = auth.uid(), 'joined', r.created);
end $$;

-- same shape as feed_posts; RLS (privacy, blocks) still decides what is visible
create or replace function user_posts(p_user uuid, p_limit int default 10, p_offset int default 0)
returns table(id uuid, text text, img_path text, created timestamptz, uid uuid, name text, avatar_path text,
              likes bigint, liked boolean, comments bigint, saved boolean, following boolean)
language sql stable set search_path = public as $$
  select p.id, p.text, p.img_path, p.created, a.id, a.name, a.avatar_path,
    (select count(*) from likes l where l.kind = 'post' and l.target_id = p.id),
    exists(select 1 from likes l where l.kind = 'post' and l.target_id = p.id and l.user_id = auth.uid()),
    (select count(*) from comments c where c.post_id = p.id),
    exists(select 1 from saves s where s.post_id = p.id and s.user_id = auth.uid()),
    exists(select 1 from follows f where f.follower = auth.uid() and f.followee = a.id)
  from posts p join profiles a on a.id = p.user_id
  where p.user_id = p_user
  order by p.created desc
  limit least(greatest(p_limit, 1), 31) offset greatest(p_offset, 0)
$$;

create or replace function user_summaries(p_user uuid)
returns table(id uuid, title text, subject text, year text, file_path text, file_name text, file_type text,
              created timestamptz, uid uuid, name text, likes bigint, liked boolean, kind text, exam_year smallint)
language sql stable set search_path = public as $$
  select s.id, s.title, s.subject, s.year, s.file_path, s.file_name, s.file_type, s.created, u.id, u.name,
    (select count(*) from likes l where l.kind = 'summary' and l.target_id = s.id),
    exists(select 1 from likes l where l.kind = 'summary' and l.target_id = s.id and l.user_id = auth.uid()),
    s.kind, s.exam_year
  from summaries s join profiles u on u.id = s.user_id
  where s.user_id = p_user
  order by s.created desc limit 100
$$;
revoke execute on function user_profile(uuid), user_posts(uuid, int, int), user_summaries(uuid) from public, anon;
grant execute on function user_profile(uuid), user_posts(uuid, int, int), user_summaries(uuid) to authenticated;

-- ===================== 17. Random feed order =====================
-- p_seed <> '' gives a stable random order for that seed (so "load more" pages do not repeat posts)
drop function if exists feed_posts(text, text, int, int);
drop function if exists feed_posts(text, text, int, int, text);
create function feed_posts(p_view text default 'all', p_q text default '', p_limit int default 10, p_offset int default 0, p_seed text default '')
returns table(id uuid, text text, img_path text, created timestamptz, uid uuid, name text, avatar_path text,
              likes bigint, liked boolean, comments bigint, saved boolean, following boolean)
language sql stable set search_path = public as $$
  select p.id, p.text, p.img_path, p.created, a.id, a.name, a.avatar_path,
    (select count(*) from likes l where l.kind = 'post' and l.target_id = p.id),
    exists(select 1 from likes l where l.kind = 'post' and l.target_id = p.id and l.user_id = auth.uid()),
    (select count(*) from comments c where c.post_id = p.id),
    exists(select 1 from saves s where s.post_id = p.id and s.user_id = auth.uid()),
    exists(select 1 from follows f where f.follower = auth.uid() and f.followee = a.id)
  from posts p join profiles a on a.id = p.user_id
  where (p_view = 'all'
      or (p_view = 'mine' and p.user_id = auth.uid())
      or (p_view = 'following' and (p.user_id = auth.uid() or exists(select 1 from follows f where f.follower = auth.uid() and f.followee = p.user_id)))
      or (p_view = 'saved' and exists(select 1 from saves s where s.post_id = p.id and s.user_id = auth.uid())))
    and (p_q = '' or p.text ilike '%' || replace(replace(replace(p_q, '\', '\\'), '%', '\%'), '_', '\_') || '%')
  order by case when p_seed <> '' then md5(p.id::text || left(p_seed, 32)) end, p.created desc
  limit least(greatest(p_limit, 1), 31) offset greatest(p_offset, 0)
$$;
revoke execute on function feed_posts(text, text, int, int, text) from public, anon;
grant execute on function feed_posts(text, text, int, int, text) to authenticated;

-- ===================== 18. Stories (24 hours) =====================
create table if not exists stories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles on delete cascade default auth.uid(),
  kind text not null check (kind in ('img', 'text')),
  img_path text check (img_path is null or char_length(img_path) <= 200),
  text text not null default '' check (char_length(text) <= 200),
  bg smallint not null default 0 check (bg between 0 and 7),
  created timestamptz not null default now(),
  expires timestamptz not null default now() + interval '24 hours',
  check ((kind = 'img' and img_path is not null) or (kind = 'text' and char_length(btrim(text)) > 0)));
create index if not exists stories_user on stories (user_id, created desc);
create table if not exists story_views (
  story_id uuid not null references stories on delete cascade,
  user_id uuid not null references profiles on delete cascade,
  created timestamptz not null default now(),
  primary key (story_id, user_id));
alter table stories enable row level security; alter table story_views enable row level security;
revoke all on stories, story_views from anon, authenticated;     -- everything goes through the functions below

create or replace function create_story(p_kind text, p_img text, p_text text, p_bg int) returns uuid
language plpgsql security definer set search_path = public as $$
declare nid uuid; t text := left(btrim(coalesce(p_text, '')), 200);
begin
  if auth.uid() is null then raise exception 'مش مسموح'; end if;
  if (select banned from profiles where id = auth.uid()) then raise exception 'حسابك موقوف'; end if;
  if p_kind not in ('img', 'text') then raise exception 'نوع القصة مش صح'; end if;
  if p_kind = 'text' and t = '' then raise exception 'اكتب نص للقصة'; end if;
  if p_kind = 'img' and (p_img is null or p_img not like auth.uid()::text || '/%') then raise exception 'الصورة مش صح'; end if;
  if (select count(*) from stories where user_id = auth.uid() and created > now() - interval '24 hours') >= 15 then raise exception 'وصلت للحد الأقصى للقصص النهاردة'; end if;
  delete from stories where user_id = auth.uid() and expires < now() - interval '1 day';
  insert into stories(kind, img_path, text, bg) values (p_kind, case when p_kind = 'img' then p_img end, t, greatest(0, least(coalesce(p_bg, 0), 7))) returning id into nid;
  return nid;
end $$;

create or replace function delete_story(p_id uuid) returns void
language sql security definer set search_path = public as $$ delete from stories where id = p_id and user_id = auth.uid() $$;

-- stories of you and the people you follow that are still live
create or replace function stories_feed()
returns table(id uuid, uid uuid, name text, avatar_path text, kind text, img_path text, text text, bg smallint, created timestamptz, seen boolean, views bigint)
language sql stable security definer set search_path = public as $$
  select s.id, u.id, u.name, u.avatar_path, s.kind, s.img_path, s.text, s.bg, s.created,
    (s.user_id = auth.uid() or exists(select 1 from story_views v where v.story_id = s.id and v.user_id = auth.uid())),
    case when s.user_id = auth.uid() then (select count(*) from story_views v where v.story_id = s.id) else 0 end
  from stories s join profiles u on u.id = s.user_id
  where s.expires > now() and not u.disabled and not u.banned
    and (s.user_id = auth.uid() or (exists(select 1 from follows f where f.follower = auth.uid() and f.followee = s.user_id) and not blocked_between(auth.uid(), s.user_id)))
  order by s.created asc
$$;

create or replace function view_story(p_id uuid) returns void
language sql security definer set search_path = public as $$
  insert into story_views(story_id, user_id)
  select s.id, auth.uid() from stories s
  where s.id = p_id and s.expires > now() and s.user_id <> auth.uid()
    and exists(select 1 from follows f where f.follower = auth.uid() and f.followee = s.user_id)
  on conflict do nothing
$$;

create or replace function story_viewers(p_id uuid) returns table(id uuid, name text, avatar_path text, created timestamptz)
language sql stable security definer set search_path = public as $$
  select u.id, u.name, u.avatar_path, v.created from story_views v join profiles u on u.id = v.user_id
  where v.story_id = p_id and exists(select 1 from stories s where s.id = p_id and s.user_id = auth.uid())
  order by v.created desc limit 100
$$;
revoke execute on function create_story(text, text, text, int), delete_story(uuid), stories_feed(), view_story(uuid), story_viewers(uuid) from public, anon;
grant execute on function create_story(text, text, text, int), delete_story(uuid), stories_feed(), view_story(uuid), story_viewers(uuid) to authenticated;

-- 19) username: at most 3 changes in any 3 months; personal number: set once, never changed or removed
create table if not exists name_changes (user_id uuid not null references profiles on delete cascade, created timestamptz not null default now());
create index if not exists name_changes_u on name_changes (user_id, created desc);
alter table name_changes enable row level security;
revoke all on name_changes from anon, authenticated;

create or replace function guard_name_change() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.name is distinct from old.name then
    if (select count(*) from name_changes where user_id = old.id and created > now() - interval '3 months') >= 3 then
      raise exception 'تقدر تغيّر اسم المستخدم ٣ مرات بس كل ٣ شهور';
    end if;
    insert into name_changes(user_id) values (old.id);
  end if;
  return new;
end $$;
drop trigger if exists profiles_name_guard on profiles;
create trigger profiles_name_guard before update of name on profiles for each row execute function guard_name_change();

create or replace function name_quota() returns table (left_count int, next_at timestamptz)
language sql stable security definer set search_path = public as $$
  select greatest(0, 3 - count(*)::int), case when count(*) >= 3 then min(created) + interval '3 months' end
  from (select created from name_changes where user_id = auth.uid() and created > now() - interval '3 months' order by created desc limit 3) x
$$;
revoke execute on function name_quota() from public, anon;
grant execute on function name_quota() to authenticated;

create or replace function set_number(p_num text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'مش مسموح'; end if;
  p_num := trim(coalesce(p_num, ''));
  if exists (select 1 from user_numbers where user_id = auth.uid()) then raise exception 'الرقم الخاص مابيتغيرش بعد ما يتحدد'; end if;
  if p_num !~ '^[0-9]{11}$' then raise exception 'الرقم لازم يكون ١١ رقم'; end if;
  insert into number_lookups(user_id) values (auth.uid());
  if (select count(*) from number_lookups where user_id = auth.uid() and created > now() - interval '10 minutes') > 30 then
    raise exception 'بتعمل حاجات كتير بسرعة، استنى شوية وجرّب تاني';
  end if;
  begin
    insert into user_numbers(user_id, num) values (auth.uid(), p_num);
  exception when unique_violation then raise exception 'الرقم ده مستخدم';
  end;
end $$;

-- 20) feed suggestions: people you may know + people who share summaries / past exams.
-- SECURITY INVOKER: profile and summary row-level security (blocks, disabled, banned) still decides what is visible.
create or replace function suggest_people(p_limit int default 10)
returns table (id uuid, name text, bio text, avatar_path text, mutual bigint)
language sql stable set search_path = public as $$
  select p.id, p.name, p.bio, p.avatar_path,
         (select count(*) from follows a join follows b on b.follower = a.followee and b.followee = p.id where a.follower = auth.uid()) as mutual
  from profiles p
  where p.id <> auth.uid() and p.privacy <> 'none'
    and not exists (select 1 from follows f where f.follower = auth.uid() and f.followee = p.id)
  order by mutual desc, random()
  limit least(greatest(coalesce(p_limit, 10), 1), 20)
$$;
revoke execute on function suggest_people(int) from public, anon;
grant execute on function suggest_people(int) to authenticated;

create or replace function top_sharers(p_limit int default 10)
returns table (id uuid, name text, bio text, avatar_path text, sums bigint, exams bigint, following boolean)
language sql stable set search_path = public as $$
  select p.id, p.name, p.bio, p.avatar_path,
         count(*) filter (where s.kind = 'sum') as sums, count(*) filter (where s.kind = 'exam') as exams,
         exists (select 1 from follows f where f.follower = auth.uid() and f.followee = p.id) as following
  from summaries s join profiles p on p.id = s.user_id
  where p.id <> auth.uid() and p.privacy <> 'none'
  group by p.id, p.name, p.bio, p.avatar_path
  order by count(*) desc, max(s.created) desc
  limit least(greatest(coalesce(p_limit, 10), 1), 20)
$$;
revoke execute on function top_sharers(int) from public, anon;
grant execute on function top_sharers(int) to authenticated;

-- 21) AI helper: a small daily allowance per user (the Edge Function `ai` calls ai_take before every Gemini request).
create table if not exists ai_usage (
  user_id uuid not null references profiles on delete cascade,
  day date not null default (now() at time zone 'utc')::date,
  n int not null default 0,
  primary key (user_id, day)
);
alter table ai_usage enable row level security;
revoke all on ai_usage from anon, authenticated;

-- consumes p_cost units of today's allowance (40 per day); raises 'ai_limit' when it would go over. Returns what is left.
create or replace function ai_take(p_cost int default 1) returns int
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); cur int; lim constant int := 40;
begin
  if uid is null then raise exception 'مش مسموح'; end if;
  p_cost := least(greatest(coalesce(p_cost, 1), 1), 5);
  insert into ai_usage(user_id) values (uid) on conflict do nothing;
  update ai_usage set n = n + p_cost where user_id = uid and day = (now() at time zone 'utc')::date and n + p_cost <= lim returning n into cur;
  if cur is null then raise exception 'ai_limit'; end if;
  return lim - cur;
end $$;

create or replace function ai_left() returns int
language sql stable security definer set search_path = public as $$
  select greatest(0, 40 - coalesce((select n from ai_usage where user_id = auth.uid() and day = (now() at time zone 'utc')::date), 0))
$$;
revoke execute on function ai_take(int), ai_left() from public, anon;
grant execute on function ai_take(int), ai_left() to authenticated;

-- 22) automatic AI watch over new posts, reels and summaries (text only). Flags go to moderators; nothing is removed automatically.
create table if not exists ai_flags (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('post', 'reel', 'summary')),
  target_id uuid not null,
  category text not null default 'other',
  reason text not null default '',
  created timestamptz not null default now(),
  unique (kind, target_id)
);
alter table ai_flags enable row level security;
revoke all on ai_flags from anon, authenticated;

-- called only by the `ai-moderate` Edge Function (service role)
create or replace function ai_flag_add(p_kind text, p_target uuid, p_category text, p_reason text) returns void
language sql security definer set search_path = public as $$
  insert into ai_flags(kind, target_id, category, reason)
  values (p_kind, p_target, left(coalesce(nullif(p_category, ''), 'other'), 30), left(coalesce(p_reason, ''), 200))
  on conflict (kind, target_id) do nothing
$$;
revoke execute on function ai_flag_add(text, uuid, text, text) from public, anon, authenticated;
grant execute on function ai_flag_add(text, uuid, text, text) to service_role;

create or replace function mod_ai_flags() returns table (id uuid, kind text, target_id uuid, category text, reason text, created timestamptz, author_name text, preview text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_mod() then raise exception 'مش مسموح'; end if;
  return query
    select f.id, f.kind, f.target_id, f.category, f.reason, f.created, pr.name,
           case f.kind when 'post' then left(p.text, 200) when 'reel' then left(r.title, 200) else left(s.title || ' · ' || s.subject, 200) end
    from ai_flags f
    left join posts p on f.kind = 'post' and p.id = f.target_id
    left join reels r on f.kind = 'reel' and r.id = f.target_id
    left join summaries s on f.kind = 'summary' and s.id = f.target_id
    left join profiles pr on pr.id = coalesce(p.user_id, r.user_id, s.user_id)
    where p.id is not null or r.id is not null or s.id is not null      -- flags whose content is already gone are hidden
    order by f.created desc limit 100;
end $$;

create or replace function mod_ai_resolve(p_flag uuid, p_remove boolean) returns void
language plpgsql security definer set search_path = public as $$
declare f ai_flags; fp text;
begin
  if not is_mod() then raise exception 'مش مسموح'; end if;
  select * into f from ai_flags where id = p_flag;
  if f.id is null then return; end if;
  if p_remove then
    if f.kind = 'post' then
      select img_path into fp from posts where id = f.target_id; delete from posts where id = f.target_id;
    elsif f.kind = 'reel' then
      select file_path into fp from reels where id = f.target_id; delete from reels where id = f.target_id;
    else
      select file_path into fp from summaries where id = f.target_id; delete from summaries where id = f.target_id;
    end if;
    if fp is not null then delete from storage.objects where bucket_id = 'files' and name = fp; end if;
  end if;
  delete from ai_flags where id = f.id;
end $$;
revoke execute on function mod_ai_flags(), mod_ai_resolve(uuid, boolean) from public, anon;
grant execute on function mod_ai_flags(), mod_ai_resolve(uuid, boolean) to authenticated;

-- 23) rule-based watch over new posts, reels and summaries: NO external service, nothing leaves the database.
-- Suspicious items are flagged for moderators (same list as section 22); nothing is removed automatically.
create table if not exists banned_words (
  id serial primary key,
  word text not null unique check (char_length(word) between 2 and 40),
  category text not null check (category in ('harassment', 'hate', 'sexual', 'violence', 'self_harm', 'spam', 'other'))
);
alter table banned_words enable row level security;
revoke all on banned_words from anon, authenticated;
insert into banned_words(word, category) values
  ('ابن الكلب','harassment'), ('يا كلب','harassment'), ('يا حمار','harassment'), ('يا غبي','harassment'), ('يا حيوان','harassment'),
  ('حقير','harassment'), ('وسخ','harassment'), ('يلعن','harassment'), ('خول','harassment'), ('عرص','harassment'), ('شرموط','sexual'),
  ('متناك','sexual'), ('كسمك','sexual'), ('كس امك','sexual'), ('منيوك','sexual'), ('porn','sexual'), ('sex video','sexual'), ('nude','sexual'),
  ('fuck','harassment'), ('fucking','harassment'), ('shit','harassment'), ('bitch','harassment'), ('asshole','harassment'),
  ('ارهابي','hate'), ('يموتو','violence'), ('هموتك','violence'), ('هقتلك','violence'), ('هدبحك','violence'), ('هضربك','violence')
on conflict (word) do nothing;

-- one normal form for Arabic/English text: alef/yaa/taa-marbuta variants, diacritics, tatweel, Arabic digits, stretched letters, dots between letters
create or replace function norm_text(t text) returns text
language sql immutable set search_path = public as $$
  select regexp_replace(
           regexp_replace(
             translate(lower(coalesce(t, '')), 'أإآٱىةؤئ٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹', 'اااايهوي01234567890123456789'),
             '[ً-ٰٟـ]', '', 'g'),
           '([ء-يa-z])\1{2,}', '\1', 'g')   -- stretched letters only, never digits
$$;

-- first matching rule wins (most serious first); returns no row when the text looks fine
create or replace function scan_text(p_text text) returns table (category text, reason text)
language plpgsql stable set search_path = public as $$
declare t text := norm_text(p_text); tw text; w record; b constant text := '(^|[^ء-ي0-9a-z])'; e constant text := '([^ء-ي0-9a-z]|$)';
begin
  if length(t) < 2 then return; end if;
  tw := regexp_replace(t, '(?<=[ء-يa-z])[.\-_*]+(?=[ء-يa-z])', '', 'g');   -- f.u.c.k -> fuck (words only; keeps emails and links intact)
  if tw ~ (b || '(انتحر|هنتحر|عايز اموت|عاوز اموت|اقتل نفسي|هقتل نفسي|مش عايز اعيش|i want to die|kill myself)' || e) then
    return query select 'self_harm'::text, 'كلام عن إيذاء النفس، ممكن الشخص محتاج مساعدة.'::text; return;
  end if;
  for w in select bw.word, bw.category from banned_words bw order by case bw.category when 'violence' then 0 when 'hate' then 1 when 'sexual' then 2 else 3 end loop
    if tw ~ (b || '(?:[وفبلك]|ال)*' || regexp_replace(norm_text(w.word), '([.*+?^${}()|\[\]\\])', '\\\1', 'g') || e) then
      return query select w.category::text, ('كلمة مخالفة: ' || w.word)::text; return;
    end if;
  end loop;
  if t ~ '(^|[^0-9])01[0125]([ -]?[0-9]){8}([^0-9]|$)' or t ~ '\+[0-9]{1,3}([ -]?[0-9]){8,12}' or t ~ '[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}' then
    return query select 'personal_info'::text, 'رقم تليفون أو إيميل في النص.'::text; return;
  end if;
  if t ~ '(wa\.me|t\.me/|chat\.whatsapp|api\.whatsapp|discord\.gg|snapchat\.com|instagram\.com|tiktok\.com/@)' then
    return query select 'spam'::text, 'رابط تواصل خارجي.'::text; return;
  end if;
  if t ~ '(https?://|www\.)' and t ~ '(اربح|اكسب|ربح مضمون|خصم|كوبون|اشترك في|تابعني|واتساب|تليجرام|free money|giveaway)' then
    return query select 'spam'::text, 'رابط مع كلام ترويجي.'::text; return;
  end if;
end $$;
revoke execute on function norm_text(text), scan_text(text) from public, anon, authenticated;

create or replace function auto_scan_new() returns trigger
language plpgsql security definer set search_path = public as $$
declare k text; txt text; cat text; rsn text; dup int;
begin
  begin   -- a scan problem must never block someone from posting
    if tg_table_name = 'posts' then k := 'post'; txt := new.text;
    elsif tg_table_name = 'reels' then k := 'reel'; txt := new.title;
    else k := 'summary'; txt := new.title || ' ' || new.subject; end if;
    select s.category, s.reason into cat, rsn from scan_text(txt) s limit 1;
    if cat is null and k = 'post' then
      select count(*) into dup from posts where user_id = new.user_id and text = new.text and created > now() - interval '1 hour';
      if dup >= 3 then cat := 'spam'; rsn := 'نفس المنشور اتكرر ٣ مرات في ساعة.'; end if;
    end if;
    if cat is not null then
      insert into ai_flags(kind, target_id, category, reason) values (k, new.id, cat, left(rsn, 200)) on conflict (kind, target_id) do nothing;
    end if;
  exception when others then null;
  end;
  return null;
end $$;
revoke execute on function auto_scan_new() from public, anon, authenticated;

drop trigger if exists posts_auto_scan on posts;
create trigger posts_auto_scan after insert on posts for each row execute function auto_scan_new();
drop trigger if exists reels_auto_scan on reels;
create trigger reels_auto_scan after insert on reels for each row execute function auto_scan_new();
drop trigger if exists summaries_auto_scan on summaries;
create trigger summaries_auto_scan after insert on summaries for each row execute function auto_scan_new();

-- 24) spaced repetition for flashcards (ported idea: every card has a due date; 4 grades decide the next interval)
alter table cards add column if not exists ease double precision not null default 2.5 check (ease between 1.3 and 3.0);
alter table cards alter column ease type double precision;   -- (a 4-byte real would store 1.3 as 1.29999995 and trip the check)
alter table cards add column if not exists interval_days int not null default 0 check (interval_days >= 0);
alter table cards add column if not exists reps int not null default 0;
alter table cards add column if not exists due timestamptz not null default now();
alter table cards add column if not exists last_grade text check (last_grade in ('again', 'hard', 'good', 'easy'));
create index if not exists cards_due_idx on cards (due);

create or replace function card_grade(p_card uuid, p_grade text) returns int
language plpgsql security definer set search_path = public as $$
declare c cards%rowtype; e double precision; i int; nd timestamptz;
begin
  if p_grade not in ('again', 'hard', 'good', 'easy') then raise exception 'درجة غلط'; end if;
  select * into c from cards where id = p_card and deck_id in (select id from decks where user_id = auth.uid());
  if not found then raise exception 'البطاقة مش موجودة'; end if;
  e := c.ease;
  if p_grade = 'again' then
    e := greatest(1.3, e - 0.2); i := 0; nd := now() + interval '10 minutes';
  else
    if p_grade = 'hard' then e := greatest(1.3, e - 0.15); i := case when c.interval_days = 0 then 1 else greatest(1, round((c.interval_days * 1.2)::numeric)::int) end;
    elsif p_grade = 'good' then i := case when c.interval_days = 0 then 1 else round((c.interval_days * e)::numeric)::int end;
    else e := least(3.0, e + 0.15); i := case when c.interval_days = 0 then 2 else greatest(2, round((c.interval_days * e * 1.3)::numeric)::int) end;
    end if;
    i := least(i, 365);
    nd := now() + make_interval(days => i);
  end if;
  update cards set ease = e, interval_days = i, reps = reps + 1, due = nd, last_grade = p_grade,
         box = case when p_grade = 'again' then 0 when p_grade = 'hard' then least(box, 1) when p_grade = 'good' then least(3, box + 1) else 3 end
   where id = p_card;
  update profiles set cards_reviewed = cards_reviewed + 1 where id = auth.uid();
  return i;
end $$;

drop function if exists cards_due(int);
create function cards_due(p_limit int default 50) returns table (id uuid, deck_id uuid, deck_name text, q text, a text, due timestamptz, interval_days int, ease double precision, reps int)
language sql stable security definer set search_path = public as $$
  select c.id, c.deck_id, d.name, c.q, c.a, c.due, c.interval_days, c.ease, c.reps
    from cards c join decks d on d.id = c.deck_id
   where d.user_id = auth.uid() and c.due <= now()
   order by c.due limit least(greatest(coalesce(p_limit, 50), 1), 100)
$$;
revoke execute on function card_grade(uuid, text), cards_due(int) from public, anon;
grant execute on function card_grade(uuid, text), cards_due(int) to authenticated;

-- 25) reactions: like / love / haha / wow / sad / angry on posts, summaries and reels (answers keep the single up-vote)
-- Every reaction is still one row in `likes`, so the existing counts (likes), "liked", points and sorting keep working unchanged.
alter table likes add column if not exists react text not null default 'like';
alter table likes drop constraint if exists likes_react_check;
alter table likes add constraint likes_react_check check (react in ('like', 'love', 'haha', 'wow', 'sad', 'angry'));
revoke update on likes from authenticated;   -- only the reaction itself can change, never which item it points at
grant update (react) on likes to authenticated;
drop policy if exists l_upd on likes;
create policy l_upd on likes for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

create or replace function t_like_after() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.kind = 'post' then
    perform notify((select user_id from posts where id = new.target_id), 'likes',
      (select name from profiles where id = new.user_id) || case new.react
        when 'love' then ' حب منشورك ❤️' when 'haha' then ' ضحك على منشورك 😂' when 'wow' then ' اتفاجئ بمنشورك 😮'
        when 'sad' then ' حزن على منشورك 😢' when 'angry' then ' اتضايق من منشورك 😠' else ' عمل لايك على منشورك' end, new.user_id);
  end if;
  return new;
end $$;

-- one tap: same reaction again removes it, a different one replaces it, none yet adds it
create or replace function toggle_react(p_kind text, p_id uuid, p_react text default 'like') returns jsonb
language plpgsql set search_path = public as $$
declare cur text; mine text; n bigint; cs jsonb; r text := coalesce(nullif(p_react, ''), 'like');
begin
  if p_kind not in ('post', 'summary', 'reel', 'answer') then raise exception 'نوع غلط'; end if;
  if r not in ('like', 'love', 'haha', 'wow', 'sad', 'angry') then raise exception 'تفاعل غلط'; end if;
  if p_kind = 'answer' then r := 'like'; end if;
  select react into cur from likes where kind = p_kind and target_id = p_id and user_id = auth.uid();
  if cur is null then insert into likes(kind, target_id, react) values (p_kind, p_id, r); mine := r;
  elsif cur = r then delete from likes where kind = p_kind and target_id = p_id and user_id = auth.uid(); mine := null;
  else update likes set react = r where kind = p_kind and target_id = p_id and user_id = auth.uid(); mine := r;
  end if;
  select count(*) into n from likes where kind = p_kind and target_id = p_id;
  select coalesce(jsonb_object_agg(react, c), '{}') into cs from (select react, count(*) c from likes where kind = p_kind and target_id = p_id group by react) x;
  return jsonb_build_object('liked', mine is not null, 'count', n, 'mine', mine, 'counts', cs);
end $$;

-- reaction breakdown for a page of items (one call per list)
create or replace function react_info(p_kind text, p_ids uuid[]) returns table (target_id uuid, react text, n bigint, mine boolean)
language sql stable set search_path = public as $$
  select l.target_id, l.react, count(*), bool_or(l.user_id = auth.uid())
    from likes l
   where l.kind = p_kind and l.target_id = any (p_ids[1:100])
   group by l.target_id, l.react
$$;
revoke execute on function toggle_react(text, uuid, text), react_info(text, uuid[]) from public, anon;
grant execute on function toggle_react(text, uuid, text), react_info(text, uuid[]) to authenticated;

-- 26) choose your own building + any focus length from 5 to 120 minutes
-- villa and school join house / flat / shop / tower. p_kind is optional: without it the building still follows the session length.
alter table city_buildings drop constraint if exists city_buildings_kind_check;
alter table city_buildings add constraint city_buildings_kind_check check (kind in ('house', 'villa', 'flat', 'shop', 'school', 'tower', 'ruin'));
drop function if exists add_study(int, date);
create or replace function add_study(p_minutes int, p_day date default current_date, p_kind text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare d date := p_day; k text := nullif(p_kind, '');
begin
  if p_minutes is null or p_minutes < 1 or p_minutes > 180 then raise exception 'عدد الدقايق مش صح'; end if;
  if k is not null and k not in ('house', 'villa', 'flat', 'shop', 'school', 'tower') then raise exception 'نوع المبنى مش صح'; end if;
  if d is null or abs(d - current_date) > 1 then d := current_date; end if;
  insert into study_days(user_id, day, minutes) values (auth.uid(), d, p_minutes)
    on conflict (user_id, day) do update set minutes = study_days.minutes + excluded.minutes;
  update profiles set sessions = sessions + 1 where id = auth.uid();
  if p_minutes >= 5 and (select count(*) from city_buildings where user_id = auth.uid() and kind <> 'ruin' and created > now() - interval '1 day') < 12 then
    insert into city_buildings(user_id, kind) values (auth.uid(),
      coalesce(k, case when p_minutes < 25 then 'house' when p_minutes < 45 then 'flat' when p_minutes < 60 then 'shop' else 'tower' end));
  end if;
  return my_stats();
end $$;
revoke execute on function add_study(int, date, text) from public, anon;
grant execute on function add_study(int, date, text) to authenticated;
