-- Stemhub OT — Supabase schema
-- Run once in Supabase → SQL Editor (then run seed.sql).
-- Re-running is safe for functions/views/policies; tables use "if not exists".

-- ============================================================
-- Tables
-- ============================================================

-- One row of OT & allowance rules (id is always 1)
create table if not exists settings (
  id             int primary key default 1 check (id = 1),
  s1_start       time not null default '07:00',
  s1_end         time not null default '15:30',
  s2_start       time not null default '08:30',
  s2_end         time not null default '17:00',
  grace_min      int  not null default 15,       -- late-start / past-shift grace
  round_h        numeric not null default 0.5,   -- OT rounded DOWN to this
  max_ot_h       numeric not null default 4,     -- flag OT above this
  max_duty_h     numeric not null default 16,    -- flag duty above this
  off_days       int[] not null default '{0}',   -- 0 = Sunday
  off_mult       numeric not null default 2,
  hol_mult       numeric not null default 2,
  pg_ot          boolean not null default false, -- PG members earn OT?
  food_after     time not null default '22:00',
  food_amount    int  not null default 0,        -- 0 = not shown in reports
  ta_local       int  not null default 100,
  ta_factory     int  not null default 0,
  ta_outstation  int  not null default 300,
  ta_night       int  not null default 500,
  site_radius_m  int  not null default 300       -- default geofence radius
);

create table if not exists holidays (
  day  date primary key,
  name text
);

create table if not exists teams (
  id     serial primary key,
  name   text not null unique,
  is_pg  boolean not null default false,  -- PG team: food only after food_after AND supervisor approval
  sort   int not null default 0
);

create table if not exists employees (
  emp_code         text primary key,
  name             text not null,
  team_id          int references teams(id) on delete set null,
  role             text not null default 'Member' check (role in ('Leader','Member','Helper')),
  is_pg            boolean not null default false,  -- PG member (no OT unless settings.pg_ot)
  active           boolean not null default true,
  activation_code  text,                             -- one-time code to create the phone login
  user_id          uuid unique references auth.users(id) on delete set null
);

-- Supervisors / admins / HR. Add the email here BEFORE that person signs up.
create table if not exists staff (
  email    text primary key,
  name     text,
  role     text not null check (role in ('admin','supervisor','hr')),
  user_id  uuid unique references auth.users(id) on delete set null
);

create table if not exists sites (
  id        serial primary key,
  name      text not null unique,
  lat       double precision,
  lng       double precision,
  radius_m  int
);

-- Where each team works on a given day
create table if not exists allotments (
  work_date  date not null,
  team_id    int  not null references teams(id) on delete cascade,
  site_id    int  references sites(id) on delete set null,
  shift      text not null default 'S1' check (shift in ('S1','S2')),
  opr_no     text,
  ta_type    text not null default 'local' check (ta_type in ('local','factory','outstation','night','custom')),
  ta_amount  int,
  primary key (work_date, team_id)
);

do $$ begin
  create type punch_kind as enum ('work_in','work_out','ot_in','ot_out','no_ot','travel_in','travel_out','no_travel');
exception when duplicate_object then null; end $$;

create table if not exists punches (
  id          bigserial primary key,
  emp_code    text not null references employees(emp_code) on delete cascade,
  work_date   date not null,
  kind        punch_kind not null,
  at          timestamptz not null default now(),
  lat         double precision,
  lng         double precision,
  accuracy_m  double precision,
  dist_m      int,          -- distance from allotted site at punch time
  photo_path  text,         -- path in storage bucket punch-photos
  unique (emp_code, work_date, kind)
);
create index if not exists punches_date_idx on punches (work_date);

-- Supervisor's review of one technician-day; also holds manual / WhatsApp entries
-- (time fields here override the punches).
create table if not exists day_reviews (
  emp_code       text not null references employees(emp_code) on delete cascade,
  work_date      date not null,
  source         text not null default 'punch' check (source in ('punch','form','whatsapp')),
  status         text not null default 'submitted' check (status in ('submitted','approved','query')),
  note           text,
  present        boolean,           -- null = use GPS result
  food_claim     boolean not null default false,
  food_approved  boolean not null default false,
  in_time        time,
  out_time       time,
  ot_start       time,
  ot_end         time,
  travel_time    text,
  break_min      int not null default 0,
  shift          text check (shift in ('S1','S2')),
  location       text,
  opr_no         text,
  ta_type        text check (ta_type in ('local','factory','outstation','night','custom')),
  ta_amount      int,
  remark         text,
  approved_by    uuid references auth.users(id),
  approved_at    timestamptz,
  updated_at     timestamptz not null default now(),
  primary key (emp_code, work_date)
);

