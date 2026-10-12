-- ============================================================
-- 국전 비용 현황 · Supabase 스키마 v1
-- Supabase 대시보드 > SQL Editor 에 붙여넣고 Run
-- ============================================================

create extension if not exists pgcrypto;

-- ---------- 1. 사원 (로그인 계정 = 사원) ----------
create table if not exists public.employees (
  id          bigserial primary key,
  login_id    text not null unique,            -- 사원 ID (로그인 ID, 초기 비밀번호)
  auth_uid    uuid unique,                     -- auth.users.id (계정 생성 후 연결)
  name        text not null,
  email       text,
  emp_no      text,                            -- 사번
  dept        text,                            -- 부서
  title       text,                            -- 직책
  grade       text,                            -- 직위
  role        text not null default 'user' check (role in ('admin','all','user')),
  screen_depts jsonb not null default '{}'::jsonb,  -- { "화면ID": ["부서", ...] }  (기존 권한 모델 유지)
  active      boolean not null default true,
  must_change_pw boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ---------- 2. 데이터 행 (11개 데이터셋 공용) ----------
-- dataset: purchase | expense | sale | voucher | dept | headcount | synth | mfgcost | matinput | etcio | stock
-- data   : 엑셀 한 행 그대로 (헤더 = 키). 기존 화면 로직이 컬럼 별칭으로 읽으므로 구조 변경 없이 사용 가능.
create table if not exists public.rows (
  id        bigserial primary key,
  dataset   text not null,
  ym        text,                              -- 'YYYYMM' (업로드 시 지정 또는 날짜 컬럼에서 추출)
  batch_id  uuid not null,
  data      jsonb not null,
  -- 자주 쓰는 키는 생성 컬럼으로 뽑아 인덱스
  item_no   text generated always as (upper(coalesce(data->>'ItemNo', data->>'ITEMNO', data->>'품번'))) stored,
  lot_no    text generated always as (upper(coalesce(data->>'LotNo', data->>'LOTNO', data->>'LOT번호'))) stored,
  dept_name text generated always as (coalesce(data->>'DeptName', data->>'DEPTNAME', data->>'부서명', data->>'부서')) stored,
  created_at timestamptz not null default now()
);
create index if not exists rows_ds_ym on public.rows (dataset, ym);
create index if not exists rows_ds_item_lot on public.rows (dataset, item_no, lot_no);
create index if not exists rows_ds_dept on public.rows (dataset, dept_name);
create index if not exists rows_batch on public.rows (batch_id);

-- ---------- 3. 업로드 이력 ----------
create table if not exists public.upload_batches (
  id          uuid primary key default gen_random_uuid(),
  dataset     text not null,
  ym          text,
  mode        text not null check (mode in ('replace_month','append','replace_all')),
  filename    text,
  row_count   integer not null default 0,
  columns     jsonb,                           -- 인식된 헤더 목록
  uploaded_by text,                            -- employees.login_id
  created_at  timestamptz not null default now()
);

-- ---------- 4. 설정 (배분 비율·품목·원자재·지원 내역·마감월) ----------
-- key: groups | items | support | closeMonth  (기존 ALLOC_CONFIG 구조 그대로 분리 저장)
create table if not exists public.config (
  key         text primary key,
  value       jsonb not null,
  updated_by  text,
  updated_at  timestamptz not null default now()
);

create table if not exists public.config_history (
  id          bigserial primary key,
  key         text not null,
  value       jsonb not null,                  -- 저장 직전 스냅샷
  summary     text,
  changed_by  text,
  created_at  timestamptz not null default now()
);
create index if not exists cfg_hist_key on public.config_history (key, created_at desc);

-- ---------- 5. 로그 (접속·변경) ----------
create table if not exists public.logs (
  id          bigserial primary key,
  kind        text not null,                   -- access | config | upload | employee
  actor       text,                            -- login_id
  action      text,
  target      text,
  detail      jsonb,
  ok          boolean default true,
  created_at  timestamptz not null default now()
);
create index if not exists logs_kind_time on public.logs (kind, created_at desc);

-- ---------- 6. 헬퍼 함수 ----------
create or replace function public.current_login_id() returns text
language sql stable security definer set search_path = public as $$
  select login_id from public.employees where auth_uid = auth.uid() and active limit 1
$$;

create or replace function public.current_role_name() returns text
language sql stable security definer set search_path = public as $$
  select role from public.employees where auth_uid = auth.uid() and active limit 1
$$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select role = 'admin' from public.employees where auth_uid = auth.uid() and active limit 1), false)
$$;

