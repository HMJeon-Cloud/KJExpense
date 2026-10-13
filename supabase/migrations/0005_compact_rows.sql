-- 전송량 줄이기 (0004 다음에 실행)
--   행마다 반복되는 열 이름을 빼고 {cols:[열이름…], rows:[[값…]…]} 로 보냅니다.
--   같은 데이터가 보통 1/4 ~ 1/3 크기로 줄어듭니다. 화면 코드는 받은 뒤 원래 모양(객체)으로 되돌려 쓰므로 계산은 동일합니다.

create or replace function public.dataset_rows_compact(p_dataset text)
returns jsonb language sql stable security definer set search_path = public as $$
  with k as (select distinct jsonb_object_keys(data) as k from public.rows where dataset = p_dataset),
  c as (select coalesce(array_agg(k order by k), '{}') as a from k)
  select jsonb_build_object(
    'cols', (select coalesce(jsonb_agg(k order by k), '[]'::jsonb) from k),
    'rows', coalesce((select jsonb_agg((select jsonb_agg(r.data -> u.kk order by u.o) from unnest(c.a) with ordinality as u(kk, o)) order by r.id) from public.rows r, c where r.dataset = p_dataset), '[]'::jsonb)
  )
$$;

create or replace function public.voucher_rows_range_compact(p_from text, p_to text)
returns jsonb language sql stable security definer set search_path = public as $$
  with src as (select id, data from public.rows where dataset = 'voucher' and public.kj_voucher_ym(data) between p_from and p_to),
  k as (select distinct jsonb_object_keys(data) as k from src),
  c as (select coalesce(array_agg(k order by k), '{}') as a from k)
  select jsonb_build_object(
    'cols', (select coalesce(jsonb_agg(k order by k), '[]'::jsonb) from k),
    'rows', coalesce((select jsonb_agg((select jsonb_agg(s.data -> u.kk order by u.o) from unnest(c.a) with ordinality as u(kk, o)) order by s.id) from src s, c), '[]'::jsonb)
  )
$$;

grant execute on function public.dataset_rows_compact(text), public.voucher_rows_range_compact(text, text) to authenticated;
notify pgrst, 'reload config';
