-- B단계 2차-2: 이윤 9종(배분 그룹 기준 수익)을 DB가 계산 (0006 다음에 실행)
--   ※ trade.js computeProfits + processData 의 월 집계(byProfit) 를 그대로 옮김. 대응 규칙은 주석에.
--   입력: trade_lot_summary() + config.items(판매가 설정) + synth(합성 대상) + matinput(실자재투입)
--   출력: { ops:{YYYYMM:값}, globalpur:{…}, salessup, synth, sales, matops, scm, matsalessup, matprod, matsales }

-- JS Math.round 를 배정밀도(float8)로 — 소수점 경계에서 JS 와 같은 결과
create or replace function public.kj_jsround(x float8) returns numeric
language sql immutable as $$ select floor(x + 0.5)::numeric $$;

-- 공백 제거 + 대문자   ※ JS nz()/nrm()
create or replace function public.kj_nz(p text) returns text
language sql immutable as $$ select upper(regexp_replace(coalesce(p, ''), '\s+', '', 'g')) $$;

create or replace function public.trade_profit_groups_q()
returns jsonb language sql stable security definer set search_path = public set enable_nestloop = off set jit = off as $$
with
cur as (select to_char(now(), 'YYYYMM') as ym),
-- 판매가 설정   ※ __kjItemAlloc.sellBuyOf / sellSynOf: config.items.byItem[코드].sellBuyByMonth[월] (그 달 값만, 승계 없음, 미설정 0)
cfg as (select coalesce((select value from public.config where key = 'items'), '{}'::jsonb) as v),
item_price as (
  select upper(e.key) as code,
    coalesce(e.value -> 'sellBuyByMonth', '{}'::jsonb) as buy, coalesce(e.value -> 'sellSynByMonth', '{}'::jsonb) as syn
  from cfg, jsonb_each(coalesce(cfg.v -> 'byItem', '{}'::jsonb)) e
),
mat_price as (  -- ※ __kjMatAlloc.sellBuyOf: byMat[nrm(자재코드)].sellBuyByMonth[월]
  select upper(e.key) as code, coalesce(e.value -> 'sellBuyByMonth', '{}'::jsonb) as buy
  from cfg, jsonb_each(coalesce(cfg.v -> 'byMat', '{}'::jsonb)) e
),
-- 합성 대상   ※ synthSet(품번|LOT) / synthItems(품번)
synth_lot as materialized (
  select distinct upper(public.kj_clean(public.kj_v(data, 'ITEMNO', 'ItemNo', '품번'))) as item_u, upper(public.kj_clean(public.kj_v(data, 'LOTNO', 'LotNo', 'LOT번호', 'LOT'))) as lot_u
  from public.rows where dataset = 'synth'
),
synth_item as materialized (select distinct item_u from synth_lot where item_u <> ''),
-- 실자재투입 색인   ※ __matIndex: (생산품번|생산LOT) → {deptKey, code, ym, inPrice, qty}
mat as materialized (
  select public.kj_nz(public.kj_v(d, 'GOODITEMNO', '생산품번')) as item_n,
         public.kj_nz(public.kj_v(d, 'RREALLOTNO', '생산LOTNO')) as lot_n,
         case public.kj_nz(public.kj_v(d, 'DEPTNAME', '부서명', '부서'))
           when '운영지원팀' then 'ops' when '글로벌구매팀' then 'globalpur' when '영업지원팀' then 'salessup'
           when '소재운영지원팀' then 'matops' when 'SCM팀' then 'scm' when '소재영업지원팀' then 'matsalessup' end as dept_key,
         public.kj_nz(coalesce(public.kj_v(d, 'MATITEMNO', '자재코드', '원료코드'), public.kj_v(d, 'MATITEMNAME', '자재명', '원료명'))) as code,
         substr(regexp_replace(coalesce(public.kj_v(d, 'DELVINDATE', '입고일자', '입고일'), ''), '[^0-9]', '', 'g'), 1, 6) as ym,
         public.kj_num(public.kj_v(d, 'INPRICE', '입고단가')) as in_price,
         public.kj_num(public.kj_v(d, 'QTY', '투입수량')) as qty
  from (select public.kj_norm(data) as d from public.rows where dataset = 'matinput') x
),
-- LOT 별 공통값   ※ processData 집계 루프의 LOT 단위 값
l as (
  select t.*,
    upper(public.kj_clean(t.item_no)) as item_u, upper(public.kj_clean(t.lot_no)) as lot_u,
    public.kj_nz(t.item_no) as item_n, public.kj_nz(t.lot_no) as lot_n,
    substr(regexp_replace(coalesce(t.p_date, ''), '[^0-9]', '', 'g'), 1, 6) as lym,
    (t.asset_seq in ('36', '37')) as no_sale,                                  -- isNoSaleAsset(p0)
    (t.asset_seq in ('27', '28', '29', '30', '42', '43')) as trade_asset,     -- isTradeAsset(p0)
    (left(upper(public.kj_clean(t.item_no)), 1) = 'M') as is_m,
    case public.kj_nz(t.dept) when '운영지원팀' then 'ops' when '글로벌구매팀' then 'globalpur' when '영업지원팀' then 'salessup'
         when '소재운영지원팀' then 'matops' when 'SCM팀' then 'scm' when '소재영업지원팀' then 'matsalessup' end as lot_key_buy  -- PROFIT_DEPT_KEY[lotDept]
  from public.trade_lot_summary() t
),
l2 as (
  select l.*,
    (sl.item_u is not null) as is_syn,
    (si.item_u is not null) as is_syn_item,
    case when length(l.lym) = 6 then l.lym else (select ym from cur) end as pym
  from l
  left join synth_lot sl on sl.item_u = l.item_u and sl.lot_u = l.lot_u
  left join synth_item si on si.item_u = l.item_u
),
l3 as materialized (
  select l2.*,
    -- sellBuyOf: 합성 품목이면 0 / sellSynOf: 합성 품목만
    case when l2.is_syn_item then 0 else coalesce((ip.buy ->> l2.pym)::numeric, 0) end as sell_buy,
    case when l2.is_syn_item then coalesce((ip.syn ->> l2.pym)::numeric, 0) else 0 end as sell_syn
  from l2 left join item_price ip on ip.code = l2.item_u
),
-- 원료 수익 (합성 대상 LOT): Σ round((판매가(구매,원료 입고월) − InPrice) × Qty) by deptKey   ※ computeProfits ① isSynth 분기
lm as (  -- LOT × 원료 행 (LOT 번호가 있으면 품번+LOT, 없으면 품번 전체)   ※ __matRowsFor
  select l3.lot_key, l3.item_n, l3.lot_n, l3.pym, m.dept_key, m.code, m.ym, m.in_price, m.qty
  from l3 join mat m on m.item_n = l3.item_n and m.lot_n = l3.lot_n where l3.lot_n <> '' and m.dept_key is not null
  union all
  select l3.lot_key, l3.item_n, l3.lot_n, l3.pym, m.dept_key, m.code, m.ym, m.in_price, m.qty
  from l3 join mat m on m.item_n = l3.item_n where l3.lot_n = '' and m.dept_key is not null
),
mat_profit as materialized (
  select lm.lot_key, lm.item_n, lm.lot_n, lm.dept_key,
    sum(public.kj_jsround((coalesce((mp.buy ->> (case when length(lm.ym) = 6 then lm.ym else lm.pym end))::float8, 0) - lm.in_price::float8) * lm.qty::float8)) as v
  from lm left join mat_price mp on mp.code = lm.code
  where coalesce((mp.buy ->> (case when length(lm.ym) = 6 then lm.ym else lm.pym end))::numeric, 0) <> 0  -- 판매가(구매) 미설정 원료는 계산하지 않음
  group by lm.lot_key, lm.item_n, lm.lot_n, lm.dept_key
),
rows_out as (
  -- (A) AssetSeq 36·37: 판매 없음 → 구매 부서 이윤만, 입고월에 1회   ※ pv0
  select l3.lot_key_buy as k, l3.lym as ym, public.kj_jsround((l3.sell_buy::float8 - l3.unit_won) * (l3.p_qty - l3.in_qty - l3.ret_qty)::float8) as v   -- 기타입고·반품 수량 제외 (구매 행 수량)
  from l3 where l3.no_sale and not l3.is_syn and l3.lot_key_buy is not null and l3.sell_buy <> 0 and length(l3.lym) = 6   -- ※ pv0 는 tradeAsset 을 넘기지 않음 → 합성 여부만 봄
  union all
  select mp.dept_key, l3.lym, mp.v
  from l3 join mat_profit mp on mp.lot_key = l3.lot_key
  where l3.no_sale and l3.is_syn and length(l3.lym) = 6 and mp.v is not null
  union all
  -- (B) 합성 대상 LOT 의 원료 수익: (품번|LOT) 당 1회, 제품 입고월에   ※ __matSeen / pvLot.__matMonths
  select mp.dept_key, l3.lym, mp.v
  from (select distinct on (item_u, lot_u) * from l3 where not no_sale and is_syn and not trade_asset order by item_u, lot_u, lot_key) l3
  join mat_profit mp on mp.lot_key = l3.lot_key
  where length(l3.lym) = 6 and mp.v <> 0
  union all
  -- (D) 기타출고: 판매가 아니므로 구매 부서 이윤만 (판매가(구매) − 단가(원)) × 출고수량, 출고월(없으면 입고월)에   ※ lo.outRows
  select l3.lot_key_buy, o.m, public.kj_jsround((l3.sell_buy::float8 - l3.unit_won) * o.q::float8)
  from l3, lateral (
    select (e ->> 'q')::numeric as q, case when length(coalesce(e ->> 'm', '')) = 6 then e ->> 'm' else l3.lym end as m
    from jsonb_array_elements(l3.outs) e
  ) o
  where not l3.no_sale and not l3.is_syn and l3.lot_key_buy is not null and l3.sell_buy <> 0 and length(o.m) = 6  union all
  -- (C) 판매 행별   ※ sRows.forEach → computeProfits (합성 LOT 의 구매 계열(kind=buy) 값은 제외)
  select x.k, y.ym, x.v from (
    select s.m as ym,
      case
        when (s.asv) = '39' then  -- ★ 판매 AssetSeq 39: 판매 부서 이윤 = 판매금액 (합성 LOT 이고 그 키가 구매 계열이면 제외)
          case when sd in ('영업팀', '영업지원팀') then 'sales' when sd in ('소재영업팀', '소재영업지원팀') then 'matsales'
               when l3.is_syn then null
               when sd = '운영지원팀' then 'ops' when sd = '글로벌구매팀' then 'globalpur' when sd = '소재운영지원팀' then 'matops' when sd = 'SCM팀' then 'scm' end
        else null end as k39,
      public.kj_jsround(s.ae) as v39,
      l3.*, s.q, s.a, s.asv, s.sd, s.ae
    from l3, lateral (
      -- ★ 기타입고 몫(c, 판매 반품이면 되돌린 몫으로 음수)은 부서별 이윤에서 뺌: 수량 q − c, 금액 a × (q − c) ÷ q   (실현 수익은 그대로)
      select case when s0.c <> 0 then s0.q0 - s0.c else s0.q0 end as q, s0.a, s0.m, s0.asv, s0.sd, s0.c, s0.q0,
             case when s0.c <> 0 then s0.a::float8 * (s0.q0 - s0.c)::float8 / s0.q0::float8 else s0.a::float8 end as ae
      from (select (e ->> 'q')::numeric as q0, (e ->> 'a')::numeric as a, e ->> 'm' as m, e ->> 'as' as asv, public.kj_nz(e ->> 'dp') as sd,
                   coalesce((e ->> 'c')::numeric, 0) as c
            from jsonb_array_elements(l3.sales) e) s0
    ) s
    where not l3.no_sale and length(s.m) = 6 and not (s.c <> 0 and abs(s.q0 - s.c) <= 0.000000001)
  ) y, lateral (
    select * from (values
      -- 39: 판매 부서 이윤
      (case when y.asv = '39' then y.k39 end, y.v39),
      -- ① 구매 부서 이윤 (합성 아님 — 합성 LOT 은 집계에서 제외되므로 아예 만들지 않음)
      (case when y.asv <> '39' and not y.is_syn and y.lot_key_buy is not null and y.sell_buy <> 0 then y.lot_key_buy end, public.kj_jsround((y.sell_buy::float8 - y.unit_won) * y.q::float8)),
      -- ② 합성/소재생산 이윤 = (판매가(합성) − 제조원가) × 판매수량
      (case when y.asv <> '39' and not y.trade_asset and y.is_syn and y.sell_syn <> 0 and y.proc_u is not null then (case when y.is_m then 'matprod' else 'synth' end) end, public.kj_jsround((y.sell_syn::float8 - y.proc_u::float8) * y.q::float8)),
      -- ③ 영업 이윤 = 판매금액 − (넘겨받는 단가 × 판매수량)
      (case when y.asv <> '39' and (case when y.is_syn and not y.trade_asset then y.sell_syn else y.sell_buy end) <> 0 then (case when y.is_m then 'matsales' else 'sales' end) end,
       public.kj_jsround(y.ae - (case when y.is_syn and not y.trade_asset then y.sell_syn else y.sell_buy end)::float8 * y.q::float8))
    ) as t(k, v) where t.k is not null
  ) x
),
agg as materialized (select k, ym, sum(v) as v from rows_out where k is not null group by k, ym),
keys as (select unnest(array['ops', 'globalpur', 'salessup', 'synth', 'sales', 'matops', 'scm', 'matsalessup', 'matprod', 'matsales']) as k)
select jsonb_object_agg(keys.k, coalesce((select jsonb_object_agg(ym, v) from agg where agg.k = keys.k), '{}'::jsonb)) from keys
$$;

-- 화면이 부르는 함수: LOT 요약·판매가 설정이 그대로면 저장된 결과를 바로 돌려줌 (0006 의 캐시 사용)
create or replace function public.trade_profit_groups()
returns jsonb language plpgsql volatile security definer set search_path = public set enable_nestloop = off set jit = off as $$
declare v text; r jsonb;
begin
  v := public.ensure_lot_cache() || '|items:' || public.kj_cfg_ver('items');
  r := public.kj_cached('profit_groups', v);
  if r is null then r := public.trade_profit_groups_q(); perform public.kj_cache_put('profit_groups', v, r); end if;
  return r;
end $$;
grant execute on function public.kj_nz(text), public.kj_jsround(float8), public.trade_profit_groups(), public.trade_profit_groups_q() to authenticated;
notify pgrst, 'reload config';
