-- B단계 2차-1: 구매/판매 LOT 요약을 DB가 계산 (0005 다음에 실행)
--   기존 화면 코드(trade.js processData → lotSummaryRows)와 같은 규칙으로 LOT별 매출·원가·실현수익·재고를 만들고,
--   판매 발행월 기준 사업단위별/부서별 월 수익(marginMonthlyByBU/ByDept)을 돌려줍니다.
--   JS 와의 대응은 각 단계 주석에 적었습니다. 검증 화면(설정 › 집계 검증)에서 JS 값과 대조합니다.

-- 숫자 변환을 비어 있음(null)도 0 으로 (0004 의 kj_num 을 null 허용으로 교체)
create or replace function public.kj_num(p text) returns numeric
language plpgsql immutable as $$
declare v numeric;
begin
  if p is null then return 0; end if;
  begin
    v := nullif(regexp_replace(replace(p, ',', ''), '^\s*([-+]?[0-9]*\.?[0-9]+).*$', '\1'), '')::numeric;
  exception when others then v := 0; end;
  return coalesce(v, 0);
end $$;

-- 열 이름 정규화: 대문자 + 공백/줄바꿈/BOM 제거   ※ JS normalizeRow
create or replace function public.kj_norm(d jsonb) returns jsonb
language sql immutable as $$
  select coalesce((select jsonb_object_agg(upper(regexp_replace(key, '[\s\r\n' || chr(65279) || ']+', '', 'g')), value) from jsonb_each(d)), '{}'::jsonb)
$$;
-- 여러 후보 열 중 첫 번째 비어 있지 않은 값 (후보 5개까지)   ※ JS getVal(row, ...keys) — 단순식이라 쿼리에 인라인됨
create or replace function public.kj_v(d jsonb, variadic ks text[]) returns text
language sql immutable as $$
  select coalesce(nullif(d ->> ks[1], ''), nullif(d ->> ks[2], ''), nullif(d ->> ks[3], ''), nullif(d ->> ks[4], ''), nullif(d ->> ks[5], ''))
$$;
-- 줄바꿈 제거 + 양끝 공백 제거   ※ JS cleanString
create or replace function public.kj_clean(p text) returns text
language sql immutable as $$ select coalesce(regexp_replace(regexp_replace(p, '[\r\n]+', '', 'g'), '^\s+|\s+$', '', 'g'), '') $$;
-- JS Math.round (0.5 는 올림, 음수도 +∞ 방향)
create or replace function public.kj_round(x numeric) returns numeric
language sql immutable as $$ select floor(x + 0.5) $$;

