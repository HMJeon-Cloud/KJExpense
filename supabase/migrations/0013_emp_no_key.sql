-- 0013 사원 키 = 사번 · 첫 비밀번호 = k + 사번 · 사원 ID = 회사 메일 앞부분
--   Supabase SQL Editor 에서 이 파일 전체를 한 번 실행하면 됩니다. (실행 후 바로 새 화면 파일을 GitHub 에 올려 주세요)
--   1) k23016 사원을 지우고 hmjeon 을 최초 관리자로 정리
--   2) 사번이 같은 사원이 둘 이상 생기지 않게 막음 (사번 = 사원을 구분하는 키)
--   3) 첫 비밀번호 / 비밀번호 초기화 = k + 사번 (사번이 비어 있으면 예전처럼 사원 ID)
--   4) 첫 로그인 때 계정 연결을 서버에서 한 번 더 확인 (첫 비밀번호를 아는 사람만 연결)
--   5) 사원 등록 · 수정을 사번 기준으로: 같은 사번이면 같은 사람 → 사원 ID 를 바꾸면 로그인 계정도 같이 바뀜

-- ---------- 1) 정리: k23016 삭제, hmjeon = 최초 관리자 ----------
do $$
declare v uuid;
begin
  if exists (select 1 from public.employees where lower(login_id) = 'hmjeon') then
    select auth_uid into v from public.employees where lower(login_id) = 'k23016';
    delete from public.employees where lower(login_id) = 'k23016';
    if v is not null then delete from auth.users where id = v; end if;
    update public.employees
       set email = public.bootstrap_admin_email(), emp_no = coalesce(nullif(btrim(emp_no), ''), '23016'),
           role = 'admin', active = true, must_change_pw = true, updated_at = now()
     where lower(login_id) = 'hmjeon';
    -- hmjeon 이 아직 로그인 전인데 예전에 만들다 만 로그인 계정이 남아 있으면 지움 (첫 로그인이 막히지 않게)
    delete from auth.users u
     where lower(u.email) like 'hmjeon@%'
       and not exists (select 1 from public.employees e where e.auth_uid = u.id);
    insert into public.logs(kind, actor, action, target) values ('employee', 'sql-0013', 'delete', 'k23016');
  end if;
end $$;

-- ---------- 2) 사번 = 키 (빈 사번은 여러 명 가능) ----------
update public.employees set emp_no = nullif(btrim(emp_no), '') where emp_no is distinct from nullif(btrim(emp_no), '');
do $$
declare d text;
begin
  select string_agg(emp_no || ' (' || ids || ')', ', ') into d from (
    select lower(emp_no) emp_no, string_agg(login_id, ', ') ids from public.employees where emp_no is not null group by lower(emp_no) having count(*) > 1) x;
  if d is not null then raise exception '사번이 같은 사원이 있습니다: %. 한 명만 남기거나 사번을 고친 뒤 다시 실행해 주세요.', d; end if;
end $$;
create unique index if not exists employees_emp_no_key on public.employees (lower(emp_no)) where emp_no is not null;

-- ---------- 3) 첫 비밀번호 ----------
-- k + 사번 (사번이 이미 k 로 시작하면 그대로). 사번이 없으면 사원 ID.
create or replace function public.initial_password(p_login_id text, p_emp_no text) returns text
language sql immutable as $$
  select case when nullif(btrim(p_emp_no), '') is null then p_login_id
              else 'k' || regexp_replace(btrim(p_emp_no), '^[kK]', '') end
$$;

-- 로그인 전: 첫 로그인 비밀번호가 맞는지 (맞다/아니다만 알려 줌)
create or replace function public.check_initial_password(p_login_id text, p_password text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.employees
                  where lower(login_id) = lower(btrim(p_login_id)) and active and auth_uid is null
                    and public.initial_password(login_id, emp_no) = p_password)
$$;
grant execute on function public.check_initial_password(text, text) to anon, authenticated;

-- ---------- 4) 첫 로그인 계정 연결: 첫 비밀번호 + 로그인 계정 이메일을 서버에서 확인 ----------
drop function if exists public.link_my_account(text);
create or replace function public.link_my_account(p_login_id text, p_password text) returns boolean
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if auth.uid() is null then return false; end if;
  update public.employees e set auth_uid = auth.uid(), updated_at = now()
   where lower(e.login_id) = lower(btrim(p_login_id)) and e.auth_uid is null and e.active
     and public.initial_password(e.login_id, e.emp_no) = p_password
     and lower((select u.email from auth.users u where u.id = auth.uid())) like lower(btrim(e.login_id)) || '@%';
  get diagnostics n = row_count;
  return n > 0;
end $$;
grant execute on function public.link_my_account(text, text) to authenticated;

-- 최초 설정(사원정보가 비어 있을 때)에도 사번을 받음
drop function if exists public.bootstrap_admin(text, text, text, text);
create or replace function public.bootstrap_admin(p_login_id text, p_name text, p_email text, p_dept text default null, p_emp_no text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.employees) then raise exception '이미 사원정보가 있습니다.'; end if;
  if lower(p_email) <> lower(public.bootstrap_admin_email()) then raise exception '최초 관리자 이메일이 아닙니다.'; end if;
  insert into public.employees(login_id, name, email, emp_no, dept, role, must_change_pw)
  values (btrim(p_login_id), p_name, p_email, nullif(btrim(p_emp_no), ''), p_dept, 'admin', true);
  insert into public.logs(kind, actor, action, target) values ('employee', p_login_id, 'bootstrap', p_login_id);