-- 설정 저장: 이전 값을 history 에 남기고 upsert (한 트랜잭션)
create or replace function public.save_config(p_key text, p_value jsonb, p_summary text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_old jsonb; v_who text;
begin
  if not public.is_admin() then raise exception '관리자만 설정을 저장할 수 있습니다.'; end if;
  v_who := public.current_login_id();
  select value into v_old from public.config where key = p_key;
  if v_old is not null then
    insert into public.config_history(key, value, summary, changed_by) values (p_key, v_old, p_summary, v_who);
  end if;
  insert into public.config(key, value, updated_by, updated_at) values (p_key, p_value, v_who, now())
    on conflict (key) do update set value = excluded.value, updated_by = excluded.updated_by, updated_at = now();
  insert into public.logs(kind, actor, action, target, detail) values ('config', v_who, 'save', p_key, jsonb_build_object('summary', p_summary));
end $$;

-- 업로드: 배치 등록 + (교체 모드면) 기존 행 삭제. 행 insert 는 클라이언트가 batch_id 로 수행
create or replace function public.begin_upload(p_dataset text, p_ym text, p_mode text, p_filename text, p_columns jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_who text;
begin
  if not public.is_admin() then raise exception '관리자만 업로드할 수 있습니다.'; end if;
  v_who := public.current_login_id();
  insert into public.upload_batches(dataset, ym, mode, filename, columns, uploaded_by)
    values (p_dataset, p_ym, p_mode, p_filename, p_columns, v_who) returning id into v_id;
  if p_mode = 'replace_month' then
    delete from public.rows where dataset = p_dataset and ym = p_ym;
  elsif p_mode = 'replace_all' then
    delete from public.rows where dataset = p_dataset;
  end if;
  return v_id;
end $$;

create or replace function public.finish_upload(p_batch uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare v_n integer; v_b record;
begin
  if not public.is_admin() then raise exception '관리자만 업로드할 수 있습니다.'; end if;
  select count(*) into v_n from public.rows where batch_id = p_batch;
  update public.upload_batches set row_count = v_n where id = p_batch returning * into v_b;
  insert into public.logs(kind, actor, action, target, detail)
    values ('upload', public.current_login_id(), v_b.mode, v_b.dataset, jsonb_build_object('ym', v_b.ym, 'rows', v_n, 'file', v_b.filename));
  return v_n;
end $$;

-- 데이터셋별 월 목록·건수 (업로드 화면 현황)
create or replace function public.dataset_summary()
returns table(dataset text, ym text, cnt bigint, last_at timestamptz)
language sql stable security definer set search_path = public as $$
  select dataset, ym, count(*), max(created_at) from public.rows group by dataset, ym order by dataset, ym
$$;

-- ---------- 7. RLS ----------
alter table public.employees      enable row level security;
alter table public.rows           enable row level security;
alter table public.upload_batches enable row level security;
alter table public.config         enable row level security;
alter table public.config_history enable row level security;
alter table public.logs           enable row level security;

-- 사원: 본인 행 + 관리자 전체. 수정은 관리자(Edge Function 이 service role 로 처리)
drop policy if exists emp_select on public.employees;
create policy emp_select on public.employees for select to authenticated
  using (auth_uid = auth.uid() or public.is_admin());

-- 데이터: 로그인 사용자 읽기, 쓰기는 관리자
drop policy if exists rows_select on public.rows;
create policy rows_select on public.rows for select to authenticated using (true);
drop policy if exists rows_write on public.rows;
create policy rows_write on public.rows for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists batches_select on public.upload_batches;
create policy batches_select on public.upload_batches for select to authenticated using (true);

drop policy if exists config_select on public.config;
create policy config_select on public.config for select to authenticated using (true);
drop policy if exists cfg_hist_select on public.config_history;
create policy cfg_hist_select on public.config_history for select to authenticated using (public.is_admin());

drop policy if exists logs_insert on public.logs;
create policy logs_insert on public.logs for insert to authenticated with check (true);
drop policy if exists logs_select on public.logs;
create policy logs_select on public.logs for select to authenticated using (public.is_admin());

-- 본인 비밀번호 변경 완료 표시
create or replace function public.clear_must_change_pw()
returns void language sql security definer set search_path = public as $$
  update public.employees set must_change_pw = false, updated_at = now() where auth_uid = auth.uid()
$$;

-- 설정 복구 (관리자)
create or replace function public.restore_config(p_history_id bigint)
returns void language plpgsql security definer set search_path = public as $$
declare h record;
begin
  if not public.is_admin() then raise exception '관리자만 복구할 수 있습니다.'; end if;
  select * into h from public.config_history where id = p_history_id;
  if h is null then raise exception '이력이 없습니다.'; end if;
  perform public.save_config(h.key, h.value, '복구: #' || p_history_id);
end $$;

-- ---------- 8. 기본 설정값 ----------
insert into public.config(key, value) values
  ('groups', '{}'::jsonb),
  ('items',  '{"defaultPct":100,"defaultPctSyn":100,"byItem":{},"byMat":{}}'::jsonb),
  ('support','{"byMonth":{}}'::jsonb),
  ('closeMonth', '""'::jsonb)
on conflict (key) do nothing;