-- ============================================================
-- Helper functions (security definer so RLS policies can use them)
-- ============================================================

create or replace function my_emp_code() returns text
language sql stable security definer set search_path = public as $$
  select emp_code from employees where user_id = auth.uid()
$$;

create or replace function staff_role() returns text
language sql stable security definer set search_path = public as $$
  select role from staff where user_id = auth.uid()
$$;

create or replace function is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from staff where user_id = auth.uid())
$$;

create or replace function can_review() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(staff_role() in ('admin','supervisor'), false)
$$;

create or replace function tmin(t time) returns int
language sql immutable as $$
  select extract(hour from t)::int * 60 + extract(minute from t)::int
$$;

create or replace function dist_m(lat1 float8, lng1 float8, lat2 float8, lng2 float8) returns int
language sql immutable as $$
  select case when lat1 is null or lat2 is null then null else
    round(2 * 6371000 * asin(sqrt(
      power(sin(radians(lat2 - lat1) / 2), 2) +
      cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2))))::int end
$$;

-- ============================================================
-- Sign-up: technicians (EMP code + activation code) and pre-listed staff
-- Technician logins use the email <empcode>@punch.stemhub.in (never receives mail).
-- ============================================================

create or replace function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_emp text;
begin
  if lower(new.email) like '%@punch.stemhub.in' then
    v_emp := upper(split_part(new.email, '@', 1));
    update employees
       set user_id = new.id, activation_code = null
     where upper(emp_code) = v_emp
       and active and user_id is null
       and activation_code is not null
       and activation_code = new.raw_user_meta_data->>'activation_code';
    if not found then
      raise exception 'Wrong EMP code or activation code';
    end if;
  else
    update staff set user_id = new.id
     where lower(email) = lower(new.email) and user_id is null;
    if not found then
      raise exception 'This email is not on the staff list';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function handle_new_user();

-- ============================================================
-- Punching
-- Order: work_in → work_out → (ot_in → ot_out | no_ot) → (travel_in → travel_out | no_travel)
-- ============================================================

create or replace function next_punches(p_emp text, p_date date) returns text[]
language plpgsql stable security definer set search_path = public as $$
declare k text[];
begin
  select coalesce(array_agg(kind::text), '{}') into k from punches where emp_code = p_emp and work_date = p_date;
  if not ('work_in' = any(k))  then return array['work_in']; end if;
  if not ('work_out' = any(k)) then return array['work_out']; end if;
  if not ('ot_in' = any(k) or 'no_ot' = any(k)) then return array['ot_in','no_ot']; end if;
  if 'ot_in' = any(k) and not ('ot_out' = any(k)) then return array['ot_out']; end if;
  if not ('travel_in' = any(k) or 'no_travel' = any(k)) then return array['travel_in','no_travel']; end if;
  if 'travel_in' = any(k) and not ('travel_out' = any(k)) then return array['travel_out']; end if;
  return '{}';
end $$;

-- The working date a punch belongs to: an unfinished day started in the last 20 h, else today (IST).
create or replace function open_work_date(p_emp text) returns date
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select p.work_date from punches p
      where p.emp_code = p_emp and p.kind = 'work_in' and p.at > now() - interval '20 hours'
        and cardinality(next_punches(p_emp, p.work_date)) > 0
      order by p.at desc limit 1),
    (now() at time zone 'Asia/Kolkata')::date)
$$;

create or replace function punch_state() returns json
language plpgsql stable security definer set search_path = public as $$
declare v_emp text := my_emp_code(); v_date date;
begin
  if v_emp is null then raise exception 'Not a technician login'; end if;
  v_date := open_work_date(v_emp);
  return json_build_object(
    'emp_code', v_emp,
    'name', (select name from employees where emp_code = v_emp),
    'team', (select t.name from employees e left join teams t on t.id = e.team_id where e.emp_code = v_emp),
    'work_date', v_date,
    'site', (select json_build_object('name', s.name, 'shift', a.shift, 'opr_no', a.opr_no)
               from employees e join allotments a on a.team_id = e.team_id and a.work_date = v_date
               left join sites s on s.id = a.site_id where e.emp_code = v_emp),
    'punches', coalesce((select json_agg(json_build_object('kind', kind, 'at', at, 'dist_m', dist_m) order by at)
                           from punches where emp_code = v_emp and work_date = v_date), '[]'),
    'next', next_punches(v_emp, v_date));