-- LOT 요약   ※ trade.js processData → lotSummaryRows (부서 분리 전)
-- ※ 속도: 이 계산(원본 행 → LOT 요약)은 무겁기 때문에 결과를 표 lot_cache 에 저장해 두고,
--   데이터(구매·판매·부대비용·제조원가·실자재투입·합성·재고)가 바뀌었을 때만 다시 계산합니다 (아래 ensure_lot_cache).
--   trade_lot_summary() 는 그 저장된 표를 읽고, 실제 계산은 trade_lot_summary_raw() 입니다.
drop function if exists public.trade_lot_summary() cascade;
drop function if exists public.trade_lot_summary_raw() cascade;
create or replace function public.trade_lot_summary_raw()
returns table (
  lot_key text, biz_unit text, dept text, buyer text, item_no text, item_name text, vendor text, bl_no text, lot_no text, imp_kind text, asset_seq text,
  p_qty numeric, p_amt numeric, alloc_exp numeric, unit_cost numeric, s_qty numeric, s_amt numeric, disposal_qty numeric, mat_qty numeric,
  margin_unit numeric, cogs numeric, margin numeric, inv_qty numeric, inv_amt numeric, p_date text, s_date text,
  monthly jsonb,   -- 판매 발행월별 수익 {YYYYMM: Σ(_margin)}
  unit_won float8,  -- 첫 구매행의 단가(원) = PRICE × EXRATE (JS 와 같은 배정밀도)   ※ 이윤 9종용
  proc_u numeric,   -- 입고월 제조원가 (없으면 null)
  sales jsonb       -- 판매 행 [{q, a, m(발행월), as(자산순번), dp(부서), cu(청구처)}]  ※ 이윤 9종 · 운영 지표용
)
language sql stable security definer set search_path = public set jit = off as $$
with
p0 as materialized (select id, public.kj_norm(data) as d from public.rows where dataset = 'purchase'),
e0 as materialized (select id, public.kj_norm(data) as d from public.rows where dataset = 'expense'),
s0 as materialized (select id, public.kj_norm(data) as d from public.rows where dataset = 'sale'),
-- 구매 행 분류 (필요한 값은 여기서 한 번만 꺼냄)
p1 as materialized (
  select id, d,
    public.kj_clean(public.kj_v(d, 'SMIMPKINDNAME', '수입구분', 'SMIMPKIND')) as imp_kind,
    public.kj_clean(public.kj_v(d, 'LOTNO')) as lot_c,
    upper(public.kj_clean(public.kj_v(d, 'LOTNO'))) as lot_u,
    public.kj_clean(public.kj_v(d, 'ITEMNOCHK', 'ITEMNO', '품번')) as item_c,
    upper(public.kj_clean(public.kj_v(d, 'ITEMNOCHK', 'ITEMNO', '품번'))) as item_u,
    upper(public.kj_clean(public.kj_v(d, 'ITEMNO', 'ITEMNOCHK', '품번'))) as itemalt_u,   -- 보조 품번 (폐기·실자재투입이 ItemNo 로 적힌 경우)
    public.kj_num(public.kj_v(d, 'DOMAMT', '원화금액')) as amt,
    public.kj_num(public.kj_v(d, 'QTY', '수량')) as qty,
    public.kj_clean(public.kj_v(d, 'BLNO', 'BL번호')) as bl,
    public.kj_clean(public.kj_v(d, 'PERMITDATE', '수입면장일자', '구매일자')) as pdate,
    public.kj_clean(public.kj_v(d, 'BIZUNITNAME', '사업단위')) as biz_c,
    public.kj_clean(public.kj_v(d, 'DEPTNAME', '부서')) as dept_c,
    public.kj_clean(public.kj_v(d, 'EMPNAME', '담당자')) as emp_c,
    public.kj_clean(public.kj_v(d, 'ITEMNAME', '품목')) as item_name_c,
    public.kj_clean(public.kj_v(d, 'CUSTNAME', '수입처')) as cust_c,
    public.kj_clean(public.kj_v(d, 'CUSTNO', '수입처번호')) as custno_c,
    public.kj_clean(public.kj_v(d, 'ASSETSEQ', '자산순번')) as asset_c,
    (public.kj_num(public.kj_v(d, 'PRICE', '단가'))::float8 * public.kj_num(public.kj_v(d, 'EXRATE', '환율'))::float8) as unit_won  -- ※ JS 와 같은 배정밀도 곱셈
  from p0
),
pm as materialized (  -- 구매 LOT 맵 (폐기 제외, 금액>0 또는 수량>0)   ※ pDataMap — LOT 없는 행은 행마다 별도 키
  select *, case when lot_u <> '' then lot_u || '_' || item_u else '__NO_LOT_PURCHASE_' || (row_number() over (partition by (lot_u = '') order by id) - 1) || '__' end as key
  from p1 where imp_kind <> '폐기' and (amt > 0 or qty > 0)
),
-- ★ 같은 LOT 이라도 품번이 다르면 다른 LOT — 폐기·실자재투입은 항상 "LOT + 품번" 으로 구매 LOT 에 맞춤
--   정확히 같은 (LOT_품번) 키가 있으면 그것, 없으면 구매 행의 보조 품번(ItemNo)으로 찾음   ※ trade.js lotKeyOf
pkeys as materialized (select distinct key from pm where lot_u <> ''),
altkeys as materialized (select distinct on (lot_u || '_' || itemalt_u) lot_u || '_' || itemalt_u as akey, key from pm where lot_u <> '' and itemalt_u <> '' order by lot_u || '_' || itemalt_u, id),
disposal as (  -- 폐기 수량: 폐기 행마다 LOT 키 하나에 배정, Σ|qty|   ※ disposalByKey
  select coalesce(k1.key, k2.key, a1.key, a2.key) as key, sum(abs(d.qty)) as dqty
  from p1 d
  left join pkeys k1 on k1.key = d.lot_u || '_' || d.item_u
  left join pkeys k2 on k2.key = d.lot_u || '_' || d.itemalt_u
  left join altkeys a1 on a1.akey = d.lot_u || '_' || d.item_u
  left join altkeys a2 on a2.akey = d.lot_u || '_' || d.itemalt_u
  where d.imp_kind = '폐기' and d.lot_u <> ''
  group by 1
),
-- 실자재투입: 생산에 투입된 원료(자재 LOT RealLotNo + 자재 품번 MatItemNo) 수량   ※ matUseMap
mu0 as materialized (
  select upper(public.kj_clean(public.kj_v(d, 'REALLOTNO', '자재LOTNO'))) as lot_u,
         upper(public.kj_clean(public.kj_v(d, 'MATITEMNO', '자재코드', '원료코드'))) as item_u,
         abs(public.kj_num(public.kj_v(d, 'QTY', '투입수량'))) as qty
  from (select public.kj_norm(data) as d from public.rows where dataset = 'matinput') x
),
matuse as (
  select coalesce(k1.key, a1.key) as key, sum(m.qty) as mqty
  from mu0 m
  left join pkeys k1 on k1.key = m.lot_u || '_' || m.item_u
  left join altkeys a1 on a1.akey = m.lot_u || '_' || m.item_u
  where m.lot_u <> '' and m.item_u <> '' and coalesce(k1.key, a1.key) is not null
  group by 1
),
-- 판매 행 분류   ※ sDataMap (수량 0 제외, LOT 없는 MSV/DSV/HSV 는 품번 묶음)
s1 as materialized (
  select id, d,
    public.kj_num(public.kj_v(d, 'QTY', '수량')) as qty,
    public.kj_clean(public.kj_v(d, 'LOTNO')) as lot_c,
    upper(public.kj_clean(public.kj_v(d, 'LOTNO'))) as lot_u,
    public.kj_clean(public.kj_v(d, 'ITEMNO', '품번')) as item_c,
    upper(public.kj_clean(public.kj_v(d, 'ITEMNO', '품번'))) as item_u,
    public.kj_round(public.kj_num(public.kj_v(d, 'DOMAMT', '판매금액', '원화금액'))) as amt,
    public.kj_clean(public.kj_v(d, 'BILLDATE', '청구일자', '판매일자', '일자')) as bdate,
    substr(regexp_replace(coalesce(public.kj_v(d, 'BILLDATE', '청구일자', '판매일자', '일자'), ''), '[^0-9]', '', 'g'), 1, 6) as bym,
    public.kj_clean(public.kj_v(d, 'BIZUNITNAME', '사업단위')) as biz_c,
    public.kj_clean(public.kj_v(d, 'DEPTNAME', '부서')) as dept_c,
    public.kj_clean(public.kj_v(d, 'EMPNAME', '담당자')) as emp_c,
    public.kj_clean(public.kj_v(d, 'ITEMNAME', '품목')) as item_name_c,
    public.kj_clean(public.kj_v(d, 'ASSETSEQ', '자산순번')) as asset_c,
    public.kj_clean(public.kj_v(d, 'CUSTNAME', '청구처')) as cust_c   -- 청구처 (운영 지표 0008 용, 계산에는 쓰지 않음)
  from s0
),
sm as materialized (
  select *, case when lot_u <> '' then lot_u || '_' || item_u
                 when item_u like 'MSV%' or item_u like 'DSV%' or item_u like 'HSV%' then 'NO_LOT_' || item_u
                 else '__NO_LOT_SALE_' || (row_number() over (partition by (lot_u = '' and not (item_u like 'MSV%' or item_u like 'DSV%' or item_u like 'HSV%')) order by id) - 1) || '__' end as key
  from s1 where qty <> 0
),
-- 부대비용   ※ blBaseInfoMap(8100011) / blExpenseMap
e1 as materialized (select id, d, public.kj_clean(public.kj_v(d, 'BLNO', 'BL번호')) as bl, public.kj_clean(public.kj_v(d, 'UMEXPENSEITEM', '비용항목코드')) as code from e0),
bl_base as (  -- 같은 BL 이 여러 행이면 마지막 행
  select distinct on (bl) bl, public.kj_clean(public.kj_v(d, 'BIZUNITNAME', '사업단위')) as biz_unit, public.kj_clean(public.kj_v(d, 'DEPTNAME', '부서')) as dept, public.kj_clean(public.kj_v(d, 'EMPNAME', '담당자')) as buyer
  from e1 where bl <> '' and code like '%8100011%' order by bl, id desc
),
bl_exp as (
  select bl, sum(public.kj_round(public.kj_num(public.kj_v(d, 'TOTDOMAMT', '발생금액', '원화금액', 'DOMAMT')))) as total
  from e1 where bl <> '' and code not like '%8100011%' group by bl
),
-- BL×품목 구매금액 합   ※ blItemTotalAmtMap (pDataMap 행 기준, round 후 합)
bl_item as (select bl, item_u, sum(public.kj_round(amt)) as total from pm where bl <> '' and item_u <> '' group by 1, 2),
-- 구매 행별 배분 부대비용   ※ allocExp = round(blExpense.total × amt / blItemTotal)
pr as materialized (
  select pm.*, public.kj_round(pm.amt) as amt_r,
    case when coalesce(bi.total, 0) > 0 and public.kj_round(pm.amt) > 0
         then public.kj_round(coalesce(be.total, 0) * (public.kj_round(pm.amt) / bi.total)) else 0 end as alloc_exp
  from pm
  left join bl_item bi on bi.bl = pm.bl and bi.item_u = pm.item_u
  left join bl_exp be on be.bl = pm.bl
),
keys as (select key from pr union select key from sm),
-- LOT 머리 정보 (첫 구매 행 우선, 없으면 첫 판매 행)   ※ firstP / firstS
firstp as (select distinct on (key) * from pr order by key, id),
firsts as (select distinct on (key) * from sm order by key, id),
head as materialized (
  select k.key,
    case when fp.key is not null then fp.bl else '상세 내역' end as bl_no,
    case when fp.key is not null then fp.lot_c
         when k.key like 'NO_LOT_%' then '-'   -- ※ JS: LOT 없는 MSV/DSV/HSV 판매행은 s.LOTNO = '-' 로 바꿔 둠
         else fs.lot_c end as lot_no,
    case when fp.key is not null then coalesce(nullif(bb.biz_unit, ''), nullif(fp.biz_c, ''), '미지정 사업단위')
         else coalesce(nullif(fs.biz_c, ''), '미지정 사업단위') end as biz_unit,
    case when fp.key is not null then coalesce(nullif(fp.dept_c, ''), nullif(bb.dept, ''), '미지정 부서')
         else coalesce(nullif(fs.dept_c, ''), '미지정 부서') end as dept,
    case when fp.key is not null then coalesce(nullif(bb.buyer, ''), nullif(fp.emp_c, ''), '미지정 담당자')
         else coalesce(nullif(fs.emp_c, ''), '미지정 담당자') end as buyer,
    case when fp.key is not null then fp.item_c else fs.item_c end as item_no,
    case when fp.key is not null then fp.item_name_c else fs.item_name_c end as item_name,
    case when fp.key is not null then fp.cust_c || ' (' || fp.custno_c || ')' else '(주)국전 (116-87-01173)' end as vendor,
    case when fp.key is not null then fp.imp_kind else '' end as imp_kind,
    case when fp.key is not null then fp.asset_c else '' end as asset_seq,
    case when fp.key is not null then fp.unit_won else 0::float8 end as unit_won
  from keys k
  left join firstp fp on fp.key = k.key
  left join firsts fs on fs.key = k.key
  left join bl_base bb on fp.key is not null and bb.bl = fp.bl
),
ptot as (select key, sum(qty) as p_qty, sum(amt_r) as p_amt, sum(alloc_exp) as alloc_exp, max(pdate) as p_date from pr group by key),
h2 as (
  select h.*, coalesce(pt.p_qty, 0) as p_qty, coalesce(pt.p_amt, 0) as p_amt, coalesce(pt.alloc_exp, 0) as alloc_exp, coalesce(pt.p_date, '') as p_date,
    case when coalesce(pt.p_qty, 0) > 0 then (coalesce(pt.p_amt, 0) + coalesce(pt.alloc_exp, 0)) / pt.p_qty else 0 end as unit_cost,
    coalesce(dd.dqty, 0) as disposal_qty,  -- LOT + 품번 으로 맞춘 폐기 수량
    coalesce(mu.mqty, 0) as mat_qty,       -- 생산에 투입된 수량 (실자재투입)
    substr(regexp_replace(coalesce(pt.p_date, ''), '[^0-9]', '', 'g'), 1, 6) as lot_ym
  from head h left join ptot pt on pt.key = h.key left join disposal dd on dd.key = h.key left join matuse mu on mu.key = h.key
),
-- 월별품목별제조원가 색인 (같은 품목·월이 여럿이면 마지막 행)   ※ profit.js mfgIdx
mfg as materialized (
  select distinct on (code, ym) code, ym, proc from (
    select upper(public.kj_clean(public.kj_v(data, 'ITEMNO', 'ItemNo', '품번', '품목코드'))) as code,
           substr(regexp_replace(coalesce(public.kj_v(data, 'DATE', 'Date', '년월', '월'), ''), '[^0-9]', '', 'g'), 1, 6) as ym,
           public.kj_num(public.kj_v(data, 'PROCPRICE', 'ProcPrice', '제조원가')) as proc, id
    from public.rows where dataset = 'mfgcost') x
  where code <> '' and length(ym) = 6 order by code, ym, id desc
),
-- LOT 별 입고월 제조원가: 같은 월, 없으면 이전 마지막 월   ※ profit.js mfgProcAt
h2m as (
  select distinct on (h2.key) h2.key, m.proc
  from h2 join mfg m on m.code = upper(public.kj_clean(h2.item_no))
    and m.ym <= (case when length(h2.lot_ym) = 6 then h2.lot_ym else to_char(now(), 'YYYYMM') end)
  order by h2.key, m.ym desc
),
h3 as materialized (
  select h2.*, mp.proc as proc_u,
    coalesce(mp.proc, h2.unit_cost) as margin_unit   -- ※ marginUnit = 입고월 ProcPrice(없으면 이전 마지막 월), 그것도 없으면 구매 단가(부대비용 포함)
  from h2 left join h2m mp on mp.key = h2.key
),
-- 판매 행별 수익   ※ s._margin = amt − qty × marginUnit
sr as materialized (select sm.id, sm.key, sm.qty, sm.amt, sm.bdate, sm.bym, sm.asset_c, sm.dept_c, sm.cust_c, h3.margin_unit from sm join h3 on h3.key = sm.key),
smon as (select key, bym, sum(amt - qty * margin_unit) as v from sr where length(bym) = 6 group by key, bym),
stot as (
  select a.key, a.s_qty, a.s_amt, a.s_date, b.monthly, a.sales
  from (select key, sum(qty) as s_qty, sum(amt) as s_amt, max(bdate) as s_date,
               jsonb_agg(jsonb_build_object('q', qty, 'a', amt, 'm', bym, 'as', asset_c, 'dp', dept_c, 'cu', cust_c) order by bdate, id) as sales from sr group by key) a
  left join (select key, jsonb_object_agg(bym, v) as monthly from smon group by key) b on b.key = a.key
)
select h3.key, h3.biz_unit, h3.dept, h3.buyer, h3.item_no, h3.item_name, h3.vendor, h3.bl_no, h3.lot_no, h3.imp_kind, h3.asset_seq,
  h3.p_qty, h3.p_amt, h3.alloc_exp, h3.unit_cost, coalesce(st.s_qty, 0), coalesce(st.s_amt, 0), h3.disposal_qty, h3.mat_qty,
  h3.margin_unit,
  coalesce(st.s_qty, 0) * h3.margin_unit as cogs,
  coalesce(st.s_amt, 0) - coalesce(st.s_qty, 0) * h3.margin_unit as margin,
  round(h3.p_qty - coalesce(st.s_qty, 0) - h3.disposal_qty - h3.mat_qty, 4) as inv_qty,   -- 재고 = 구매 − 판매 − 폐기 − 생산 투입
  case when round(h3.p_qty - coalesce(st.s_qty, 0) - h3.disposal_qty - h3.mat_qty, 4) > 0 then round(h3.p_qty - coalesce(st.s_qty, 0) - h3.disposal_qty - h3.mat_qty, 4) * h3.unit_cost else 0 end as inv_amt,
  h3.p_date, coalesce(st.s_date, ''), coalesce(st.monthly, '{}'::jsonb),
  h3.unit_won, h3.proc_u, coalesce(st.sales, '[]'::jsonb)
