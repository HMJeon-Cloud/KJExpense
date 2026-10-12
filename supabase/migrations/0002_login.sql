-- 로그인·계정 관리 (0001 다음에 실행)
-- 전제: Authentication > Providers > Email 에서 "Allow new users to sign up" 켜기, "Confirm email" 끄기
--
-- 흐름: 사원정보 입력 → 로그인 ID = 사원 ID, 초기 비밀번호 = 사원 ID → 첫 로그인 때 계정이 자동 생성되고 비밀번호 변경
-- 최초 관리자: 이메일이 아래 BOOTSTRAP_ADMIN_EMAIL 인 사원 (사원정보가 비어 있을 때 로그인 화면의 '최초 설정' 으로 본인을 등록)

create or replace function public.bootstrap_admin_email() returns text language sql immutable as $$ select 'hmjeon@kukjeon.co.kr' $$;

-- 이메일이 최초 관리자 이메일이면 항상 admin
create or replace function public.employees_admin_guard() returns trigger language plpgsql as $$
begin
  if lower(coalesce(new.email,'')) = lower(public.bootstrap_admin_email()) then new.role := 'admin'; new.active := true; end if;
  return new;
end $$;
drop trigger if exists employees_admin_guard on public.employees;
create trigger employees_admin_guard before insert or update on public.employees for each row execute function public.employees_admin_guard();

-- 사원정보가 비어 있는가 (로그인 화면이 '최초 설정' 을 보여줄지 판단, 로그인 전 호출)
create or replace function public.needs_bootstrap() returns boolean
language sql stable security definer set search_path = public as $$ select not exists (select 1 from public.employees) $$;
grant execute on function public.needs_bootstrap() to anon, authenticated;

-- 최초 관리자 등록: 사원정보가 비어 있고 이메일이 일치할 때만 (로그인 전 호출 가능)
create or replace function public.bootstrap_admin(p_login_id text, p_name text, p_email text, p_dept text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.employees) then raise exception '이미 사원정보가 있습니다.'; end if;
  if lower(p_email) <> lower(public.bootstrap_admin_email()) then raise exception '최초 관리자 이메일이 아닙니다.'; end if;
  insert into public.employees(login_id, name, email, dept, role, must_change_pw) values (p_login_id, p_name, p_email, p_dept, 'admin', true);
  insert into public.logs(kind, actor, action, target) values ('employee', p_login_id, 'bootstrap', p_login_id);
end $$;
grant execute on function public.bootstrap_admin(text, text, text, text) to anon, authenticated;

-- 로그인 전: 이 ID 가 아직 계정이 없는 초기 상태인지 (true 면 앱이 비밀번호=ID 로 signUp 후 로그인)
create or replace function public.login_needs_signup(p_login_id text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.employees where lower(login_id) = lower(p_login_id) and active and auth_uid is null)
$$;
grant execute on function public.login_needs_signup(text) to anon, authenticated;

-- 로그인 후: 방금 만든 auth 계정을 사원 행에 연결
create or replace function public.link_my_account(p_login_id text) returns void
language sql security definer set search_path = public as $$
  update public.employees set auth_uid = auth.uid(), updated_at = now()
  where lower(login_id) = lower(p_login_id) and auth_uid is null and auth.uid() is not null
$$;

-- 관리자: 사원 등록/수정 (계정은 첫 로그인 때 자동 생성되므로 여기선 정보만 저장)
create or replace function public.admin_upsert_employee(p jsonb)
returns public.employees language plpgsql security definer set search_path = public as $$
declare r public.employees;
begin
  if not public.is_admin() then raise exception '관리자만 사원을 관리할 수 있습니다.'; end if;
  insert into public.employees(login_id, name, email, emp_no, dept, title, grade, role, screen_depts, active, must_change_pw)
  values (p->>'login_id', p->>'name', p->>'email', p->>'emp_no', p->>'dept', p->>'title', p->>'grade',
          coalesce(p->>'role','user'), coalesce(p->'screen_depts','{}'::jsonb), coalesce((p->>'active')::boolean, true), true)
  on conflict (login_id) do update set
    name = excluded.name, email = excluded.email, emp_no = excluded.emp_no, dept = excluded.dept, title = excluded.title,
    grade = excluded.grade, role = excluded.role, screen_depts = excluded.screen_depts, active = excluded.active, updated_at = now()
  returning * into r;
  insert into public.logs(kind, actor, action, target) values ('employee', public.current_login_id(), 'upsert', r.login_id);
  return r;
end $$;

-- 관리자: 비밀번호 초기화 (= 사원 ID). 계정이 있으면 비밀번호 교체, 없으면 첫 로그인 때 자동 생성
create or replace function public.admin_reset_password(p_login_id text)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare v_uid uuid;
begin
  if not public.is_admin() then raise exception '관리자만 초기화할 수 있습니다.'; end if;
  select auth_uid into v_uid from public.employees where login_id = p_login_id;
  if v_uid is not null then
    update auth.users set encrypted_password = crypt(p_login_id, gen_salt('bf')), updated_at = now() where id = v_uid;
  end if;
  update public.employees set must_change_pw = true, updated_at = now() where login_id = p_login_id;
  insert into public.logs(kind, actor, action, target) values ('employee', public.current_login_id(), 'reset_password', p_login_id);
end $$;

-- 관리자: 사원 삭제 (계정 포함)
create or replace function public.admin_delete_employee(p_login_id text)
returns void language plpgsql security definer set search_path = public as $$
declare v_uid uuid;
begin
  if not public.is_admin() then raise exception '관리자만 삭제할 수 있습니다.'; end if;
  if lower((select email from public.employees where login_id = p_login_id)) = lower(public.bootstrap_admin_email()) then raise exception '최초 관리자는 삭제할 수 없습니다.'; end if;
  select auth_uid into v_uid from public.employees where login_id = p_login_id;
  delete from public.employees where login_id = p_login_id;
  if v_uid is not null then delete from auth.users where id = v_uid; end if;
  insert into public.logs(kind, actor, action, target) values ('employee', public.current_login_id(), 'delete', p_login_id);
end $$;