end $$;

create or replace function punch(p_kind punch_kind, p_lat float8, p_lng float8, p_accuracy float8, p_photo text)
returns json language plpgsql security definer set search_path = public as $$
declare v_emp text := my_emp_code(); v_date date; v_next text[]; v_site sites%rowtype;
begin
  if v_emp is null then raise exception 'Not a technician login'; end if;
  v_date := open_work_date(v_emp);
  v_next := next_punches(v_emp, v_date);
  if not (p_kind::text = any(v_next)) then
    raise exception 'Out of order. Next: %', coalesce(nullif(array_to_string(v_next, ' / '), ''), 'day complete');
  end if;
  if p_kind not in ('no_ot','no_travel') and (p_photo is null or p_lat is null) then
    raise exception 'Selfie and location are required';
  end if;
  select s.* into v_site from employees e
    join allotments a on a.team_id = e.team_id and a.work_date = v_date
    join sites s on s.id = a.site_id
   where e.emp_code = v_emp;
  insert into punches (emp_code, work_date, kind, lat, lng, accuracy_m, dist_m, photo_path)
  values (v_emp, v_date, p_kind, p_lat, p_lng, p_accuracy, dist_m(p_lat, p_lng, v_site.lat, v_site.lng), p_photo);
  -- make sure the day shows up on the supervisor board
  insert into day_reviews (emp_code, work_date) values (v_emp, v_date) on conflict do nothing;
  return punch_state();
end $$;

-- ============================================================
-- Calculated day view — one row per technician-day (OT, TA, food, presence)
-- ============================================================

