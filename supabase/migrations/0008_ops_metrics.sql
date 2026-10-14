-- 운영 지표 (국전 수익/비용 화면 아래 "운영 지표")   ※ 0006 을 다시 실행한 다음 실행 (판매 행에 청구처 cu 추가됨)
--   ops_metrics(p_from, p_to) : 조회 기간(YYYYMM~YYYYMM)의 아래 묶음을 한 번에 돌려줍니다.
--     inv    : 지금 남은 LOT 재고  [부서, 사업단위, 입고 후 경과 구간, 재고금액, LOT 수]
--     invTop : 입고 후 90일 넘은 재고 LOT 상위 300  [부서, 사업단위, 품목, LOT, 입고일, 마지막 판매일, 재고수량, 재고금액, 경과일]
--     sales  : 판매 발행월 기준 [부서, 년월, 품목, 청구처, 판매금액, 매출원가]           (매출원가 = 판매수량 × LOT 원가 단가)
--     pur    : 입고월 기준 [부서, 년월, 수입처, 구매금액, 배분 부대비용]
--     payee  : 부대비용 청구월 기준 [부서, 년월, 지급처, 금액]
--     fx     : 입고월 기준 [부서, 년월, 통화, 외화금액(수량×외화단가), 원화환산(외화금액×환율)]
--   규칙은 구매/판매 화면·실현 수익과 같습니다 (trade_lot_summary 사용, 자산순번 36·37 LOT 제외).
--   부서 = LOT 의 부서 (구매 행 부서, 없으면 BL 의 부서). 화면 권한(본부장 등)은 화면에서 부서로 거릅니다.

create or replace function public.kj_ymd(p text) returns text
language sql immutable as $$ select substr(regexp_replace(coalesce(p, ''), '[^0-9]', '', 'g'), 1, 8) $$;

