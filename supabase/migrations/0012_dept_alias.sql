-- 없어진 부서를 지금 부서로 바꿔 읽기: 운영지원팀_ATS → 보관관리_ATS
--   기초 데이터(구매 등)에 옛 부서명이 남아 있어도 계산할 때 보관관리_ATS 로 읽습니다. 원본 데이터는 바꾸지 않습니다.
--   이 파일만 실행하면 됩니다 (0006 에도 같은 내용이 들어 있어, 나중에 0006 을 다시 실행해도 유지됩니다).
-- ※ 없어진 부서 → 지금 부서: 운영지원팀_ATS → 보관관리_ATS (화면 쪽 hub.js DEPT_ALIAS 와 같이 고칠 것)
create or replace function public.kj_norm(d jsonb) returns jsonb
language sql immutable as $$
  select case when btrim(n ->> 'DEPTNAME') = '운영지원팀_ATS' then jsonb_set(n, '{DEPTNAME}', '"보관관리_ATS"'::jsonb) else n end
  from (select coalesce((select jsonb_object_agg(upper(regexp_replace(key, '[\s\r\n' || chr(65279) || ']+', '', 'g')), value) from jsonb_each(d)), '{}'::jsonb) as n) x
$$;
-- 저장해 둔 계산 결과를 비워 다음 조회 때 새 부서명으로 다시 계산
delete from public.lot_cache where true;
delete from public.calc_cache where true;
notify pgrst, 'reload config';