create or replace view v_day with (security_invoker = true) as
with p as (
  select emp_code, work_date,
    max(at) filter (where kind = 'work_in')    as work_in_at,
    max(at) filter (where kind = 'work_out')   as work_out_at,
    max(at) filter (where kind = 'ot_in')      as ot_in_at,
    max(at) filter (where kind = 'ot_out')     as ot_out_at,
    max(at) filter (where kind = 'travel_in')  as travel_in_at,
    max(at) filter (where kind = 'travel_out') as travel_out_at,
    bool_or(kind = 'no_ot')     as no_ot,
    bool_or(kind = 'no_travel') as no_travel,
    max(dist_m) filter (where kind = 'work_in')  as in_dist,
    max(dist_m) filter (where kind = 'work_out') as out_dist,
    max(photo_path) filter (where kind = 'work_in')  as photo_in,
    max(photo_path) filter (where kind = 'work_out') as photo_out,
    count(*) as n_punches
  from punches group by emp_code, work_date
),
k as (
  select emp_code, work_date from p
  union
  select emp_code, work_date from day_reviews
),
b as (
  select k.emp_code, k.work_date, e.name, e.role, e.is_pg, e.team_id, t.name as team, coalesce(t.is_pg, false) as team_pg, t.sort as team_sort,
    r.status, r.note, r.source, r.food_claim, r.food_approved, r.remark, r.break_min, r.approved_at,
    coalesce(r.source, 'punch') <> 'punch' as manual,
    coalesce(r.in_time,  (p.work_in_at  at time zone 'Asia/Kolkata')::time) as in_t,
    coalesce(r.out_time, (p.work_out_at at time zone 'Asia/Kolkata')::time) as out_t,
    coalesce(r.ot_start, (p.ot_in_at    at time zone 'Asia/Kolkata')::time) as ot_s,
    coalesce(r.ot_end,   (p.ot_out_at   at time zone 'Asia/Kolkata')::time) as ot_e,
    coalesce(r.travel_time,
      case when p.travel_in_at is not null then
        to_char(p.travel_in_at at time zone 'Asia/Kolkata', 'FMHH12:MI AM') ||
        coalesce(' to ' || to_char(p.travel_out_at at time zone 'Asia/Kolkata', 'FMHH12:MI AM'), '') end) as travel_time,
    coalesce(r.shift, a.shift) as shift_code,
    coalesce(r.location, si.name) as location,
    coalesce(r.opr_no, a.opr_no) as opr_no,
    coalesce(r.ta_type, a.ta_type, 'local') as ta_type,
    coalesce(r.ta_amount, a.ta_amount) as ta_custom,
    r.present as present_override,
    p.no_ot, p.no_travel, p.in_dist, p.out_dist, p.photo_in, p.photo_out, coalesce(p.n_punches, 0) as n_punches,
    p.work_in_at, p.work_out_at, p.ot_in_at, p.ot_out_at, p.travel_in_at, p.travel_out_at,
    si.lat as site_lat, coalesce(si.radius_m, s.site_radius_m) as radius,
    s.*,
    extract(dow from k.work_date)::int = any(s.off_days) as weekly_off,
    exists (select 1 from holidays h where h.day = k.work_date) as holiday
  from k
  join employees e on e.emp_code = k.emp_code
  left join teams t on t.id = e.team_id
  left join p on p.emp_code = k.emp_code and p.work_date = k.work_date
  left join day_reviews r on r.emp_code = k.emp_code and r.work_date = k.work_date
  left join allotments a on a.team_id = e.team_id and a.work_date = k.work_date
  left join sites si on si.id = a.site_id
  cross join settings s
),
c as (
  select b.*,
    weekly_off or holiday as off_day,
    case when shift_code = 'S2' or (shift_code is null and in_t is not null
              and abs(tmin(in_t) - tmin(s2_start)) < abs(tmin(in_t) - tmin(s1_start))) then 'S2' else 'S1' end as shift,
    case when in_t is null or out_t is null then null else
      greatest(0, (case when tmin(out_t) - tmin(in_t) <= 0 then tmin(out_t) - tmin(in_t) + 1440 else tmin(out_t) - tmin(in_t) end) - coalesce(break_min, 0)) end as worked_min,
    case when ot_s is not null and ot_e is not null then (tmin(ot_e) - tmin(ot_s) + 1440) % 1440 else 0 end as ot_punch_min,
    (ot_s is not null or (not manual and n_punches > 0)) as punch_mode,
    is_pg and not pg_ot as no_ot_pg
  from b
),
d as (
  select c.*,
    case when shift = 'S2' then s2_start else s1_start end as shift_start,
    case when shift = 'S2' then s2_end   else s1_end   end as shift_end,
    case when shift = 'S2' then (tmin(s2_end) - tmin(s2_start) + 1440) % 1440
                           else (tmin(s1_end) - tmin(s1_start) + 1440) % 1440 end as std_min
  from c
),
o as (
  select d.*,
    case when worked_min is null then 0
         when punch_mode then ot_punch_min + case when off_day then worked_min else 0 end
         when off_day then worked_min
         else greatest(0, worked_min - std_min) end as ot_raw_min,
    case when holiday then hol_mult when weekly_off then off_mult else 1 end as mult
  from d
)
select
  emp_code, work_date, name, role, is_pg, team_id, team, team_pg, team_sort,
  coalesce(status, 'submitted') as status, note, coalesce(source, 'punch') as source, remark,
  in_t as in_time, out_t as out_time, ot_s as ot_start, ot_e as ot_end, travel_time,
  shift, shift_start, shift_end, location, opr_no, weekly_off, holiday, off_day,
  round(worked_min / 60.0, 2) as worked_h,
  ot_raw_min,
  case when no_ot_pg then 0 else floor(ot_raw_min / (round_h * 60) + 1e-9) * round_h end as ot_actual_h,
  mult,
  case when no_ot_pg then 0 else floor(ot_raw_min / (round_h * 60) + 1e-9) * round_h end * mult as ot_h,
  no_ot_pg,
  ta_type,
  case ta_type when 'custom' then coalesce(ta_custom, 0) when 'local' then ta_local when 'factory' then ta_factory
               when 'outstation' then ta_outstation when 'night' then ta_night end as ta_amount,
  -- food: late = finished (OT end, else work end) at/after food_after, or crossed midnight
  late_out,
  case
    when team_pg or is_pg then case when late_out then case when food_approved then 'approved' else 'pending' end
                                    when food_claim or food_approved then 'noteligible' else 'none' end
    when late_out then 'auto'
    when food_approved then 'approved'
    when food_claim then 'pending'
    else 'none' end as food_status,
  food_amount,
  food_claim, food_approved,
  -- presence from GPS
  case
    when manual then 'MANUAL'
    when work_in_at is null then 'NO PUNCH IN'
    when work_out_at is null then 'NO PUNCH OUT'
    when site_lat is null then 'SITE NOT SET'
    when in_dist <= radius and out_dist <= radius then 'VERIFIED'
    else 'OUTSIDE SITE' end as presence,
  coalesce(present_override, (not manual and work_in_at is not null and work_out_at is not null
                              and site_lat is not null and in_dist <= radius and out_dist <= radius), false) as present,
  in_dist, out_dist, photo_in, photo_out, n_punches, no_ot, no_travel,
  (work_in_at is not null and work_out_at is not null and (ot_out_at is not null or no_ot)
     and (travel_out_at is not null or no_travel)) as complete,
  -- worked past shift end without OT punches (flagged, not paid)
  (punch_mode and not off_day and ot_s is null and out_t is not null
     and tmin(out_t) > tmin(shift_end) + grace_min) as past_shift_no_ot,
  (not off_day and in_t is not null and tmin(in_t) - tmin(shift_start) > grace_min) as late_start,
  max_ot_h, max_duty_h, approved_at