from h3 left join stot st on st.key = h3.key
$$;

-- ═══ 계산 결과 저장(캐시) ═══
--   calc_cache : 이름 → (데이터 버전, 결과)   ·   lot_cache : LOT 요약 표 (trade_lot_summary_raw 결과 그대로)
create table if not exists public.calc_cache (key text primary key, ver text not null, value jsonb, updated_at timestamptz not null default now());
alter table public.calc_cache enable row level security;   -- 화면에서 직접 읽지 못함 (아래 함수로만)
drop table if exists public.lot_cache cascade;
create table public.lot_cache as select * from public.trade_lot_summary_raw() with no data;
alter table public.lot_cache enable row level security;
delete from public.calc_cache;   -- 이 파일을 다시 실행하면 저장된 결과를 모두 버리고 새로 계산

-- 데이터 버전: 데이터셋별 행 수 + 마지막 행 번호 — 업로드·삭제하면 바뀜
create or replace function public.kj_data_ver() returns text
language sql stable security definer set search_path = public as $$
  select 'v1|' || coalesce((select string_agg(dataset || ':' || n || ':' || mx, ',' order by dataset)
    from (select dataset, count(*) as n, max(id) as mx from public.rows
          where dataset in ('purchase', 'sale', 'expense', 'mfgcost', 'matinput', 'synth', 'stock') group by dataset) x), '')
