-- 데이터 로딩 개선 (0001·0002 다음에 실행)
-- 1) 데이터셋 전체를 한 번에 받기 (1,000행 페이지 제한 회피)
create or replace function public.dataset_rows(p_dataset text)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(data order by id), '[]'::jsonb) from public.rows where dataset = p_dataset
$$;
grant execute on function public.dataset_rows(text) to authenticated;

-- 2) 데이터셋별 버전(마지막 업로드 시각) — 브라우저 캐시가 바뀐 것만 다시 받도록
create or replace function public.dataset_versions()
returns table(dataset text, ver text, cnt bigint)
language sql stable security definer set search_path = public as $$
  select dataset, to_char(max(created_at), 'YYYYMMDDHH24MISSMS'), count(*) from public.rows group by dataset
$$;
grant execute on function public.dataset_versions() to authenticated;

-- 3) 페이지 조회 경로 인덱스 + 쿼리 시간 제한 완화 (기본 8초 → 60초; 무료 플랜 DB 가 느릴 때 끊기지 않도록)
create index if not exists rows_ds_id on public.rows (dataset, id);
alter role authenticated set statement_timeout = '60s';
alter role anon set statement_timeout = '15s';
notify pgrst, 'reload config';