from (
  select o.*,
    coalesce(
      case when ot_e is not null then tmin(ot_e) >= tmin(food_after) or tmin(ot_e) < tmin(ot_s)
           else tmin(out_t) >= tmin(food_after) or tmin(out_t) <= tmin(in_t) end, false) as late_out
  from o
) z;

-- ============================================================
-- Row level security
-- ============================================================

alter table settings    enable row level security;
alter table holidays    enable row level security;
alter table teams       enable row level security;
alter table employees   enable row level security;
alter table staff       enable row level security;
alter table sites       enable row level security;
alter table allotments  enable row level security;
alter table punches     enable row level security;
alter table day_reviews enable row level security;

do $$
declare t text;
begin
  -- reference tables: everyone signed in reads, admin writes
  foreach t in array array['settings','holidays','teams','sites'] loop
    execute format('drop policy if exists read_all on %I', t);
    execute format('create policy read_all on %I for select to authenticated using (true)', t);
    execute format('drop policy if exists admin_write on %I', t);
    execute format('create policy admin_write on %I for all to authenticated using (staff_role() = ''admin'') with check (staff_role() = ''admin'')', t);
  end loop;
end $$;

drop policy if exists read_allot on allotments;
create policy read_allot on allotments for select to authenticated using (true);
drop policy if exists review_allot on allotments;
create policy review_allot on allotments for all to authenticated using (can_review()) with check (can_review());

drop policy if exists emp_read on employees;
create policy emp_read on employees for select to authenticated using (is_staff() or user_id = auth.uid());
drop policy if exists emp_admin on employees;
create policy emp_admin on employees for all to authenticated using (staff_role() = 'admin') with check (staff_role() = 'admin');

drop policy if exists staff_read on staff;
create policy staff_read on staff for select to authenticated using (is_staff());
drop policy if exists staff_admin on staff;
create policy staff_admin on staff for all to authenticated using (staff_role() = 'admin') with check (staff_role() = 'admin');

-- punches: inserted only through punch(); technicians read their own; supervisors may delete a wrong punch
drop policy if exists punch_read on punches;
create policy punch_read on punches for select to authenticated using (is_staff() or emp_code = my_emp_code());
drop policy if exists punch_delete on punches;
create policy punch_delete on punches for delete to authenticated using (can_review());

drop policy if exists review_read on day_reviews;
create policy review_read on day_reviews for select to authenticated using (is_staff() or emp_code = my_emp_code());
drop policy if exists review_write on day_reviews;
create policy review_write on day_reviews for all to authenticated using (can_review()) with check (can_review());

revoke all on function punch(punch_kind, float8, float8, float8, text) from public, anon;
revoke all on function punch_state() from public, anon;
grant execute on function punch(punch_kind, float8, float8, float8, text) to authenticated;
grant execute on function punch_state() to authenticated;

-- Explicit table access for signed-in users (newer projects may not expose new tables
-- automatically). Row level security above still decides which rows each login sees.
grant usage on schema public to authenticated;
grant select, insert, update, delete on settings, holidays, teams, employees, staff, sites, allotments, punches, day_reviews to authenticated;
grant select on v_day to authenticated;
grant usage, select on all sequences in schema public to authenticated;

-- ============================================================
-- Selfie storage (private bucket, folder per EMP code)
-- ============================================================

insert into storage.buckets (id, name, public) values ('punch-photos', 'punch-photos', false)
on conflict (id) do nothing;

drop policy if exists "tech uploads own selfies" on storage.objects;
create policy "tech uploads own selfies" on storage.objects for insert to authenticated
  with check (bucket_id = 'punch-photos' and (storage.foldername(name))[1] = public.my_emp_code());

drop policy if exists "read selfies" on storage.objects;
create policy "read selfies" on storage.objects for select to authenticated
  using (bucket_id = 'punch-photos' and (public.is_staff() or (storage.foldername(name))[1] = public.my_emp_code()));