end $$;
grant execute on function public.bootstrap_admin(text, text, text, text, text) to anon, authenticated;

-- 관리자: 비밀번호 초기화 = k + 사번
create or replace function public.admin_reset_password(p_login_id text)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare v_uid uuid; v_pw text;
begin
  if not public.is_admin() then raise exception '관리자만 초기화할 수 있습니다.'; end if;
  select auth_uid, public.initial_password(login_id, emp_no) into v_uid, v_pw from public.employees where login_id = p_login_id;
  if v_uid is not null then
    update auth.users set encrypted_password = crypt(v_pw, gen_salt('bf')), updated_at = now() where id = v_uid;
  end if;
  update public.employees set must_change_pw = true, updated_at = now() where login_id = p_login_id;
  insert into public.logs(kind, actor, action, target) values ('employee', public.current_login_id(), 'reset_password', p_login_id);
end $$;

-- ---------- 5) 사원 등록 · 수정 (사번 기준) ----------
-- 찾는 순서: id(화면에서 고른 사원) → 사번 → 사원 ID. 찾으면 수정, 없으면 새로 등록.
-- 사원 ID 가 바뀌면 로그인 계정 이메일도 같이 바꿔 새 ID 로 로그인됩니다 (비밀번호는 그대로).
create or replace function public.admin_upsert_employee(p jsonb)
returns public.employees language plpgsql security definer set search_path = public as $$
declare r public.employees; v_id bigint; v_login text; v_no text; v_old text; v_uid uuid; v_dom text;
begin
  if not public.is_admin() then raise exception '관리자만 사원을 관리할 수 있습니다.'; end if;
  v_login := btrim(coalesce(p->>'login_id', '')); v_no := nullif(btrim(coalesce(p->>'emp_no', '')), '');
  if v_login = '' then raise exception '사원 ID 를 넣어 주세요.'; end if;
  if btrim(coalesce(p->>'name', '')) = '' then raise exception '이름을 넣어 주세요.'; end if;
  if v_login !~ '^[A-Za-z0-9._-]+$' then raise exception '사원 ID 는 영문 · 숫자 · . _ - 만 쓸 수 있습니다: %', v_login; end if;

  if nullif(p->>'id', '') is not null then select id into v_id from public.employees where id = (p->>'id')::bigint; end if;
  if v_id is null and v_no is not null then select id into v_id from public.employees where lower(emp_no) = lower(v_no); end if;
  if v_id is null then select id into v_id from public.employees where lower(login_id) = lower(v_login); end if;

  if v_no is not null and exists (select 1 from public.employees where lower(emp_no) = lower(v_no) and id is distinct from v_id) then
    raise exception '사번 % 은(는) 이미 다른 사원이 쓰고 있습니다.', v_no; end if;
  if exists (select 1 from public.employees where lower(login_id) = lower(v_login) and id is distinct from v_id) then
    raise exception '사원 ID % 은(는) 이미 다른 사원이 쓰고 있습니다.', v_login; end if;

  if v_id is null then
    insert into public.employees(login_id, name, email, emp_no, dept, title, grade, role, screen_depts, active, must_change_pw)
    values (v_login, p->>'name', p->>'email', v_no, p->>'dept', p->>'title', p->>'grade',
            coalesce(p->>'role','user'), coalesce(p->'screen_depts','{}'::jsonb), coalesce((p->>'active')::boolean, true), true)
    returning * into r;
  else
    select login_id, auth_uid into v_old, v_uid from public.employees where id = v_id;
    update public.employees set
      login_id = v_login, name = p->>'name', email = p->>'email', emp_no = v_no, dept = p->>'dept', title = p->>'title', grade = p->>'grade',
      role = coalesce(p->>'role', role), screen_depts = coalesce(p->'screen_depts', screen_depts),
      active = coalesce((p->>'active')::boolean, active), updated_at = now()
    where id = v_id returning * into r;
    -- 사원 ID 가 바뀌었고 이미 로그인 계정이 있으면 계정 이메일(= 사원 ID@도메인)도 바꿈
    if v_uid is not null and lower(v_old) <> lower(v_login) then
      select split_part(email, '@', 2) into v_dom from auth.users where id = v_uid;
      update auth.users set email = lower(v_login) || '@' || v_dom, updated_at = now() where id = v_uid;
      if to_regclass('auth.identities') is not null then
        execute 'update auth.identities set identity_data = identity_data || jsonb_build_object(''email'', $1) where user_id = $2 and provider = ''email'''
          using lower(v_login) || '@' || v_dom, v_uid;
      end if;
    end if;
    if lower(v_old) <> lower(v_login) then
      insert into public.logs(kind, actor, action, target) values ('employee', public.current_login_id(), 'rename ' || v_old, v_login);
    end if;
  end if;
  insert into public.logs(kind, actor, action, target) values ('employee', public.current_login_id(), 'upsert', r.login_id);
  return r;
end $$;

notify pgrst, 'reload schema';