$$;
-- 설정 버전 (판매가 설정 등이 바뀌면 이윤 결과를 다시 계산)
create or replace function public.kj_cfg_ver(p_key text) returns text
language sql stable security definer set search_path = public as $$
  select coalesce((select to_char(updated_at, 'YYYYMMDDHH24MISSUS') from public.config where key = p_key), '-')
$$;
create or replace function public.kj_cached(p_key text, p_ver text) returns jsonb
language sql stable security definer set search_path = public as $$ select value from public.calc_cache where key = p_key and ver = p_ver $$;
create or replace function public.kj_cache_put(p_key text, p_ver text, p_value jsonb) returns void
language sql volatile security definer set search_path = public as $$
  insert into public.calc_cache(key, ver, value, updated_at) values (p_key, p_ver, p_value, now())
  on conflict (key) do update set ver = excluded.ver, value = excluded.value, updated_at = now()
$$;
-- LOT 요약 표가 최신인지 확인하고, 아니면 다시 계산 (동시에 여러 명이 들어와도 한 번만)
create or replace function public.ensure_lot_cache() returns text
language plpgsql volatile security definer set search_path = public set jit = off as $$
declare v text := public.kj_data_ver();
begin
  if exists (select 1 from public.calc_cache where key = 'lot_cache' and ver = v) then return v; end if;
  perform pg_advisory_xact_lock(hashtext('kj_lot_cache'));
  if exists (select 1 from public.calc_cache where key = 'lot_cache' and ver = v) then return v; end if;
  delete from public.lot_cache;
  insert into public.lot_cache select * from public.trade_lot_summary_raw();
  delete from public.calc_cache where key <> 'lot_cache';            -- LOT 이 바뀌면 그 위의 결과도 모두 새로
  perform public.kj_cache_put('lot_cache', v, jsonb_build_object('lots', (select count(*) from public.lot_cache)));
  return v;
