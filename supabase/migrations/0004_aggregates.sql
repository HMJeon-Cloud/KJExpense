-- B단계 1차: 집계를 DB가 수행 (0001·0002·0003 다음에 실행)
--   · 전표(voucher)는 양이 가장 많아, 부서×월×계정 합계를 DB에서 만들고 화면은 합계만 받습니다.
--   · 전표 원본 행은 "필요한 달 범위"만 받습니다 (전표 상세·키워드용).
--   · 집계 규칙은 기존 화면 코드(profit.js aggregate)와 글자 단위로 같습니다 — 아래 주석에 대응 관계를 적어 두었습니다.

-- 숫자 문자열 → numeric (쉼표 제거, 실패 시 0)  ※ JS: parseFloat(String(v).replace(/,/g,'')) || 0
create or replace function public.kj_num(p text) returns numeric
language plpgsql immutable strict as $$
declare v numeric;
begin
  begin
    v := nullif(regexp_replace(replace(p, ',', ''), '^\s*([-+]?[0-9]*\.?[0-9]+).*$', '\1'), '')::numeric;
  exception when others then v := 0; end;
  return coalesce(v, 0);
end $$;

-- 전표 한 행의 회계월 'YYYYMM'  ※ JS: String(vGet(row,'회계일','AccDate')).replace(/[^0-9]/g,'').slice(0,6)
create or replace function public.kj_voucher_ym(d jsonb) returns text
language sql immutable as $$
  select substr(regexp_replace(coalesce(d->>'회계일', d->>'AccDate', d->>'전표일자', d->>'Date', d->>'DATE', d->>'일자', ''), '[^0-9]', '', 'g'), 1, 6)
$$;
create index if not exists rows_voucher_ym on public.rows (public.kj_voucher_ym(data)) where dataset = 'voucher';

-- 전표 집계: 부서 × 회계월 × 계정 × 비용구분  (JS aggregate() 와 동일한 포함/제외 규칙)
create or replace function public.voucher_agg()
returns jsonb language sql stable security definer set search_path = public as $$
  with v as (
    select
      coalesce(data->>'계정과목', data->>'AccName', '')                       as acc,       -- vGet('계정과목','AccName')
      coalesce(data->>'적요', data->>'Summary', '')                           as summary,   -- vGet('적요','Summary')
      trim(coalesce(data->>'코스트센터', data->>'CostCCtrName', data->>'부서', '')) as dept,  -- vGet('코스트센터','CostCCtrName') || row['부서']
      coalesce(data->>'비용구분', data->>'UMCostTypeName', '')                 as ct,        -- vGet('비용구분','UMCostTypeName')
      public.kj_voucher_ym(data)                                              as ym,
      public.kj_num(coalesce(data->>'차변금액', data->>'DrAmt', '0')) - public.kj_num(coalesce(data->>'대변금액', data->>'CrAmt', '0')) as amt
    from public.rows where dataset = 'voucher'
  )
  select coalesce(jsonb_agg(jsonb_build_object('dept', dept, 'ym', ym, 'acc', acc, 'ct', ct, 'amt', amt, 'n', n) order by dept, ym, acc), '[]'::jsonb)
  from (
    select dept, ym, acc, ct, sum(amt) as amt, count(*) as n
    from v
    where dept <> ''
      and acc not like '%집합%'                                   -- acc.includes('집합') 제외
      and summary not like '%제조원가대체%' and summary not like '%손익대체%' and summary not like '%원가대체%'
      and dept not like '%원가계산%'
      and (acc like '%(판)%' or acc like '%(제)%' or ct like '%판관%' or ct like '%제조%')
      and length(ym) = 6
    group by dept, ym, acc, ct
  ) g
$$;

-- 전표 원본 행: 회계월 범위만 (p_from ≤ ym ≤ p_to, 'YYYYMM')
create or replace function public.voucher_rows_range(p_from text, p_to text)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(data order by id), '[]'::jsonb)
  from public.rows
  where dataset = 'voucher' and public.kj_voucher_ym(data) between p_from and p_to
$$;

-- 전표가 있는 월 목록과 건수 (검증 화면·상태 표시용)
create or replace function public.voucher_months()
returns table(ym text, cnt bigint) language sql stable security definer set search_path = public as $$
  select public.kj_voucher_ym(data) as ym, count(*) from public.rows where dataset = 'voucher' group by 1 order by 1
$$;

grant execute on function public.kj_num(text), public.kj_voucher_ym(jsonb), public.voucher_agg(), public.voucher_rows_range(text, text), public.voucher_months() to authenticated;
notify pgrst, 'reload config';
