-- 고정비 설정 (설정 › 고정비 설정) — 운영 지표 ⑥ "고정비 대비 수익" 의 고정비를 관리자가 계정·적요로 정합니다.   (0008 다음에 실행)
--   설정 저장 위치: config.key = 'fixedCost'
--   값 구조: { "accounts": { "<계정과목>": { "mode": "all" | "only" | "except", "kws": ["적요 단어", ...] } } }
--     all    = 그 계정 전표 전부 고정비
--     only   = 적요에 단어 중 하나라도 들어간 전표만 고정비
--     except = 적요에 단어가 들어간 전표는 빼고 나머지 고정비
--     (목록에 없는 계정 = 고정비 아님)
--   대상 전표는 비용 화면과 같은 규칙 (부서 있음, (판)/(제) 계정 또는 판관/제조 비용구분, 집합·원가대체·손익대체·원가계산 제외, 금액 = 차변 − 대변).

-- 비용 전표 (회계월 범위) — 계정·적요·부서·월·금액
create or replace function public.cost_voucher_range(p_from text, p_to text)
returns table (dept text, ym text, acc text, summary text, amt numeric)
language sql stable security definer set search_path = public as $$
  select dept, ym, acc, summary, amt from (
    select
      coalesce(data->>'계정과목', data->>'AccName', '') as acc,
      coalesce(data->>'적요', data->>'Summary', '') as summary,
      trim(coalesce(data->>'코스트센터', data->>'CostCCtrName', data->>'부서', '')) as dept,
      coalesce(data->>'비용구분', data->>'UMCostTypeName', '') as ct,
      public.kj_voucher_ym(data) as ym,
      public.kj_num(coalesce(data->>'차변금액', data->>'DrAmt', '0')) - public.kj_num(coalesce(data->>'대변금액', data->>'CrAmt', '0')) as amt
    from public.rows
    where dataset = 'voucher' and public.kj_voucher_ym(data) between p_from and p_to
  ) v
  where dept <> ''
    and acc not like '%집합%'
    and summary not like '%제조원가대체%' and summary not like '%손익대체%' and summary not like '%원가대체%'
    and dept not like '%원가계산%'
    and (acc like '%(판)%' or acc like '%(제)%' or ct like '%판관%' or ct like '%제조%')
    and length(ym) = 6
$$;

-- 한 전표가 고정비인지 (설정 cfg 기준)
create or replace function public.kj_is_fixed(p_acc text, p_summary text, p_cfg jsonb) returns boolean
language sql immutable as $$
  select case coalesce(p_cfg -> 'accounts' -> p_acc ->> 'mode', '')
    when 'all' then true
    when 'only' then exists (select 1 from jsonb_array_elements_text(coalesce(p_cfg -> 'accounts' -> p_acc -> 'kws', '[]'::jsonb)) k where k <> '' and position(lower(k) in lower(p_summary)) > 0)
    when 'except' then not exists (select 1 from jsonb_array_elements_text(coalesce(p_cfg -> 'accounts' -> p_acc -> 'kws', '[]'::jsonb)) k where k <> '' and position(lower(k) in lower(p_summary)) > 0)
    else false end
$$;

-- 운영 지표용: 고정비 합계 [부서, 년월, 계정, 금액]  + 설정 여부
create or replace function public.fixed_cost_agg(p_from text, p_to text)
returns jsonb language sql stable security definer set search_path = public as $$
  with c as (select coalesce((select value from public.config where key = 'fixedCost'), '{}'::jsonb) as cfg),
  v as materialized (select * from public.cost_voucher_range(p_from, p_to)),
  f as (
    select v.dept, v.ym, v.acc, sum(v.amt) as amt from v, c
    where (c.cfg -> 'accounts') ? v.acc and public.kj_is_fixed(v.acc, v.summary, c.cfg)
    group by 1, 2, 3
  )
  select jsonb_build_object(
    'configured', (select coalesce(jsonb_typeof(cfg -> 'accounts') = 'object' and cfg -> 'accounts' <> '{}'::jsonb, false) from c),
    'rows', coalesce((select jsonb_agg(jsonb_build_array(dept, ym, acc, amt)) from f), '[]'::jsonb)
  )
$$;

-- 설정 화면용: 기간의 계정 × 적요 합계와 계정 × 월 합계
--   items  : [계정, 적요, 금액, 건수, 나온 달 수]
--   months : [계정, 년월, 금액]
create or replace function public.fixed_cost_candidates(p_from text, p_to text)
returns jsonb language sql stable security definer set search_path = public as $$
  with v as materialized (select * from public.cost_voucher_range(p_from, p_to))
  select jsonb_build_object(
    'items',  coalesce((select jsonb_agg(jsonb_build_array(acc, summary, amt, n, nm)) from (select acc, summary, sum(amt) as amt, count(*) as n, count(distinct ym) as nm from v group by 1, 2) x), '[]'::jsonb),
    'months', coalesce((select jsonb_agg(jsonb_build_array(acc, ym, amt)) from (select acc, ym, sum(amt) as amt from v group by 1, 2) y), '[]'::jsonb)
  )
$$;

grant execute on function public.cost_voucher_range(text, text), public.kj_is_fixed(text, text, jsonb),
  public.fixed_cost_agg(text, text), public.fixed_cost_candidates(text, text) to authenticated;
notify pgrst, 'reload config';
