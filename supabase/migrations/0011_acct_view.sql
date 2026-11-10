-- 회계 기준 보기 (국전 수익/비용(실현 수익) · 운영 지표 화면)   ※ 0008 을 다시 실행한 다음 실행
--   손익계산서와 같은 구조(매출 → 매출원가 → 매출총이익 → 판관비 → 영업이익)로 보여주기 위한 회사 전체·부서별 월 금액을 돌려줍니다.
--   acct_view() :
--     sales    {년월: 판매금액}                 판매 데이터 전체 (발행월)                    = 손익계산서 매출액 − 결산 매출
--     settle   {년월: 결산 매출}                전표 상품·제품·수수료매출(결산) (대변 − 차변)
--     oh.pool  {년월: 음성공장 제조비용}        전표 원재료타계정이입액(소재)_잡손실 (그 달 발생)   = 손익계산서 '타계정에서제품대체액'의 대부분
--     oh.full / oh.byDept / oh.byBU             그중 그 달에 '판매된' 소재 제품 몫 (회계 시점: 팔릴 때 매출원가)
--     oh.unalloc {년월}                         그 달 생산입고된 소재 제품이 없어 LOT 에 얹지 못한 금액 (그 달 원가로 처리)
--     disp.full / disp.byDept                   폐기 수량 × LOT 원가 (폐기월) — 참고용 (손익계산서에서는 매출원가 밖으로 대체됨)
create or replace function public.acct_view_q()
returns jsonb language sql stable security definer set search_path = public set jit = off as $$
with
la as materialized (select * from public.trade_lot_summary()),
loh as materialized (select * from public.acct_lot_oh()),
pool as materialized (select * from public.acct_oh_pool() where length(ym) = 6),
s0 as materialized (select public.kj_norm(data) as d from public.rows where dataset = 'sale'),
sales as (
  select substr(public.kj_ymd(public.kj_v(d, 'BILLDATE', '청구일자', '판매일자', '일자')), 1, 6) as ym,
         sum(public.kj_round(public.kj_num(public.kj_v(d, 'DOMAMT', '판매금액', '원화금액')))) as v
  from s0 group by 1
),
v0 as materialized (select public.kj_norm(data) as d from public.rows where dataset = 'voucher' and data::text like '%매출(결산)%'),
settle as (
  select substr(public.kj_ymd(public.kj_v(d, 'ACCDATE', '회계일')), 1, 6) as ym,
         sum(public.kj_num(public.kj_v(d, 'CRAMT', '대변금액')) - public.kj_num(public.kj_v(d, 'DRAMT', '차변금액'))) as v
  from v0 where replace(coalesce(public.kj_v(d, 'ACCNAME', '계정과목'), ''), ' ', '') in ('상품매출(결산)', '제품매출(결산)', '수수료매출(결산)')
  group by 1
),
-- 판매된 몫 (판매 발행월)
ohs as (
  select trim(l.dept) as dp, trim(l.biz_unit) as bu, e ->> 'm' as ym, sum((e ->> 'q')::numeric * oh.oh_unit) as v
  from la l join loh oh on oh.lot_key = l.lot_key, jsonb_array_elements(l.sales) e
  where length(e ->> 'm') = 6 group by 1, 2, 3
),
unalloc as (select p.ym, p.amt as v from pool p where p.amt <> 0 and not exists (select 1 from loh where loh.ym = p.ym)),
-- 폐기 (참고): 폐기 행의 LOT·품번 → LOT 원가
d0 as materialized (
  select public.kj_norm(data) as d from public.rows where dataset = 'purchase' and data::text like '%폐기%'
),
d1 as (
  select upper(public.kj_clean(public.kj_v(d, 'LOTNO'))) as lot_u,
    upper(public.kj_clean(public.kj_v(d, 'ITEMNOCHK', 'ITEMNO', '품번'))) as item_u, upper(public.kj_clean(public.kj_v(d, 'ITEMNO', 'ITEMNOCHK', '품번'))) as alt_u,
    substr(public.kj_ymd(public.kj_v(d, 'PERMITDATE', '수입면장일자', '구매일자')), 1, 6) as ym, abs(public.kj_num(public.kj_v(d, 'QTY', '수량'))) as q
  from d0 where public.kj_clean(public.kj_v(d, 'SMIMPKINDNAME', '수입구분', 'SMIMPKIND')) = '폐기'
),
disp as (
  select trim(l.dept) as dp, d1.ym, sum(d1.q * (l.margin_unit + coalesce(oh.oh_unit, 0))) as v
  from d1
  left join la l1 on l1.lot_key = d1.lot_u || '_' || d1.item_u
  left join la l2 on l1.lot_key is null and l2.lot_key = d1.lot_u || '_' || d1.alt_u
  join la l on l.lot_key = coalesce(l1.lot_key, l2.lot_key)
  left join loh oh on oh.lot_key = l.lot_key
  where d1.lot_u <> '' and length(d1.ym) = 6 group by 1, 2
)
select jsonb_build_object(
  'sales',  coalesce((select jsonb_object_agg(ym, v) from sales where length(ym) = 6), '{}'::jsonb),
  'settle', coalesce((select jsonb_object_agg(ym, v) from settle where length(ym) = 6), '{}'::jsonb),
  'oh', jsonb_build_object(
    'pool',    coalesce((select jsonb_object_agg(ym, amt) from pool), '{}'::jsonb),
    'full',    coalesce((select jsonb_object_agg(ym, round(v)) from (select ym, sum(v) v from ohs group by ym) a), '{}'::jsonb),
    'byDept',  coalesce((select jsonb_object_agg(dp, o) from (select dp, jsonb_object_agg(ym, round(v)) o from (select dp, ym, sum(v) v from ohs where dp <> '' group by dp, ym) b group by dp) c), '{}'::jsonb),
    'byBU',    coalesce((select jsonb_object_agg(bu, o) from (select bu, jsonb_object_agg(ym, round(v)) o from (select bu, ym, sum(v) v from ohs where bu <> '' group by bu, ym) b group by bu) c), '{}'::jsonb),
    'unalloc', coalesce((select jsonb_object_agg(ym, v) from unalloc), '{}'::jsonb)
  ),
  'disp', jsonb_build_object(
    'full',   coalesce((select jsonb_object_agg(ym, round(v)) from (select ym, sum(v) v from disp group by ym) a), '{}'::jsonb),
    'byDept', coalesce((select jsonb_object_agg(dp, o) from (select dp, jsonb_object_agg(ym, round(v)) o from disp where dp <> '' group by dp) c), '{}'::jsonb)
  )
)
$$;

-- 화면이 부르는 함수 (0006 의 캐시 사용 — 구매·판매·전표가 바뀌면 다시 계산)
create or replace function public.acct_view()
returns jsonb language plpgsql volatile security definer set search_path = public set jit = off as $$
declare v text; r jsonb;
begin
  v := public.ensure_lot_cache() || '|' || coalesce((select count(*) || ':' || max(id) from public.rows where dataset = 'voucher'), '');
  r := public.kj_cached('acct', v);
  if r is null then r := public.acct_view_q(); perform public.kj_cache_put('acct', v, r); end if;
  return r;
end $$;
grant execute on function public.acct_view(), public.acct_view_q() to authenticated;
notify pgrst, 'reload config';
