-- LOT 추적 (설정 › 집계 검증 › LOT 추적) — LOT 번호 하나로 모든 데이터의 관련 행과 계산 결과를 한 번에 봅니다.   (0006 다음에 실행)
--   재고가 남아 보이는 이유(판매·폐기·생산 투입이 품번이 달라 안 맞는 경우 등)를 찾는 점검용입니다.
create or replace function public.lot_trace_q(p_lot text)
returns jsonb language sql stable security definer set search_path = public set jit = off as $$
with q as (select upper(public.kj_clean(p_lot)) as lot),
r as materialized (
  select dataset, id, public.kj_norm(data) as d from public.rows
  where dataset in ('purchase', 'sale', 'matinput', 'stock')
    and upper(data::text) like '%' || (select lot from q) || '%'
)
select jsonb_build_object(
  'lot', (select lot from q),
  'purchase', coalesce((select jsonb_agg(jsonb_build_object(
      '품번(Chk)', public.kj_v(d, 'ITEMNOCHK'), '품번', public.kj_v(d, 'ITEMNO', '품번'), '품명', public.kj_v(d, 'ITEMNAME', '품목'),
      '수입구분', public.kj_v(d, 'SMIMPKINDNAME', '수입구분'), '유형', public.kj_v(d, 'SMIMPTYPENAME', 'SMIMPTYPE'), '입고일', public.kj_v(d, 'PERMITDATE', '수입면장일자', '구매일자'),
      '수량', public.kj_v(d, 'QTY', '수량'), '금액', public.kj_v(d, 'DOMAMT', '원화금액'), '부서', public.kj_v(d, 'DEPTNAME', '부서'),
      '자산순번', public.kj_v(d, 'ASSETSEQ', '자산순번'), 'BL', public.kj_v(d, 'BLNO', 'BL번호')) order by id)
    from r where dataset = 'purchase' and upper(public.kj_clean(public.kj_v(d, 'LOTNO'))) = (select lot from q)), '[]'::jsonb),
  'sale', coalesce((select jsonb_agg(jsonb_build_object(
      '품번', public.kj_v(d, 'ITEMNO', '품번'), '품명', public.kj_v(d, 'ITEMNAME', '품목'), '발행일', public.kj_v(d, 'BILLDATE', '청구일자', '판매일자', '일자'),
      '수량', public.kj_v(d, 'QTY', '수량'), '금액', public.kj_v(d, 'DOMAMT', '판매금액', '원화금액'), '청구처', public.kj_v(d, 'CUSTNAME', '청구처'), '부서', public.kj_v(d, 'DEPTNAME', '부서')) order by id)
    from r where dataset = 'sale' and upper(public.kj_clean(public.kj_v(d, 'LOTNO'))) = (select lot from q)), '[]'::jsonb),
  'matUsed', coalesce((select jsonb_agg(jsonb_build_object(
      '자재 품번', public.kj_v(d, 'MATITEMNO', '자재코드'), '자재명', public.kj_v(d, 'MATITEMNAME', '자재명'), '자재 LOT', public.kj_v(d, 'REALLOTNO', '자재LOTNO'),
      '투입수량', public.kj_v(d, 'QTY', '투입수량'), '생산 품번', public.kj_v(d, 'GOODITEMNO', '생산품번'), '생산 LOT', public.kj_v(d, 'RREALLOTNO', '생산LOTNO'),
      '입고일자', public.kj_v(d, 'DELVINDATE', '입고일자'), '부서', public.kj_v(d, 'DEPTNAME', '부서명')) order by id)
    from r where dataset = 'matinput' and upper(public.kj_clean(public.kj_v(d, 'REALLOTNO', '자재LOTNO'))) = (select lot from q)), '[]'::jsonb),
  'matMade', coalesce((select jsonb_agg(jsonb_build_object(
      '생산 품번', public.kj_v(d, 'GOODITEMNO', '생산품번'), '생산 LOT', public.kj_v(d, 'RREALLOTNO', '생산LOTNO'), '자재 품번', public.kj_v(d, 'MATITEMNO', '자재코드'),
      '자재 LOT', public.kj_v(d, 'REALLOTNO', '자재LOTNO'), '투입수량', public.kj_v(d, 'QTY', '투입수량'), '입고일자', public.kj_v(d, 'DELVINDATE', '입고일자')) order by id)
    from r where dataset = 'matinput' and upper(public.kj_clean(public.kj_v(d, 'RREALLOTNO', '생산LOTNO'))) = (select lot from q)), '[]'::jsonb),
  'stock', coalesce((select jsonb_agg(jsonb_build_object(
      '사업장', public.kj_v(d, 'BIZNAME', '사업장'), '품번', public.kj_v(d, 'ITEMNO', '품번'), '품명', public.kj_v(d, 'ITEMNAME', '품명'),
      '입고일', public.kj_v(d, 'REGDATE', '입고일'), '수량', public.kj_v(d, 'STOCKQTY', '수량'), '재고금액', public.kj_v(d, 'STOCKAMT', '재고금액')) order by id)
    from r where dataset = 'stock' and upper(public.kj_clean(public.kj_v(d, 'LOTNO', '제조번호'))) = (select lot from q)), '[]'::jsonb),
  -- 실자재투입에 자재 LOT(RealLotNo)이 채워진 행 수 / 전체 행 수 — 0 이면 생산 투입을 재고에서 뺄 수 없음
  'matLotRows', (select count(*) from public.rows where dataset = 'matinput' and coalesce(public.kj_v(public.kj_norm(data), 'REALLOTNO', '자재LOTNO'), '') <> ''),
  'matRows', (select count(*) from public.rows where dataset = 'matinput'),
  'matCols', (select coalesce(jsonb_agg(distinct k), '[]'::jsonb) from (select jsonb_object_keys(public.kj_norm(data)) as k from public.rows where dataset = 'matinput' limit 200) x),
  'calc', coalesce((select jsonb_agg(jsonb_build_object(
      'LOT 키', lot_key, '품번', item_no, '품명', item_name, '부서', dept, '구매수량', p_qty, '판매수량', s_qty, '폐기수량', disposal_qty,
      '생산투입', mat_qty, '기타출고', out_qty, '재고수량', inv_qty, '재고금액', round(inv_amt), '자산순번', asset_seq))
    from public.trade_lot_summary() t where upper(public.kj_clean(t.lot_no)) = (select lot from q)), '[]'::jsonb)
)
$$;
create or replace function public.lot_trace(p_lot text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
begin perform public.ensure_lot_cache(); return public.lot_trace_q(p_lot); end $$;
grant execute on function public.lot_trace(text), public.lot_trace_q(text) to authenticated;
notify pgrst, 'reload config';