end $$;
-- 저장된 LOT 요약 (다른 계산 함수들은 이것을 씀 — 호출 전에 ensure_lot_cache() 가 불려 있어야 최신)
create or replace function public.trade_lot_summary() returns setof public.lot_cache
language sql stable security definer set search_path = public as $$ select * from public.lot_cache $$;

-- 판매 발행월 기준 월 수익   ※ KJHub.results.marginMonthlyByBU / marginMonthlyByDept / marginMonthlyFull  (AssetSeq 36·37 LOT 제외)
create or replace function public.trade_monthly_margin_q()
returns jsonb language sql stable security definer set search_path = public as $$
  with l as (select * from public.trade_lot_summary() where asset_seq not in ('36', '37')),
  m as (select trim(l.biz_unit) as bu, trim(l.dept) as dp, e.key as ym, (e.value)::numeric as v from l, jsonb_each(l.monthly) e)
  select jsonb_build_object(
    'full',   coalesce((select jsonb_object_agg(ym, v) from (select ym, sum(v) v from m group by ym) a), '{}'::jsonb),
    'byBU',   coalesce((select jsonb_object_agg(bu, o) from (select bu, jsonb_object_agg(ym, v) o from (select bu, ym, sum(v) v from m where bu <> '' group by bu, ym) b group by bu) c), '{}'::jsonb),
    'byDept', coalesce((select jsonb_object_agg(dp, o) from (select dp, jsonb_object_agg(ym, v) o from (select dp, ym, sum(v) v from m where dp <> '' group by dp, ym) b group by dp) c), '{}'::jsonb),
    'lots',   (select count(*) from l)
  )
$$;

-- 검증용: LOT 요약을 JSON 배열로
create or replace function public.trade_lot_summary_json()
returns jsonb language plpgsql volatile security definer set search_path = public as $$
begin
  perform public.ensure_lot_cache();
  return (select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from public.lot_cache t);
end $$;

-- 화면이 부르는 함수: 저장된 결과가 최신이면 그대로, 아니면 계산 후 저장
create or replace function public.trade_monthly_margin()
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare v text; r jsonb;
begin
  v := public.ensure_lot_cache();
  r := public.kj_cached('monthly', v);
  if r is null then r := public.trade_monthly_margin_q(); perform public.kj_cache_put('monthly', v, r); end if;
  return r;
end $$;

grant execute on function public.kj_norm(jsonb), public.kj_v(jsonb, text[]), public.kj_clean(text), public.kj_round(numeric),
  public.trade_lot_summary(), public.trade_lot_summary_raw(), public.trade_monthly_margin(), public.trade_monthly_margin_q(), public.trade_lot_summary_json(),
  public.kj_data_ver(), public.kj_cfg_ver(text), public.kj_cached(text, text), public.kj_cache_put(text, text, jsonb), public.ensure_lot_cache() to authenticated;
notify pgrst, 'reload config';