create or replace function public.ops_metrics(p_from text, p_to text)
returns jsonb language sql stable security definer set search_path = public set jit = off as $$
with
l as materialized (select * from public.trade_lot_summary() where asset_seq not in ('36', '37')),
-- ① 재고 (지금 시점)
iv as materialized (
  select dept, biz_unit, item_no, item_name, lot_no, p_date, s_date, inv_qty, inv_amt,
    case when length(public.kj_ymd(p_date)) = 8 then (current_date - to_date(public.kj_ymd(p_date), 'YYYYMMDD')) end as age
  from l where inv_amt > 0
),
inv as (
  select dept, biz_unit,
    case when age is null then '미상' when age <= 90 then '0-90' when age <= 180 then '91-180' when age <= 365 then '181-365' else '365+' end as bk,
    sum(inv_amt) as amt, count(*) as n
  from iv group by 1, 2, 3
),
invtop as (select * from iv where age > 90 order by inv_amt desc limit 300),
-- ② 판매 (청구처·품목별 매출과 원가)
sl as (
  select l.dept, e ->> 'm' as ym, l.item_name || ' (' || l.item_no || ')' as item, coalesce(nullif(e ->> 'cu', ''), '미지정 청구처') as cust,
    (e ->> 'a')::numeric as amt, (e ->> 'q')::numeric * l.margin_unit as cogs
  from l, jsonb_array_elements(l.sales) e
  where (e ->> 'm') between p_from and p_to
),
sales as (select dept, ym, item, cust, sum(amt) as amt, sum(cogs) as cogs from sl group by 1, 2, 3, 4),
-- ③ 구매 · 배분 부대비용 (입고월)
pur as (
  select dept, substr(public.kj_ymd(p_date), 1, 6) as ym, vendor, sum(p_amt) as p_amt, sum(alloc_exp) as alloc
  from l where p_amt > 0 and substr(public.kj_ymd(p_date), 1, 6) between p_from and p_to group by 1, 2, 3
),
-- ④ 부대비용 지급처 (청구월) — BL 의 부서는 8100011 행 기준
e1 as materialized (
  select id, public.kj_norm(data) as d from public.rows where dataset = 'expense'
),
e2 as materialized (
  select id, d, public.kj_clean(public.kj_v(d, 'BLNO', 'BL번호')) as bl, public.kj_clean(public.kj_v(d, 'UMEXPENSEITEM', '비용항목코드')) as code from e1
),
blb as (
  select distinct on (bl) bl, public.kj_clean(public.kj_v(d, 'DEPTNAME', '부서')) as dept
  from e2 where bl <> '' and code like '%8100011%' order by bl, id desc
),
lotbl as (select distinct on (bl_no) bl_no, dept from l where bl_no <> '' order by bl_no, dept),
payee as (
  select coalesce(nullif(lb.dept, ''), nullif(b.dept, ''), '미지정 부서') as dept,
    substr(public.kj_ymd(public.kj_v(e2.d, 'COSTDATE', '청구일자', '일자')), 1, 6) as ym,
    coalesce(nullif(public.kj_clean(public.kj_v(e2.d, 'COSTCUSTNAME', '지급처', '거래처')), ''), '미지정 지급처') as payee,
    sum(public.kj_round(public.kj_num(public.kj_v(e2.d, 'TOTDOMAMT', '발생금액', '원화금액', 'DOMAMT')))) as amt
  from e2 left join blb b on b.bl = e2.bl left join lotbl lb on lb.bl_no = e2.bl
  where e2.code not like '%8100011%'
    and substr(public.kj_ymd(public.kj_v(e2.d, 'COSTDATE', '청구일자', '일자')), 1, 6) between p_from and p_to
  group by 1, 2, 3
),
-- ⑤ 외화 구매 (입고월) — 폐기 제외, 통화가 원화가 아닌 행
p1 as materialized (
  select public.kj_norm(data) as d from public.rows where dataset = 'purchase'
),
p2 as materialized (
  select coalesce(nullif(public.kj_clean(public.kj_v(d, 'DEPTNAME', '부서')), ''), '미지정 부서') as dept,
    substr(public.kj_ymd(public.kj_v(d, 'PERMITDATE', '수입면장일자', '구매일자')), 1, 6) as ym,
    upper(public.kj_clean(public.kj_v(d, 'CURRNAME', '통화'))) as cur,
    public.kj_num(public.kj_v(d, 'QTY', '수량')) * public.kj_num(public.kj_v(d, 'PRICE', '단가')) as f,
    public.kj_num(public.kj_v(d, 'EXRATE', '환율')) as rate,
    public.kj_clean(public.kj_v(d, 'SMIMPKINDNAME', '수입구분', 'SMIMPKIND')) as kind,
    public.kj_clean(public.kj_v(d, 'ASSETSEQ', '자산순번')) as asset
  from p1
),
fx as (
  select dept, ym, cur, sum(f) as f, sum(f * rate) as won from p2
  where kind <> '폐기' and asset not in ('36', '37') and cur not in ('', 'KRW', 'WON', '원') and rate > 1 and f > 0
    and ym between p_from and p_to
  group by 1, 2, 3
)
select jsonb_build_object(
  'from', p_from, 'to', p_to, 'today', to_char(current_date, 'YYYYMMDD'),
  'inv',    coalesce((select jsonb_agg(jsonb_build_array(dept, biz_unit, bk, round(amt), n)) from inv), '[]'::jsonb),
  'invTop', coalesce((select jsonb_agg(jsonb_build_array(dept, biz_unit, item_name || ' (' || item_no || ')', lot_no, p_date, s_date, inv_qty, round(inv_amt), age) order by inv_amt desc) from invtop), '[]'::jsonb),
  'sales',  coalesce((select jsonb_agg(jsonb_build_array(dept, ym, item, cust, amt, round(cogs, 2))) from sales), '[]'::jsonb),
  'pur',    coalesce((select jsonb_agg(jsonb_build_array(dept, ym, vendor, p_amt, alloc)) from pur), '[]'::jsonb),
  'payee',  coalesce((select jsonb_agg(jsonb_build_array(dept, ym, payee, amt)) from payee), '[]'::jsonb),
  'fx',     coalesce((select jsonb_agg(jsonb_build_array(dept, ym, cur, round(f, 4), round(won, 2))) from fx), '[]'::jsonb)
)
$$;

grant execute on function public.kj_ymd(text), public.ops_metrics(text, text) to authenticated;
notify pgrst, 'reload config';
