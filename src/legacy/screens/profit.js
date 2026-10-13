// 기존 화면 모듈 (Apps Script 판에서 그대로 이전) — 셸 API(KJHub)와 google.script.run 셈을 통해 Supabase 와 연결
/* eslint-disable */
export default function init() {
  const __onReady = fn => fn();

(function () {
  // ==========================================================================
  // 💰 수익 배분 현황 v3
  // --------------------------------------------------------------------------
  //  - 그룹 2벌 배분: [API·경영] / [소재·경영] — 각각 기준 수익과 배분 비율을 따로 운용
  //      · API·경영 수익 = 구매/판매의 사업단위 (주)국전 ATS + (주)국전 + (주)국전 API합성
  //      · 소재·경영 수익 = 사업단위 (주)국전 소재
  //  - 부서 선택지 = 부서 데이터(DeptName), UnitDiv 로 그룹별 필터
  //  - 기준월 + 비교 기간: 기준월에서 거꾸로 N개월 (예: 2026-06 / 3개월 → 4,5,6월)
  //  - 부서 카드: KPI · 그래프 · 월별 표 · 도넛(계정별 비용 + 키워드) · 점검 포인트
  // ==========================================================================
  const $ = id => document.getElementById(id);
  const fmt = v => new Intl.NumberFormat('ko-KR').format(Math.round(v || 0));
  const fmtShort = v => {
    const a = Math.abs(v || 0);
    if (a >= 1e8) return (v / 1e8).toFixed(1) + '억';
    if (a >= 1e4) return Math.round(v / 1e4).toLocaleString('ko-KR') + '만';
    return fmt(v);
  };
  const mLabel = m => m.slice(0, 4) + '-' + m.slice(4, 6);
  const norm = s => String(s == null ? '' : s).replace(/\s+/g, '');
  const MIN_MONTH = '202501';
  // SVG 텍스트 안전 처리
  const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const clip = (s, n) => {
    s = String(s == null ? '' : s);
    return s.length > n ? s.slice(0, n - 1) + '…' : s;
  };

  // ── 배분 그룹 정의 (기준 부서) ────────────────────────────────────────
  //   각 그룹의 기준 수익 = 해당 부서(들)의 판매 발행월 수익 합계.
  //   depts 는 [구매 및 판매 내역]의 구매 부서명과 매칭(공백·대소문자 무시)됩니다.
  const GROUPS = [
    { key: 'ops',        label: '운영지원팀',                depts: ['운영지원팀'] },
    { key: 'matops',     label: '소재운영지원팀',            depts: ['소재운영지원팀'] },
    { key: 'salessup',   label: '영업지원팀',                depts: ['영업지원팀'] },
    { key: 'matsalessup', label: '소재영업지원팀',           depts: ['소재영업지원팀'] },
    { key: 'globalpur',  label: '글로벌구매팀',              depts: ['글로벌구매팀'] },
    { key: 'scm',        label: 'SCM팀',                     depts: ['SCM팀'] },
    { key: 'synth',      label: '합성팀',                    depts: ['합성팀'] },
    { key: 'matprod',    label: '소재생산팀',                depts: ['소재생산팀'] },
    { key: 'sales',      label: '영업팀+영업지원팀',         depts: ['영업팀', '영업지원팀'] },
    { key: 'matsales',   label: '소재영업팀+소재영업지원팀', depts: ['소재영업팀', '소재영업지원팀'] }
  ];
  // 그룹 색상 — Tailwind 클래스 유무에 영향받지 않도록 색상값(HEX)으로 지정
  const GROUP_COLORS = {
    ops: '#4f46e5', salessup: '#0d9488', matops: '#0369a1', globalpur: '#c2410c',
    matsalessup: '#9333ea', scm: '#7c3aed', synth: '#059669', matprod: '#b45309', sales: '#be123c', matsales: '#1d4ed8'
  };
  const GROUP_KEYS = GROUPS.map(g => g.key);
  const emptyGroupState = () => {
    const o = {};
    GROUP_KEYS.forEach(k => { o[k] = { ratios: [], manualMargin: null }; });
    return o;
  };
  let alloc = {
    groups: emptyGroupState(),
    updatedAt: null,
    updatedBy: null
  };
  let draft = (() => { const o = {}; GROUP_KEYS.forEach(k => { o[k] = { ratios: [], manualMargin: '' }; }); return o; })();
  const isAppsScript = () => typeof google !== 'undefined' && google.script && google.script.run;
  const hub = () => window.KJHub || {};
  const user = () => hub().user || null;
  const isAdmin = () => !!(user() && String(user().role || '').toLowerCase() === 'admin');
  const isFullView = () => {
    const role = String((user() || {}).role || '').toLowerCase();
    return role === 'admin' || role === 'all' || role === '전체';
  };
  const token = () => hub().getToken ? hub().getToken() : null;
  // 이 화면(수익 배분 현황)에서 허용된 부서 목록 — 화면별 규칙 우선, 없으면 기존 허용부서(사업단위 확장 포함)
  function marginScreenDepts() {
    if (hub().screenDepts) {
      const list = hub().screenDepts('부서별 수익/비용');
      if (list != null) return list; // null = 제한 없음 (isFullView 경로에서 처리)
    }
    return expandedMyDepts();
  }
  // 허용부서 전개: 항목이 사업단위명(BizUnitName)이면 부서 마스터 기준 소속 전 부서로 확장
  //   (서버도 로그인 시 확장하지만, file:// 모드나 구세션 대비 프론트에서도 동일 규칙 적용)
  function expandedMyDepts() {
    const raw = (user() && user().depts) || [];
    const rows = deptMasterRows();
    if (!rows.length) return raw;
    const byBiz = Object.create(null);
    const deptSet = new Set();
    for (const r of rows) {
      const biz = norm(r['BizUnitName']);
      const dn = String(r['DeptName'] || '').trim();
      if (dn) deptSet.add(norm(dn));
      if (biz && dn) (byBiz[biz] = byBiz[biz] || []).push(dn);
    }
    const out = [];
    const seen = new Set();
    const push = d => { const k = norm(d); if (k && !seen.has(k)) { seen.add(k); out.push(d); } };
    for (const t0 of raw) {
      const t = String(t0 || '').trim();
      if (!t) continue;
      const k = norm(t);
      if (t.endsWith('*')) { push(t); continue; }
      if (deptSet.has(k)) { push(t); continue; }
      if (byBiz[k]) { byBiz[k].forEach(push); continue; }
      push(t);
    }
    return out;
  }
  function matchMyDept(dept) {
    const pats = marginScreenDepts();
    const d = String(dept || '').trim();
    for (const p0 of pats) {
      const p = String(p0 || '').trim();
      if (!p) continue;
      if (p.endsWith('*')) {
        if (d.startsWith(p.slice(0, -1))) return true;
      } else if (d === p) return true;
    }
    return false;
  }

  // ── 부서 마스터: 그룹별 부서 선택지 ───────────────────────────────────
  function deptMasterRows() {
    const rows = hub().data && hub().data.dept;
    return Array.isArray(rows) ? rows : [];
  }
  function deptOptions(group) {
    // 그룹 기준이 부서 단위로 바뀌어 UnitDiv 제한 없이 전체 부서를 협업 부서 후보로 제공
    const rows = deptMasterRows();
    if (rows.length) {
      const out = [];
      const seen = new Set();
      for (const r of rows) {
        const dn = String(r['DeptName'] || '').trim();
        if (dn && !seen.has(dn)) { seen.add(dn); out.push(dn); }
      }
      out.sort((a, b) => a.localeCompare(b, 'ko'));
      return out;
    }
    // 부서 마스터가 아직 없으면 전표에서 발견된 부서로 대체
    return Object.keys(aggregate().deptMonth).sort((a, b) => a.localeCompare(b, 'ko'));
  }

  // ── 그룹별 월 수익: 구매/판매가 발행한 사업단위별 수익 합산 ───────────
  function groupMonthlyMargin(group) {
    const r = hub().results || {};
    // ★ 기준 수익 = [구매 및 판매 내역]에서 산출된 '이윤 9종' 중 이 그룹(부서)의 월별 합계
    const byG = r.profitMonthlyByGroup;
    if (byG && byG[group.key]) return Object.assign({}, byG[group.key]);
    // 폴백: 이윤 집계 이전 버전 호환 — 구매 부서 기준 실현 수익
    const byDept = r.marginMonthlyByDept;
    if (byDept) {
      const targets = new Set((group.depts || []).map(norm));
      const out = {};
      for (const d in byDept) {
        if (!targets.has(norm(d))) continue;
        const mm = byDept[d];
        for (const m in mm) out[m] = (out[m] || 0) + mm[m];
      }
      return out;
    }
    return {}; // 아직 산출 전 (수동 수익으로 대체 가능)
  }

  // ── 전표 집계: 부서×월 / 부서×월×계정 (신구 컬럼명 모두 지원) ──────────
  let _aggCache = null; // { 화면제목: {src, out} }
  const vGet = (row, ko, en) => {
    const a = row[ko];
    if (a != null && a !== '') return a;
    const b = row[en];
    return b != null ? b : '';
  };
  // ── B단계: DB 집계(voucher_agg)가 있으면 그것을 쓰고, 없으면 원본 행으로 계산 (규칙 동일) ──
  function aggregateFromDb(title) {
    const agg = hub().agg && hub().agg.voucher;
    if (!Array.isArray(agg)) return null;
    _aggCache = _aggCache || {};
    const ck = 'db:' + title;
    const hit = _aggCache[ck];
    if (hit && hit.src === agg) return hit.out;
    // 화면 권한(부서 제한)을 집계 행에도 같은 규칙으로 적용
    const allow = hub().screenDepts ? hub().screenDepts(title) : null;
    const nrm = v => String(v == null ? '' : v).replace(/\s+/g, '').toLowerCase();
    let pass = () => true;
    if (allow != null) {
      const exact = new Set(), prefixes = [];
      allow.forEach(d => { const t = nrm(d); if (!t) return; if (t.endsWith('*')) prefixes.push(t.slice(0, -1)); else exact.add(t); });
      pass = allow.length === 0 ? () => false : d => { const v = nrm(d); return exact.has(v) || prefixes.some(p => p && v.indexOf(p) === 0); };
    }
    const deptMonth = {}, deptMonthAcc = {};
    for (const r of agg) {
      const dept = r.dept, m = r.ym, acc = r.acc, cost = Number(r.amt) || 0;
      if (!dept || !m || !pass(dept)) continue;
      if (!deptMonth[dept]) { deptMonth[dept] = {}; deptMonthAcc[dept] = {}; }
      deptMonth[dept][m] = (deptMonth[dept][m] || 0) + cost;
      if (!deptMonthAcc[dept][m]) deptMonthAcc[dept][m] = {};
      deptMonthAcc[dept][m][acc] = (deptMonthAcc[dept][m][acc] || 0) + cost;
    }
    const out = { deptMonth, deptMonthAcc, fromDb: true };
    _aggCache[ck] = { src: agg, out };
    return out;
  }
  function aggregate(screenTitle) {
    const title = screenTitle || '부서별 수익/비용';
    const db = aggregateFromDb(title);
    if (db) return db;
    return aggregateJs(title);
  }
  try { window.KJHub = window.KJHub || {}; window.KJHub.verifyVoucher = { db: t => aggregateFromDb(t || '부서별 수익/비용'), js: t => aggregateJs(t || '부서별 수익/비용') }; } catch (e) {}
  function aggregateJs(screenTitle) {
    const title = screenTitle || '부서별 수익/비용';
    const rows = hub().rowsFor ? hub().rowsFor('voucher', title) : hub().data && hub().data.voucher;
    if (!rows) return {
      deptMonth: {},
      deptMonthAcc: {}
    };
    _aggCache = _aggCache || {};
    const hit = _aggCache[title];
    if (hit && hit.src === rows) return hit.out;
    const deptMonth = {},
      deptMonthAcc = {};
    for (const row of rows) {
      const acc = String(vGet(row, '계정과목', 'AccName'));
      const desc = String(vGet(row, '적요', 'Summary'));
      const dept = String(vGet(row, '코스트센터', 'CostCCtrName') || row['부서'] || '').trim();
      const costType = String(vGet(row, '비용구분', 'UMCostTypeName'));
      if (!dept) continue;
      if (acc.includes('집합') || desc.includes('제조원가대체') || desc.includes('손익대체') || desc.includes('원가대체') || dept.includes('원가계산')) continue;
      if (!(acc.includes('(판)') || acc.includes('(제)') || costType.includes('판관') || costType.includes('제조'))) continue;
      const m = String(vGet(row, '회계일', 'AccDate')).replace(/[^0-9]/g, '').slice(0, 6);
      if (m.length !== 6) continue;
      const cost = (parseFloat(String(vGet(row, '차변금액', 'DrAmt')).replace(/,/g, '')) || 0) - (parseFloat(String(vGet(row, '대변금액', 'CrAmt')).replace(/,/g, '')) || 0);
      if (!deptMonth[dept]) {
        deptMonth[dept] = {};
        deptMonthAcc[dept] = {};
      }
      deptMonth[dept][m] = (deptMonth[dept][m] || 0) + cost;
      if (!deptMonthAcc[dept][m]) deptMonthAcc[dept][m] = {};
      deptMonthAcc[dept][m][acc] = (deptMonthAcc[dept][m][acc] || 0) + cost;
    }
    const out = {
      deptMonth,
      deptMonthAcc
    };
    _aggCache[title] = { src: rows, out: out };
    return out;
  }

  // ── 기준월 + 개월 수 → 달력 연속 월 목록 ────────────────────────────
  function latestDataMonth() {
    let max = '';
    const scan = obj => {
      for (const m in obj) if (m > max) max = m;
    };
    GROUPS.forEach(g => scan(groupMonthlyMargin(g)));
    const dm = aggregate().deptMonth;
    for (const d in dm) scan(dm[d]);
    return max;
  }
  // 마감월을 '기준월' 입력의 기본값으로 (사용자가 직접 바꾼 값은 유지)
  function applyCloseMonthTo(inputId, render) {
    const el = document.getElementById(inputId);
    if (!el) return;
    const set = () => {
      const m = (window.KJHub && window.KJHub.closeMonth) ? window.KJHub.closeMonth() : '';
      if (!m) return;
      const v = m.slice(0, 4) + '-' + m.slice(4, 6);
      if (el.value !== v) { el.value = v; if (render) render(); }
    };
    set();
    window.addEventListener('kjhub:closemonth', set);
    window.addEventListener('kjhub:login', set);
  }
  function visibleMonths() {
    const n = Number($('alMonths') && $('alMonths').value || 3);
    let anchor = '';
    const bm = $('alBaseMonth') && $('alBaseMonth').value; // 'YYYY-MM'
    if (bm) anchor = bm.replace('-', '');
    if (!anchor) anchor = latestDataMonth();
    if (!anchor || anchor.length !== 6) return [];
    let y = Number(anchor.slice(0, 4)),
      mo = Number(anchor.slice(4, 6));
    const out = [];
    for (let i = 0; i < n; i++) {
      out.unshift(String(y) + ('0' + mo).slice(-2));
      mo--;
      if (mo === 0) {
        mo = 12;
        y--;
      }
    }
    return out.filter(m => m >= MIN_MONTH);
  }

  // ── 적요 키워드 (계정별, 기준월) ─────────────────────────────────────
  const KW_STOP = new Set(['및', '관련', '비용', '대금', '지급', '결제', '기타', '외', '건', '정기', '금액', '처리', '부서', '건수', '수량', '지역', '내역', '일자', '합계', '당월', '전월', '월분', '상세', '명세', '개월', '코스트센터', '계정과목', '적요', '차변', '대변', '회계일', '비용구분', '사업장', '거래처', '전표', '급여', '상여', '상여금']);
  // 은행명 제외
  ['국민','하나','신한','우리','기업','농협','수협','새마을','신협','씨티','산업','수출입','케이','토스','카카오','국민은행','하나은행','신한은행','우리은행','농협은행','기업은행','카카오뱅크','토스뱅크','케이뱅크','은행','법인','계좌','이체','송금'].forEach(w => KW_STOP.add(w));
  // 사람 이름(정확 일치) + 성씨 기반 추정 제외
  const KW_NAME = new Set(['홍종호', '임무택']);
  const KW_SURNAME = new Set('김이박최정강조윤장임한오서신권황안송류전홍고문양손배백허남심노하곽성차주우구민'.split(''));
  const KW_SUFFIX_OK = new Set(['비', '료', '대', '금', '값', '품', '서']);
  // 날짜/금액/건수/차수 등 숫자성 토큰 제거 (2026년06월 처럼 붙은 형태까지)
  const kwIsDateNum = t => /[0-9]/.test(t) && t.replace(/[0-9,.\-\/]/g, '').replace(/(년도|분기|월분|년|월|일|차|회|기|호|건|차수)/g, '').length < 2;
  // 3글자 한글 + 성씨로 시작 + 업무접미사(비/료/대…) 아님 → 사람 이름으로 간주
  const kwLikelyName = t => KW_NAME.has(t) || (t.length === 3 && /^[가-힣]{3}$/.test(t) && KW_SURNAME.has(t[0]) && !KW_SUFFIX_OK.has(t[2]));
  // 적요 → 키워드 후보 토큰 (유니그램 + ② 인접 바이그램)
  function kwTokens(desc) {
    const raw = String(desc).split(/[^0-9A-Za-z가-힣]+/);
    const toks = [];
    for (let t of raw) {
      t = t.trim();
      if (t.length < 2) continue;
      if (/^[0-9]+$/.test(t)) continue;
      if (/[0-9]/.test(t) && /[A-Za-z]/.test(t)) continue; // BLNo/PONo 등 영숫자 혼합 코드 (예: 202604230003DD, M10E92605NU00185)
      if (kwIsDateNum(t)) continue; // 날짜/금액/건수/차수
      if (KW_STOP.has(t)) continue; // 불용어 + 은행명
      if (kwLikelyName(t)) continue; // 사람 이름
      toks.push(t);
    }
    const out = toks.slice();
    for (let i = 0; i < toks.length - 1; i++) out.push(toks[i] + ' ' + toks[i + 1]);
    return out;
  }
  // ① 계정(도넛 조각)을 문서로 보고 문서빈도(DF) 계산 → 흔한 단어 감점
  function buildKwIdf(accMap) {
    const df = Object.create(null);
    let N = 0;
    for (const a in accMap) {
      const descs = accMap[a] || {};
      const set = new Set();
      for (const d in descs)
        for (const t of kwTokens(d)) set.add(t);
      if (!set.size) continue;
      N++;
      set.forEach(t => {
        df[t] = (df[t] || 0) + 1;
      });
    }
    return { df: df, N: N };
  }
  function topKeywords(items, n, idf) {
    const score = {},
      cnt = {};
    for (const desc in items) {
      const w = Math.abs(items[desc]) || 1;
      const seen = new Set();
      for (const t of kwTokens(desc)) {
        if (seen.has(t)) continue;
        seen.add(t);
        score[t] = (score[t] || 0) + w;
        cnt[t] = (cnt[t] || 0) + 1;
      }
    }
    for (const t in score)
      if (t.indexOf(' ') >= 0) score[t] *= 1.35; // ② 두 단어 묶음 소폭 가산
    if (idf && idf.N) { // ① IDF 감점
      for (const t in score) {
        let iw = Math.log((idf.N + 1) / ((idf.df[t] || 0) + 1));
        score[t] *= (iw < 0.1 ? 0.1 : iw);
      }
    }
    const __dc = Object.keys(items).length; // 적요 건수
    const __min = __dc <= 1 ? 1 : 2; // 1건이면 1건 키워드도 생성
    let cands = Object.keys(score).filter(t => cnt[t] >= __min);
    if (!cands.length) cands = Object.keys(score).filter(t => cnt[t] >= 1);
    cands.sort((a, b) => score[b] - score[a]);
    const kept = [];
    for (const t of cands) {
      const rep = kept.find(k => t.includes(k) || k.includes(t));
      if (rep) score[rep] += score[t];else kept.push(t);
    }
    return kept.sort((a, b) => score[b] - score[a]).slice(0, n);
  }
  // 표시할 부서들의 (계정 → {적요:금액}) 를 기준월에서 한 번에 수집
  // ★ 새 화면(React)에서 같은 키워드 규칙을 쓰도록 공개
  try { window.KJHub = window.KJHub || {}; window.KJHub.kw = { kwTokens, buildKwIdf, topKeywords }; } catch (e) {}
  function collectAccItems(deptSet, months, screenTitle) {
    const rows = hub().rowsFor ? hub().rowsFor('voucher', screenTitle || '부서별 수익/비용') : hub().data && hub().data.voucher;
    const out = {};
    if (!rows || !deptSet.size) return out;
    const mset = new Set(months);
    for (const row of rows) {
      const dept = String(vGet(row, '코스트센터', 'CostCCtrName') || row['부서'] || '').trim();
      if (!deptSet.has(dept)) continue;
      const m = String(vGet(row, '회계일', 'AccDate')).replace(/[^0-9]/g, '').slice(0, 6);
      if (!mset.has(m)) continue;
      const acc = String(vGet(row, '계정과목', 'AccName'));
      const desc = String(vGet(row, '적요', 'Summary'));
      const costType = String(vGet(row, '비용구분', 'UMCostTypeName'));
      if (acc.includes('집합') || desc.includes('제조원가대체') || desc.includes('손익대체') || desc.includes('원가대체')) continue;
      if (!(acc.includes('(판)') || acc.includes('(제)') || costType.includes('판관') || costType.includes('제조'))) continue;
      const cost = (parseFloat(String(vGet(row, '차변금액', 'DrAmt')).replace(/,/g, '')) || 0) - (parseFloat(String(vGet(row, '대변금액', 'CrAmt')).replace(/,/g, '')) || 0);
      if (!out[dept]) out[dept] = {};
      if (!out[dept][acc]) out[dept][acc] = {};
      out[dept][acc][desc] = (out[dept][acc][desc] || 0) + cost;
    }
    return out;
  }

  // ── 서버 연동 (배분 설정) ─────────────────────────────────────────────
  function seedDraft() {
    if (!alSelMonth) alSelMonth = (window.KJHub && window.KJHub.closeMonth) ? window.KJHub.closeMonth() : (function () { const d = new Date(); return String(d.getFullYear()) + ('0' + (d.getMonth() + 1)).slice(-2); })();
    GROUPS.forEach(g => {
      const saved = (alloc.groups && alloc.groups[g.key]) || { ratios: [], ratiosByMonth: {}, manualMargin: null };
      const byM = {};
      const src = saved.ratiosByMonth || {};
      for (const m in src) byM[m] = (src[m] || []).map(r => ({ dept: r.dept, pct: r.pct }));
      draft[g.key] = {
        ratios: (saved.ratios || []).map(r => ({ dept: r.dept, pct: r.pct })), // 구버전 호환
        ratiosByMonth: byM,
        manualMargin: saved.manualMargin != null ? String(saved.manualMargin) : ''
      };
    });
    // 선택 기준월 편집본 = 그 달 설정(없으면 승계본 복사)
    GROUPS.forEach(g => {
      if (!draft[g.key].ratiosByMonth[alSelMonth]) {
        draft[g.key].ratiosByMonth[alSelMonth] = groupRatiosFor(g.key, alSelMonth).map(r => ({ dept: r.dept, pct: r.pct }));
      }
    });
  }
  // 편집 대상 배열 (선택 기준월)
  function editRatios(gk) {
    const d = draft[gk] || (draft[gk] = { ratios: [], ratiosByMonth: {}, manualMargin: '' });
    if (!d.ratiosByMonth) d.ratiosByMonth = {};
    if (!d.ratiosByMonth[alSelMonth]) d.ratiosByMonth[alSelMonth] = [];
    return d.ratiosByMonth[alSelMonth];
  }
  function loadConfig() {
    if (!isAppsScript() || !token()) {
      seedDraft();
      render();
      return;
    }
    google.script.run.withSuccessHandler(cfg => {
      if (cfg) {
        const keepItems = alloc.items;
        alloc = cfg;
        if (!alloc.items && keepItems) alloc.items = keepItems; // 서버가 items 미보존 시 세션 설정 유지
      }
      seedDraft();
      render();
      // 품목 배분 publish 는 부가 기능 — 실패해도 배분 비율 설정(부서) 렌더에 영향 없도록 격리
      try {
        if (window.__kjPublishItemAlloc) window.__kjPublishItemAlloc(alloc.items || {});
      } catch (e) {
        console.error('[품목 배분] publish 실패:', e);
      }
    }).withFailureHandler(() => {
      seedDraft();
      render();
    }).getAllocation(token());
  }
  function saveConfig() {
    const btn = $('alSaveBtn'),
      msg = $('alSaveMsg');
    for (const g of GROUPS) {
      const cur = editRatios(g.key);
      const sum = cur.reduce((s, r) => s + (Number(r.pct) || 0), 0);
      if (cur.length && Math.abs(sum - 100) > 0.01) {
        msg.className = 'text-xs font-semibold text-red-600';
        msg.innerText = '[' + g.label + '] 합계가 100%가 아닙니다 (현재 ' + Math.round(sum * 100) / 100 + '%)';
        cfgNotify();
        return;
      }
    }
    // ★ 이 탭은 groups 만 전송 — items(품목·원자재)는 서버가 기존값을 그대로 유지합니다
    const payload = { groups: {} };
    GROUPS.forEach(g => {
      const mm = String(draft[g.key].manualMargin || '').replace(/[^0-9\-]/g, '');
      const byM = {};
      const src = draft[g.key].ratiosByMonth || {};
      for (const m in src) {
        const arr = (src[m] || []).filter(r => r.dept).map(r => ({ dept: r.dept, pct: Number(r.pct) || 0 }));
        if (arr.length) byM[m] = arr;
      }
      payload.groups[g.key] = {
        ratios: (draft[g.key].ratios || []).map(r => ({ dept: r.dept, pct: Number(r.pct) || 0 })), // 구버전 호환
        ratiosByMonth: byM,
        manualMargin: mm === '' ? null : Number(mm)
      };
    });
    if (!isAppsScript() || !token()) {
      alloc = {
        groups: payload.groups,
        items: payload.items,
        updatedAt: alloc.updatedAt,
        updatedBy: alloc.updatedBy
      };
      msg.className = 'text-xs font-semibold text-amber-600';
      msg.innerText = '보안 서버 모드가 아니라 이 브라우저에서만 임시 적용되었습니다 (저장 안 됨).';
      render();
      return;
    }
    btn.disabled = true;
    btn.innerText = '저장 중...';
    google.script.run.withSuccessHandler(saved => {
      alloc = saved || alloc;
      if (!alloc.items && payload.items) alloc.items = payload.items; // 서버가 items 미보존 시 로컬 유지
      seedDraft();
      btn.disabled = false;
      btn.innerText = '저장';
      msg.className = 'text-xs font-semibold text-emerald-600';
      msg.innerText = '저장 완료 (' + new Date().toLocaleString('ko-KR') + ') — 팀장 화면에는 새로고침/재접속 시 반영됩니다.';
      render();
      updateDirtyBadge();
    }).withFailureHandler(err => {
      btn.disabled = false;
      btn.innerText = '저장';
      msg.className = 'text-xs font-semibold text-red-600';
      msg.innerText = err && err.message ? err.message : String(err);
      cfgNotify();
    }).saveAllocation(token(), payload);
  }
  function isDirty() {
    for (const g of GROUPS) {
      const saved = alloc.groups && alloc.groups[g.key] || {
        ratios: [],
        manualMargin: null
      };
      const norm2 = arr => JSON.stringify((arr || []).map(r => ({ dept: r.dept, pct: Number(r.pct) || 0 })));
      const a = norm2(((saved.ratiosByMonth || {})[alSelMonth]) || saved.ratios);
      const b = norm2((draft[g.key].ratiosByMonth || {})[alSelMonth]);
      const mmS = saved.manualMargin != null ? String(saved.manualMargin) : '';
      const mmD = String(draft[g.key].manualMargin || '').replace(/[^0-9\-]/g, '');
      if (a !== b || mmS !== mmD) return true;
    }
    return false;
  }
  function updateDirtyBadge() {
    const el = $('alDirtyBadge');
    if (el) el.classList.toggle('hidden', !isDirty());
    cfgNotify();
  }

  // ── 관리자 편집 UI: 그룹별 카드 ──────────────────────────────────────────
  function renderAdminEditor() {
    const card = $('alAdminCard');
    if (!isAdmin()) {
      card.classList.add('hidden');
      return;
    }
    card.classList.remove('hidden');
    const body = $('alAdminBody');
    body.innerHTML = GROUPS.map(g => {
      const d = draft[g.key];
      const cur = editRatios(g.key); // ★ 선택 기준월의 비율
      const opts = deptOptions(g).filter(x => !cur.some(r => r.dept === x));
      const sum = cur.reduce((s, r) => s + (Number(r.pct) || 0), 0);
      const ok = !cur.length || Math.abs(sum - 100) <= 0.01;
      const c = GROUP_COLORS[g.key];
      const rowsHtml = cur.map((r, i) => '<div class="flex items-center gap-2">' + '<span class="flex-1 text-sm font-medium text-slate-700 bg-white border border-slate-200 rounded-lg px-3 py-1.5 truncate">' + r.dept + '</span>' + '<input type="number" step="0.01" min="0" max="100" value="' + r.pct + '" data-grp="' + g.key + '" data-idx="' + i + '" class="al-pct w-24 bg-white border border-slate-200 text-slate-700 text-sm rounded-lg px-2.5 py-1.5 text-right outline-none focus:border-indigo-500">' + '<span class="text-xs text-slate-400">%</span>' + '<button data-grp="' + g.key + '" data-idx="' + i + '" class="al-del text-slate-400 hover:text-red-500 p-1" title="삭제"><i data-lucide="x" class="w-4 h-4"></i></button>' + '</div>').join('') || '<p class="text-xs text-slate-400">아래에서 부서를 추가해주세요.</p>';
      return '<div class="border border-slate-200 bg-slate-50/50 rounded-xl p-3" data-grpbox="' + g.key + '">' + '<div class="flex items-center justify-between gap-2 mb-2">' + '<h4 class="text-sm font-bold" style="color:' + c + '">' + g.label + '</h4>' + '<span class="al-sum text-xs font-bold px-2.5 py-1 rounded-full ' + (ok ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-red-50 text-red-600 border border-red-200') + '">합계 ' + Math.round(sum * 100) / 100 + '%</span>' + '</div>' + '<div class="space-y-2 mb-2">' + rowsHtml + '</div>' + '<div class="flex flex-wrap items-center gap-2">' + '<select data-grp="' + g.key + '" class="al-deptsel bg-white border border-slate-200 text-slate-700 text-sm rounded-lg px-2.5 py-1.5 outline-none focus:border-indigo-500"><option value="">부서 선택...</option>' + opts.map(x => '<option value="' + x + '">' + x + '</option>').join('') + '</select>' + '<button data-grp="' + g.key + '" class="al-add flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-1.5 rounded-lg font-medium text-sm transition-all"><i data-lucide="plus" class="w-4 h-4"></i> 부서 추가</button>' + '<button data-grp="' + g.key + '" class="al-equal bg-white border border-slate-300 text-slate-600 hover:bg-slate-50 px-3 py-1.5 rounded-lg font-medium text-sm transition-all">균등 배분</button>' + '<div class="flex items-center gap-1.5 ml-auto">' + '<label class="text-[11px] font-semibold text-slate-500">수동 수익(선택)</label>' + '<input type="text" data-grp="' + g.key + '" value="' + (d.manualMargin || '') + '" placeholder="비우면 자동" class="al-mm w-36 bg-white border border-slate-200 text-slate-700 text-sm rounded-lg px-2.5 py-1.5 text-right outline-none focus:border-indigo-500">' + '</div>' + '</div>' + '</div>';
    }).join('');

    // 바인딩
    body.querySelectorAll('.al-pct').forEach(inp => {
      inp.addEventListener('input', e => {
        const gk = e.target.dataset.grp;
        editRatios(gk)[Number(e.target.dataset.idx)].pct = Number(e.target.value) || 0;
        // 합계 배지만 갱신 (입력 포커스 유지)
        const box = body.querySelector('[data-grpbox="' + gk + '"] .al-sum');
        const sum = editRatios(gk).reduce((s, r) => s + (Number(r.pct) || 0), 0);
        const ok = !editRatios(gk).length || Math.abs(sum - 100) <= 0.01;
        if (box) {
          box.className = 'al-sum text-xs font-bold px-2.5 py-1 rounded-full ' + (ok ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-red-50 text-red-600 border border-red-200');
          box.innerText = '합계 ' + Math.round(sum * 100) / 100 + '%';
        }
        renderCards();
        updateDirtyBadge();
      });
    });
    body.querySelectorAll('.al-del').forEach(btn => {
      btn.addEventListener('click', e => {
        editRatios(e.currentTarget.dataset.grp).splice(Number(e.currentTarget.dataset.idx), 1);
        renderAdminEditor();
        renderCards();
        updateDirtyBadge();
      });
    });
    body.querySelectorAll('.al-add').forEach(btn => {
      btn.addEventListener('click', e => {
        const gk = e.currentTarget.dataset.grp;
        const sel = body.querySelector('.al-deptsel[data-grp="' + gk + '"]');
        if (!sel || !sel.value) return;
        editRatios(gk).push({ dept: sel.value, pct: 0 });
        renderAdminEditor();
        renderCards();
        updateDirtyBadge();
      });
    });
    body.querySelectorAll('.al-equal').forEach(btn => {
      btn.addEventListener('click', e => {
        const gk = e.currentTarget.dataset.grp;
        const rs = draft[gk].ratios;
        if (!rs.length) return;
        const per = Math.floor(10000 / rs.length) / 100;
        rs.forEach((r, i) => {
          r.pct = i === 0 ? Math.round((100 - per * (rs.length - 1)) * 100) / 100 : per;
        });
        renderAdminEditor();
        renderCards();
        updateDirtyBadge();
      });
    });
    body.querySelectorAll('.al-mm').forEach(inp => {
      inp.addEventListener('input', e => {
        draft[e.target.dataset.grp].manualMargin = e.target.value;
        renderCards();
        updateDirtyBadge();
      });
    });
    updateDirtyBadge();
    if (window.lucide) lucide.createIcons();
  }

  // ── 그래프 (막대) — 12개월도 겹치지 않도록 폭 자동 확장 + 프리미엄 스타일 ──
  function barChartSVG(months, allocSeries, costSeries, hcMonth, opts) {
    const _o = opts || {}, supA = _o.supAlloc || [], supC = _o.supCost || [];
    const n = months.length || 1;
    const many = n > 6; // 7개월 이상: 막대 위 금액을 세로(회전) 라벨로 표기
    const W = many ? Math.max(620, n * 56) : 480;
    const hasHc = !!hcMonth;
    const H = hasHc ? 206 : 188;
    const padL = 42,
      padR = 14,
      padT = (many ? 40 : 22), // 세로 금액 라벨 공간 확보
      padB = hasHc ? 48 : 30;
    const plotW = W - padL - padR,
      plotH = H - padT - padB;
    const groupW = plotW / n;
    // 구성별 금액 표기: 막대 안에 공간이 있으면 안쪽에, 없으면 세그먼트 옆에 작게
    const segLabel = (x, total, base, sup, cIn, cOut) => {
      if (!sup) return '';
      let out = '';
      const hSup = Math.max(0, y(base) - y(total));
      const hBase = Math.max(0, (padT + plotH) - y(base));
      const mid = v => x + barW / 2;
      if (hSup >= 12) out += '<text x="' + mid() + '" y="' + (y(total) + hSup / 2 + 3) + '" text-anchor="middle" font-size="8" font-weight="700" fill="' + cIn + '">' + fmtShort(sup) + '</text>';
      else out += '<text x="' + (x + barW + 2) + '" y="' + (y(total) + 7) + '" text-anchor="start" font-size="7.5" font-weight="700" fill="' + cOut + '">' + fmtShort(sup) + '</text>';
      if (hBase >= 12) out += '<text x="' + mid() + '" y="' + (y(base) + hBase / 2 + 3) + '" text-anchor="middle" font-size="8" font-weight="700" fill="#ffffff">' + fmtShort(base) + '</text>';
      return out;
    };
    const barW = Math.max(6, Math.min(many ? 15 : 26, groupW / 2 - 5));
    const rawMax = Math.max(1, ...allocSeries.map(v => Math.abs(v)), ...costSeries.map(v => Math.abs(v)));
    // 눈금이 깔끔하도록 상단 여유 (세로 라벨이 있는 many 모드는 더 여유)
    const maxV = rawMax * (many ? 1.22 : 1.1);
    const y = v => padT + plotH - Math.max(0, v) / maxV * plotH;
    // 가로 눈금선 + 좌측 금액 눈금
    let grid = '';
    const gl = 4;
    for (let gi = 0; gi <= gl; gi++) {
      const gy = padT + plotH * gi / gl;
      const gv = maxV * (gl - gi) / gl;
      grid += '<line x1="' + padL + '" y1="' + gy + '" x2="' + (W - padR) + '" y2="' + gy + '" stroke="#f1f5f9"/>';
      grid += '<text x="' + (padL - 7) + '" y="' + (gy + 3) + '" text-anchor="end" font-size="9" fill="#cbd5e1">' + fmtShort(gv) + '</text>';
    }
    let bars = '',
      labels = '';
    months.forEach((m, i) => {
      const cx = padL + groupW * i + groupW / 2;
      const a = allocSeries[i] || 0,
        c = costSeries[i] || 0;
      const over = c > a && a > 0;
      const xa = cx - barW - 2,
        xc = cx + 2;
      // Apps Script(HtmlService) iframe의 <base> 태그로 url(#gradient) 참조가 깨져 막대가 안 보이던 문제 → 단색 채움으로 고정
      // 배분 수익(진한 파랑) 위에 지원 수익(연한 파랑)을 쌓아 구분
      const sa = supA[i] || 0, sc = supC[i] || 0;
      const aBase = a - sa, cBase = c - sc;
      bars += '<rect x="' + xa + '" y="' + y(a) + '" width="' + barW + '" height="' + Math.max(0, y(aBase) - y(a)) + '" rx="3.5" fill="#7dd3fc"><title>' + mLabel(m) + ' 지원 수익: ₩' + fmt(sa) + '</title></rect>';
      bars += '<rect x="' + xa + '" y="' + y(aBase) + '" width="' + barW + '" height="' + (padT + plotH - y(aBase)) + '" rx="3.5" fill="#0066cc"><title>' + mLabel(m) + ' 배분 수익: ₩' + fmt(aBase) + '</title></rect>';
      bars += '<rect x="' + xc + '" y="' + y(c) + '" width="' + barW + '" height="' + Math.max(0, y(cBase) - y(c)) + '" rx="3.5" fill="#c4b5fd"><title>' + mLabel(m) + ' 지원 비용: ₩' + fmt(sc) + '</title></rect>';
      bars += '<rect x="' + xc + '" y="' + y(cBase) + '" width="' + barW + '" height="' + (padT + plotH - y(cBase)) + '" rx="3.5" fill="' + (over ? '#ef4444' : '#f59e0b') + '"><title>' + mLabel(m) + ' 비용: ₩' + fmt(cBase) + '</title></rect>';
      if (!many) {
        bars += '<text x="' + (xa + barW / 2) + '" y="' + (y(a) - 4) + '" text-anchor="middle" font-size="9" font-weight="600" fill="#0066cc">' + fmtShort(a) + '</text>';
        bars += '<text x="' + (xc + barW / 2) + '" y="' + (y(c) - 4) + '" text-anchor="middle" font-size="9" font-weight="600" fill="' + (over ? '#ef4444' : '#d97706') + '">' + fmtShort(c) + '</text>';
        bars += segLabel(xa, a, aBase, sa, '#ffffff', '#0369a1');
        bars += segLabel(xc, c, cBase, sc, '#ffffff', '#6d28d9');
      } else {
        // 12개월 등 조밀한 경우: 금액을 세로(회전) 라벨로 표기해 값이 보이게
        const va = (xa + barW / 2), vc = (xc + barW / 2), ya = (y(a) - 3), yc = (y(c) - 3);
        bars += '<text x="' + va + '" y="' + ya + '" text-anchor="start" font-size="8.5" font-weight="600" fill="#0066cc" transform="rotate(-90 ' + va + ' ' + ya + ')">' + fmtShort(a) + '</text>';
        bars += '<text x="' + vc + '" y="' + yc + '" text-anchor="start" font-size="8.5" font-weight="600" fill="' + (over ? '#ef4444' : '#d97706') + '" transform="rotate(-90 ' + vc + ' ' + yc + ')">' + fmtShort(c) + '</text>';
        bars += segLabel(xa, a, aBase, sa, '#ffffff', '#0369a1');
        bars += segLabel(xc, c, cBase, sc, '#ffffff', '#6d28d9');
      }
      const baseY = padT + plotH;
      const lab = many ? m.slice(2, 4) + '.' + m.slice(4, 6) : mLabel(m);
      labels += '<text x="' + cx + '" y="' + (baseY + 14) + '" text-anchor="middle" font-size="' + (many ? 9 : 10) + '" fill="#94a3b8">' + lab + '</text>';
      if (hasHc) {
        const h = hcMonth[m];
        if (h) labels += '<text x="' + cx + '" y="' + (baseY + 27) + '" text-anchor="middle" font-size="8.5" font-weight="600" fill="#64748b"><title>입사 ' + h.in + ' · 퇴사 ' + h.out + '</title>' + h.emp + '명</text>';
        else labels += '<text x="' + cx + '" y="' + (baseY + 27) + '" text-anchor="middle" font-size="8.5" fill="#cbd5e1">-</text>';
      }
    });
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" class="w-full h-auto kj-bar-svg" role="img" preserveAspectRatio="xMidYMid meet">' + grid + '<line x1="' + padL + '" y1="' + (padT + plotH) + '" x2="' + (W - padR) + '" y2="' + (padT + plotH) + '" stroke="#e2e8f0"/>' + bars + labels + '</svg>';
  }

  // ── 부서별 월별 인원 (headcount) ──────────────────────────────────────
  //   DeptName / WorkDate(년월) / EmpCnt(부서인원) / InEmpCnt(입사) / OutEmpCnt(퇴사)
  let _hcCache = null,
    _hcSrc = null;
  function headcountData() {
    const rows = hub().data && hub().data.headcount;
    if (!rows) return { byDept: {}, latest: {} };
    if (_hcCache && _hcSrc === rows) return _hcCache;
    const num = v => Number(String(v == null ? '' : v).replace(/[^0-9.\-]/g, '')) || 0;
    const byDept = {}, latest = {};
    for (const r of rows) {
      const dept = String(r['DeptName'] || r['부서'] || '').trim();
      if (!dept) continue;
      const ym = String(r['WorkDate'] || '').replace(/[^0-9]/g, '').slice(0, 6);
      if (ym.length < 6) continue;
      const rec = { emp: num(r['EmpCnt']), in: num(r['InEmpCnt']), out: num(r['OutEmpCnt']) };
      const k = norm(dept);
      (byDept[k] = byDept[k] || {})[ym] = rec;
      if (!latest[k] || ym > latest[k].ym) latest[k] = Object.assign({ ym: ym }, rec);
    }
    _hcCache = { byDept: byDept, latest: latest };
    _hcSrc = rows;
    return _hcCache;
  }

  // ── 도넛: 기준월 계정별 비용 구성 (가운데 도넛 + 꺾은선 라벨) ──────
  const DONUT_COLORS = ['#0066cc', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#a855f7', '#94a3b8'];
  // slices: [{a, v, kws:[..]}], total: 합계, curLabel: 기준월 라벨
  function donutLeaderSVG(slices, total, curLabel) {
    const live = slices.filter(s => (total > 0 ? Math.max(0, s.v) / total : 0) > 0);
    const perSide = Math.ceil(live.length / 2) || 1;
    const W = 640;
    const H = Math.max(300, 116 + perSide * 54);
    const cx = W / 2,
      cy = H / 2,
      Ro = 94,
      Ri = 60;
    const pt = (r, a) => [cx + r * Math.cos(a), cy + r * Math.sin(a)];
    // 각도 계산 (12시 방향 시작, 시계방향)
    let acc = -Math.PI / 2;
    const ang = slices.map(s => {
      const f = total > 0 ? Math.max(0, s.v) / total : 0;
      const a0 = acc,
        a1 = acc + f * 2 * Math.PI;
      acc = a1;
      return { a0, a1, mid: (a0 + a1) / 2, f };
    });
    // 도넛 세그먼트 (환형 섹터 path + 미세 간격)
    const gap = 0.026;
    let segs = '';
    slices.forEach((s, i) => {
      const A = ang[i];
      if (A.f <= 0) return;
      let a0 = A.a0 + (A.f > gap ? gap / 2 : 0),
        a1 = A.a1 - (A.f > gap ? gap / 2 : 0);
      if (a1 <= a0) {
        a0 = A.a0;
        a1 = A.a1;
      }
      const large = a1 - a0 > Math.PI ? 1 : 0;
      const o0 = pt(Ro, a0),
        o1 = pt(Ro, a1),
        i1 = pt(Ri, a1),
        i0 = pt(Ri, a0);
      const d = 'M' + o0[0].toFixed(1) + ' ' + o0[1].toFixed(1) + ' A' + Ro + ' ' + Ro + ' 0 ' + large + ' 1 ' + o1[0].toFixed(1) + ' ' + o1[1].toFixed(1) + ' L' + i1[0].toFixed(1) + ' ' + i1[1].toFixed(1) + ' A' + Ri + ' ' + Ri + ' 0 ' + large + ' 0 ' + i0[0].toFixed(1) + ' ' + i0[1].toFixed(1) + ' Z';
      segs += '<path d="' + d + '" fill="' + DONUT_COLORS[i % DONUT_COLORS.length] + '"><title>' + esc(s.a) + ': ₩' + fmt(s.v) + '</title></path>';
    });
    // 라벨: 좌/우로 나눠 세로 겹침 방지 분산
    const right = [],
      left = [];
    slices.forEach((s, i) => {
      const A = ang[i];
      if (A.f <= 0) return;
      (Math.cos(A.mid) >= 0 ? right : left).push({ i, s, mid: A.mid });
    });
    function layoutSide(arr, isR) {
      if (!arr.length) return '';
      arr.forEach(o => { o.y0 = cy + Ro * Math.sin(o.mid); });
      arr.sort((a, b) => a.y0 - b.y0);
      const minGap = 50,
        top = 26,
        bot = H - 26;
      arr.forEach(o => { o.y = o.y0; });
      for (let k = 1; k < arr.length; k++) if (arr[k].y < arr[k - 1].y + minGap) arr[k].y = arr[k - 1].y + minGap;
      const overflow = arr[arr.length - 1].y - bot;
      if (overflow > 0) arr.forEach(o => { o.y -= overflow; });
      const under = top - arr[0].y;
      if (under > 0) arr.forEach(o => { o.y += under; });
      let out = '';
      arr.forEach(o => {
        const i = o.i,
          s = o.s,
          col = DONUT_COLORS[i % DONUT_COLORS.length];
        const p1 = pt(Ro + 2, o.mid);
        // 리더선/라벨을 도넛에 더 붙여 계정명 표시 폭 확보
        const kneeX = isR ? cx + Ro + 18 : cx - Ro - 18;
        const endX = isR ? kneeX + 13 : kneeX - 13;
        out += '<path d="M' + p1[0].toFixed(1) + ' ' + p1[1].toFixed(1) + ' L' + kneeX + ' ' + o.y.toFixed(1) + ' L' + endX + ' ' + o.y.toFixed(1) + '" fill="none" stroke="' + col + '" stroke-width="1.4" stroke-opacity="0.6"/>';
        out += '<circle cx="' + p1[0].toFixed(1) + '" cy="' + p1[1].toFixed(1) + '" r="2.6" fill="' + col + '"/>';
        const tx = isR ? endX + 8 : endX - 8;
        const anchor = isR ? 'start' : 'end';
        const nameX = isR ? tx + 13 : tx - 13;
        const pct = total > 0 ? Math.round(s.v / total * 100) : 0;
        // 뷰박스 경계까지 가용 폭 계산 → 길면 자간 압축으로 잘림 방지
        const fitAt = (str, size, x) => {
          const b = (isR ? (W - x) : x) - 8;
          return String(str).length * size * 0.98 > b ? ' textLength="' + Math.max(24, Math.round(b)) + '" lengthAdjust="spacingAndGlyphs"' : '';
        };
        const nm = clip(s.a, 20);
        // 색상 점 + 계정명 (계정과목이 길어도 잘리지 않게)
        out += '<rect x="' + (isR ? tx : tx - 8).toFixed(1) + '" y="' + (o.y - 15) + '" width="8" height="8" rx="2.5" fill="' + col + '"/>';
        out += '<text x="' + nameX + '" y="' + (o.y - 8) + '" text-anchor="' + anchor + '" font-size="13" font-weight="700" fill="#1e293b"' + fitAt(nm, 13, nameX) + '>' + esc(nm) + '</text>';
        const vLine = '₩' + fmtShort(s.v) + '  ·  ' + pct + '%';
        out += '<text x="' + tx + '" y="' + (o.y + 8) + '" text-anchor="' + anchor + '" font-size="11" fill="#64748b"' + fitAt(vLine, 11, tx) + '>' + esc(vLine) + '</text>';
        if (s.kws && s.kws.length) { const kw = s.kws.join('   ·   '); out += '<text x="' + tx + '" y="' + (o.y + 22) + '" text-anchor="' + anchor + '" font-size="10" fill="#a3aebd"' + fitAt(kw, 10, tx) + '>' + esc(kw) + '</text>'; }
      });
      return out;
    }
    const labels = layoutSide(right, true) + layoutSide(left, false);
    const center = '<circle cx="' + cx + '" cy="' + cy + '" r="' + (Ri - 1) + '" fill="#ffffff"/>' + '<text x="' + cx + '" y="' + (cy - 9) + '" text-anchor="middle" font-size="10.5" fill="#94a3b8">' + esc(curLabel) + ' 총 사용</text>' + '<text x="' + cx + '" y="' + (cy + 13) + '" text-anchor="middle" font-size="21" font-weight="800" fill="#334155">₩' + fmtShort(total) + '</text>';
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" class="w-full h-auto kj-donut-svg" role="img" preserveAspectRatio="xMidYMid meet" style="max-height:' + H + 'px">' + segs + labels + center + '</svg>';
  }

  // ── 점검 포인트 ───────────────────────────────────────────────────────
  function insights(dept, months, screenTitle) {
    const acc = aggregate(screenTitle).deptMonthAcc[dept] || {};
    const cur = months[months.length - 1];
    const prevMonths = months.slice(0, -1);
    const curAcc = acc[cur] || {};
    const curTotal = Object.values(curAcc).reduce((s, v) => s + Math.max(0, v), 0);
    const ABS_MIN = 500000; // 최소 변동액(원)
    const SHARE_MIN = 0.03; // 규모 대비 최소 비중
    const items = [];
    if (prevMonths.length) {
      // 이번 달 + 과거에 등장한 계정 전체 (감소·중단도 잡기 위해)
      const names = new Set(Object.keys(curAcc));
      prevMonths.forEach(m => Object.keys(acc[m] || {}).forEach(a => names.add(a)));
      for (const a of names) {
        const curV = curAcc[a] || 0;
        const prev = prevMonths.map(m => (acc[m] || {})[a] || 0);
        const avg = prev.reduce((s, v) => s + v, 0) / prev.length;
        const d = curV - avg; // +증가 / -감소
        if (Math.abs(d) < ABS_MIN) continue; // 절대 변동 게이트
        const base = Math.max(curTotal, avg);
        if (base > 0 && Math.abs(d) < base * SHARE_MIN) continue; // 비중 게이트
        const rate = avg > 0 ? d / avg : (curV > 0 ? Infinity : 0);
        let z = null;
        if (prev.length >= 2) {
          const varc = prev.reduce((s, v) => s + (v - avg) * (v - avg), 0) / prev.length;
          const sd = Math.sqrt(varc);
          z = sd > 0 ? d / sd : (d > 0 ? Infinity : (d < 0 ? -Infinity : 0));
        }
        // 평소 변동폭 대비 크게 벗어남(±2σ) 또는 큰 상대 변동(±50%)
        const strong = (z != null && Math.abs(z) >= 2) || Math.abs(rate) >= 0.5;
        if (strong) items.push({ a: a, d: d, dir: d >= 0 ? 'up' : 'down' });
      }
      items.sort((x, y) => Math.abs(y.d) - Math.abs(x.d)).splice(4); // 변동액 큰 순 상위 4
    }
    return {
      inc: items,
      cur: cur,
      curTotal: curTotal
    };
  }

  // ── 드릴다운 ──────────────────────────────────────────────────────────
  function drillDown(dept, months, account) {
    if (hub().showScreen) hub().showScreen('dept-cost');
    const f = $('deptFilter');
    if (f) f.value = dept || '';
    const af = $('accFilter');
    if (af) af.value = account || '';
    if (months.length) {
      const m0 = months[0],
        m1 = months[months.length - 1];
      const from = $('dateFrom'),
        to = $('dateTo');
      if (from) from.value = m0.slice(0, 4) + '-' + m0.slice(4, 6) + '-01';
      if (to) {
        const last = new Date(Number(m1.slice(0, 4)), Number(m1.slice(4, 6)), 0).getDate();
        to.value = m1.slice(0, 4) + '-' + m1.slice(4, 6) + '-' + String(last).padStart(2, '0');
      }
    }
    const btn = $('searchBtn');
    if (btn) btn.click();
    try {
      window.scrollTo({
        top: 0,
        behavior: 'smooth'
      });
    } catch (_) {}
  }

  // ── 부서 체크 필터 ────────────────────────────────────────────────────
  let selectedDepts = null;
  // 사업장별 화면(본부 행 더블클릭) → 이 화면에서 해당 부서들만 조회
  window.__kjMarginSelectDepts = function (list) {
    selectedDepts = new Set((list || []).map(d => String(d || '').trim()).filter(Boolean));
    renderCards();
  };
  function renderDeptChecks(depts) {
    const box = $('alDeptChecks');
    if (!box) return;
    if (depts.length <= 1) {
      box.classList.add('hidden');
      selectedDepts = null;
      return;
    }
    box.classList.remove('hidden');
    // 현재 전체가 선택된 상태인지 판정 → 버튼 하나로 [전체 선택]/[전체 해제] 토글 (요청사항 2)
    const allOn = !selectedDepts || depts.every(d => selectedDepts.has(d));
    box.innerHTML = '<span class="text-[11px] font-semibold text-slate-400 mr-1">표시할 부서:</span>' + depts.map(d => {
      const on = !selectedDepts || selectedDepts.has(d);
      return '<label class="flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg border cursor-pointer transition-all ' + (on ? 'bg-indigo-50 text-indigo-700 border-indigo-200' : 'bg-white text-slate-400 border-slate-200') + '">' + '<input type="checkbox" class="al-deptchk accent-indigo-600" data-dept="' + d + '"' + (on ? ' checked' : '') + '>' + d + '</label>';
    }).join('') + '<button id="alChkAll" class="text-[11px] font-semibold text-indigo-600 hover:text-indigo-800 bg-indigo-50 hover:bg-indigo-100 border border-indigo-100 rounded-lg px-2.5 py-1 ml-1 transition-colors">' + (allOn ? '전체 해제' : '전체 선택') + '</button>';
    box.querySelectorAll('.al-deptchk').forEach(chk => {
      chk.addEventListener('change', () => {
        selectedDepts = new Set(Array.from(box.querySelectorAll('.al-deptchk:checked')).map(c => c.dataset.dept));
        renderCards();
      });
    });
    const allBtn = box.querySelector('#alChkAll');
    if (allBtn) allBtn.addEventListener('click', () => {
      if (allOn) selectedDepts = new Set(); // 전체 해제 (아무 부서도 표시 안 함)
      else selectedDepts = null; // 전체 선택 (모든 부서 표시)
      renderCards();
    });
  }

  // ── 카드 렌더 ─────────────────────────────────────────────────────────
  // ★ 배분 비율은 기준월별로 관리 (품목/원자재 설정과 동일 방식)
  //   해당 월 설정이 없으면 그 이전의 가장 최근 설정 월을 승계, 그것도 없으면 구버전(ratios) 사용
  let alSelMonth = ''; // 선택 기준월 (YYYYMM)
  const mIdxA = m => { const t = String(m); return parseInt(t.slice(0, 4), 10) * 12 + parseInt(t.slice(4, 6), 10) - 1; };
  const mStrA = i => String(Math.floor(i / 12)) + ('0' + (i % 12 + 1)).slice(-2);
  const mLblA = m => String(m).slice(0, 4) + '-' + String(m).slice(4, 6);
  function ratiosSrc(gk) {
    return isAdmin() ? (draft[gk] || {}) : ((alloc.groups || {})[gk] || {});
  }
  function groupRatiosFor(gk, ym) {
    const src = ratiosSrc(gk);
    const byM = src.ratiosByMonth || {};
    if (ym && byM[ym]) return byM[ym];
    if (ym) { // 승계: 기준월 이전의 가장 최근 설정
      const ks = Object.keys(byM).filter(k => mIdxA(k) <= mIdxA(ym)).map(mIdxA).sort((a, b) => b - a);
      if (ks.length) return byM[mStrA(ks[0])];
    }
    return src.ratios || [];
  }
  function groupRatios(gk) { // 편집 화면용 = 선택 기준월 기준
    return groupRatiosFor(gk, alSelMonth);
  }
  function groupManual(gk) {
    if (isAdmin()) {
      const raw = String(draft[gk].manualMargin || '').replace(/[^0-9\-]/g, '');
      return raw === '' ? null : Number(raw);
    }
    const v = ((alloc.groups || {})[gk] || {}).manualMargin;
    return v != null ? Number(v) : null;
  }
  // ── 부서별 배분 수익 재사용 헬퍼 (renderCards·renderBU 공용) ──
  //   배분 수익 = Σ(그룹 기준 수익 × 부서 배분율%). 그룹별 수동 수익이 있으면 월 균등 배분.
  //   표시 대상 부서 목록 — 표시 기간(months) 중 한 번이라도 배분받는 부서를 모두 포함
  function deptAllocMap(months) {
    const ms = (months && months.length) ? months : [alSelMonth];
    const dmap = new Map(); // dept → { dept, parts:[{g}] }
    GROUPS.forEach(g => ms.forEach(m => groupRatiosFor(g.key, m).forEach(r => {
      if (!r.dept) return;
      if (!dmap.has(r.dept)) dmap.set(r.dept, { dept: r.dept, parts: [] });
      const e = dmap.get(r.dept);
      if (!e.parts.some(p => p.g.key === g.key)) e.parts.push({ g: g });
    })));
    // 배분 비율이 없어도 지원 내역이 있으면 표시 대상에 포함
    try {
      const sp = window.__kjSupport;
      if (sp && sp.ready && sp.deptsOf) {
        ms.forEach(m => sp.deptsOf(m).forEach(d => { if (!dmap.has(d)) dmap.set(d, { dept: d, parts: [] }); }));
      }
    } catch (e) {}
    return dmap;
  }
  // 배분액 = Σ(그룹 기준 수익(월) × 그 달의 부서 배분율%). 여러 그룹에서 받으면 합산.
  //   지원 내역 설정 금액도 수익에 합산 (지원 부서 +, 지원받는 부서 −)
  //   지원 부서 = 수익(+), 지원 받는 부서 = 비용
  function supportGive(dept, ym) {
    try { const sp = window.__kjSupport; return (sp && sp.ready && sp.giveOf) ? (sp.giveOf(dept, ym) || 0) : 0; } catch (e) { return 0; }
  }
  function supportRecv(dept, ym) {
    try { const sp = window.__kjSupport; return (sp && sp.ready && sp.recvOf) ? (sp.recvOf(dept, ym) || 0) : 0; } catch (e) { return 0; }
  }
  function supportOf(dept, ym) { return supportGive(dept, ym); } // 수익 가산분
  // 배분 비율(부서·품목·원자재)로 계산된 순수 배분 수익
  function allocBaseSeries(parts, months, dept) {
    const pc = parts.map(p => ({ g: p.g, mm: groupMonthlyMargin(p.g), manual: groupManual(p.g.key) }));
    return months.map(m => pc.reduce((s, p) => {
      const rs = groupRatiosFor(p.g.key, m);
      const hit = rs.filter(r => r.dept === dept);
      if (!hit.length) return s;
      const pct = hit.reduce((a, r) => a + (Number(r.pct) || 0), 0);
      const base = p.manual != null ? p.manual / months.length : (p.mm[m] || 0);
      return s + base * pct / 100;
    }, 0));
  }
  const supportSeries = (months, dept) => months.map(m => supportGive(dept, m)); // 지원 수익
  const supportCostSeries = (months, dept) => months.map(m => supportRecv(dept, m)); // 지원 비용
  function allocSeriesFor(parts, months, dept) {
    const pc = parts.map(p => ({ g: p.g, mm: groupMonthlyMargin(p.g), manual: groupManual(p.g.key) }));
    return months.map(m => supportOf(dept, m) + pc.reduce((s, p) => {
      const rs = groupRatiosFor(p.g.key, m);
      const hit = rs.filter(r => r.dept === dept);
      if (!hit.length) return s;
      const pct = hit.reduce((a, r) => a + (Number(r.pct) || 0), 0);
      const base = p.manual != null ? p.manual / months.length : (p.mm[m] || 0);
      return s + base * pct / 100;
    }, 0));
  }
  function renderCards() {
    const wrap = $('alCards'),
      info = $('alInfo');
    const months = visibleMonths();
    const dm = aggregate().deptMonth;

    // 상단: 그룹별 기준 수익 표기 (그룹 수만큼)
    const sumBox = $('alGroupSummary');
    if (sumBox) {
      sumBox.innerHTML = GROUPS.map(g => {
        const mm = groupMonthlyMargin(g);
        const manual = groupManual(g.key);
        const total = manual != null ? manual : months.reduce((s, m) => s + (mm[m] || 0), 0);
        const c = GROUP_COLORS[g.key];
        return '<div class="flex-1 min-w-[220px] bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">' + '<p class="text-[10px] font-semibold" style="color:' + c + '">' + g.label + ' 기준 수익 <span class="text-slate-400">(' + months.length + '개월' + (manual != null ? ' · 수동 설정' : ' · 판매 발행일 기준') + ')</span></p>' + '<p class="text-xl font-bold" style="color:' + c + '">₩' + fmt(total) + '</p></div>';
      }).join('');
    }
    $('alUpdatedAt').innerText = alloc.updatedAt ? '설정: ' + new Date(alloc.updatedAt).toLocaleString('ko-KR') + (alloc.updatedBy ? ' · ' + alloc.updatedBy : '') : '';

    // 표시 대상: 부서 단위로 그룹을 합산 (한 부서가 여러 그룹에서 배분받으면 합산)
    const deptEntries = Array.from(deptAllocMap(months).values());
    const roleVisible = deptEntries.filter(e => isFullView() || matchMyDept(e.dept));
    renderDeptChecks(Array.from(new Set(roleVisible.map(e => e.dept))));
    const visible = roleVisible.filter(e => !selectedDepts || selectedDepts.has(e.dept));
    // ── ★ 새 화면(React)용 모델 내보내기: 부서별 수익/비용 ──
    try {
      const __hc = headcountData();
      const __hqm = (function () { const rows = deptMasterRows(); const m = Object.create(null); for (const r of rows) { const dn = String(r['DeptName'] || '').trim(); const hq = String(r['BizUnitName'] || '').trim(); if (dn && hq) m[norm(dn)] = hq; } return m; })();
      const __cur = months[months.length - 1];
      const __accItems = months.length ? collectAccItems(new Set(roleVisible.map(e => e.dept)), [__cur]) : {};
      const depts = months.length ? roleVisible.map(ent => {
        const dept = ent.dept;
        const allocSeries = allocSeriesFor(ent.parts, months, dept);
        const supAllocSer = supportSeries(months, dept);
        const supCostSer = supportCostSeries(months, dept);
        const voucherSer = months.map(m => (dm[dept] && dm[dept][m]) || 0);
        const costSeries = months.map((m, i) => voucherSer[i] + (supCostSer[i] || 0));
        const ins = insights(dept, months);
        const compo = ent.parts.map(p => { const rs = groupRatiosFor(p.g.key, __cur || alSelMonth).filter(r => r.dept === dept); return { key: p.g.key, label: p.g.label, pct: rs.reduce((a, r) => a + (Number(r.pct) || 0), 0) }; });
        const items = __accItems[dept] || {};
        const idf = buildKwIdf(items);
        const accTotals = Object.entries(items).map(([a, descs]) => [a, Object.values(descs).reduce((s2, v) => s2 + v, 0)]).filter(e => e[1] > 0).sort((a, b) => b[1] - a[1]);
        const slices = accTotals.slice(0, 6).map(e => ({ a: e[0], v: e[1], kws: topKeywords(items[e[0]] || {}, 2, idf) }));
        const etc = accTotals.slice(6).reduce((s2, e) => s2 + e[1], 0); if (etc > 0) slices.push({ a: '기타', v: etc, kws: [] });
        const hcM = __hc.byDept[norm(dept)] || {};
        return { d: dept, hq: __hqm[norm(dept)] || '기타', groups: compo, margin: allocSeries, supAlloc: supAllocSer, supCost: supCostSer, voucher: voucherSer, cost: costSeries,
          emp: months.map(m => (hcM[m] ? hcM[m].emp : 0)), empNow: (__hc.latest[norm(dept)] || {}).emp || 0, slices, alerts: ins.inc.map(x => ({ a: x.a, v: Math.abs(x.d), up: x.dir === 'up' })) };
      }) : [];
      const groupSummary = GROUPS.map(g => { const mm = groupMonthlyMargin(g); const manual = groupManual(g.key); const ser = months.map(m => mm[m] || 0); return { key: g.key, label: g.label, color: GROUP_COLORS[g.key], total: manual != null ? manual : ser.reduce((a, b) => a + b, 0), manual: manual != null, series: ser }; });
      const model = { id: 'margin-alloc', months, cur: __cur || '', prev: months.length > 1 ? months[months.length - 2] : null, depts, groupSummary, selected: selectedDepts ? Array.from(selectedDepts) : null, noAlloc: !deptEntries.length, isAdmin: isAdmin(), updatedAt: alloc.updatedAt || null, updatedBy: alloc.updatedBy || null };
      window.KJHub.models = window.KJHub.models || {}; window.KJHub.models['margin-alloc'] = model;
      window.dispatchEvent(new CustomEvent('kjhub:model', { detail: { id: 'margin-alloc' } }));
    } catch (e) { console.error('[KJHub] 부서별 모델 내보내기 실패', e); }
    if (!deptEntries.length || !roleVisible.length || !months.length) {
      wrap.innerHTML = '';
      info.classList.remove('hidden');
      info.innerText = !deptEntries.length ? isAdmin() ? '위에서 그룹별로 부서를 추가하고 비율을 설정해주세요.' : '아직 관리자가 배분 비율을 설정하지 않았습니다.' : !months.length ? '표시할 월 데이터가 없습니다. 기준월을 확인하거나 [구매 및 판매 현황] 탭을 한 번 열어주세요.' : '내 부서에 해당하는 배분 항목이 없습니다. 관리자에게 문의해주세요.';
      return;
    }
    if (!visible.length) {
      wrap.innerHTML = '';
      info.classList.remove('hidden');
      info.innerText = '표시할 부서를 위에서 선택해주세요.';
      return;
    }
    info.classList.add('hidden');

    // 정렬: 잔여(기본) / 수익 / 비용 / 부서명 — 금액은 내림차순, 부서명은 가나다순
    const sortMode = ($('alSort') && $('alSort').value) || 'remain';
    if (sortMode === 'name') {
      visible.sort((x, y) => x.dept.localeCompare(y.dept, 'ko'));
    } else {
      const mcache = new Map();
      const M = ent => {
        if (mcache.has(ent)) return mcache.get(ent);
        const a = allocSeriesFor(ent.parts, months, ent.dept).reduce((s, v) => s + v, 0);
        const c = months.reduce((s, m) => s + (dm[ent.dept] && dm[ent.dept][m] || 0), 0);
        const v = { a: a, c: c, r: a - c };
        mcache.set(ent, v);
        return v;
      };
      visible.sort((x, y) => {
        const mx = M(x), my = M(y);
        if (sortMode === 'cost') return my.c - mx.c; // 내림차순
        if (sortMode === 'margin') return my.a - mx.a; // 내림차순
        return my.r - mx.r; // 잔여 내림차순 (기본)
      });
    }
    const accItems = collectAccItems(new Set(visible.map(e => e.dept)), [months[months.length - 1]]);
    let html = '';
    for (const ent of visible) {
      const dept = ent.dept;
      const parts = ent.parts;
      // 부서가 속한 모든 그룹(경영은 API·경영 + 소재·경영)의 배분 수익을 월별 합산
      const allocSeries = allocSeriesFor(parts, months, ent.dept);
      const supAllocSer = supportSeries(months, dept);        // 지원 수익(수취)
      const supCostSer = supportCostSeries(months, dept);     // 지원 비용(부담)
      const costSeries = months.map((m, i) => (dm[dept] && dm[dept][m] || 0) + (supCostSer[i] || 0));
      const tAlloc = allocSeries.reduce((s, v) => s + v, 0);
      const tCost = costSeries.reduce((s, v) => s + v, 0);
      const ins = insights(dept, months);
      const li = months.length - 1;
      const cur = months[li];
      const curAlloc = allocSeries[li] || 0,
        curCost = costSeries[li] || 0;
      const prevCost = li > 0 ? costSeries[li - 1] : null;
      const momPct = prevCost != null && prevCost > 0 ? Math.round((curCost - prevCost) / prevCost * 1000) / 10 : null;
      const curUsage = curAlloc > 0 ? Math.round(curCost / curAlloc * 1000) / 10 : null;
      const kpi = (label, value, sub, subCls) => '<div class="kj-kpi rounded-xl px-3 py-3 border border-slate-100">' + '<p class="text-[10px] font-semibold text-slate-400">' + label + '</p>' + '<p class="text-lg font-bold text-slate-800 leading-tight mt-0.5">' + value + '</p>' + (sub ? '<p class="text-[10px] font-semibold mt-0.5 ' + (subCls || 'text-slate-400') + '">' + sub + '</p>' : '') + '</div>';
      const compo = parts.map(p => {
        const rs = groupRatiosFor(p.g.key, months[months.length - 1] || alSelMonth).filter(r => r.dept === ent.dept);
        const pct = rs.reduce((a, r) => a + (Number(r.pct) || 0), 0);
        return p.g.label + ' ' + pct + '%';
      }).join(' + ');
      const kpiHtml = '<div class="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3">' + kpi(mLabel(cur) + ' 배분 수익', '₩' + fmtShort(curAlloc), compo + (parts.length > 1 ? ' 합산' : ' 적용'), '') + kpi(mLabel(cur) + ' 비용', '₩' + fmtShort(curCost), momPct == null ? '' : momPct >= 0 ? '전월 대비 +' + momPct + '%' : '전월 대비 ' + momPct + '%', momPct != null && momPct > 0 ? 'text-red-500' : 'text-emerald-600') + kpi(mLabel(cur) + ' 소진율', curUsage == null ? '-' : curUsage + '%', '', '') + kpi('기간 누적 잔여', '₩' + fmtShort(tAlloc - tCost), months.length + '개월 합계 기준', tAlloc - tCost >= 0 ? 'text-indigo-500' : 'text-red-500') + '</div>';
      let rowsHtml = '';
      months.forEach((m, i) => {
        const a = allocSeries[i],
          c = costSeries[i],
          remain = a - c;
        const usage = a > 0 ? c / a * 100 : null;
        const barPct = usage == null ? 0 : Math.max(0, Math.min(100, usage));
        const barColor = usage == null ? 'bg-slate-300' : usage <= 80 ? 'bg-emerald-500' : usage <= 100 ? 'bg-amber-500' : 'bg-red-500';
        rowsHtml += '<tr class="border-b border-slate-100">' + '<td class="py-2 px-3 text-slate-500 font-medium">' + mLabel(m) + '</td>' + '<td class="py-2 px-3 text-right font-semibold text-slate-800">₩' + fmt(a) + '</td>' + '<td class="py-2 px-3 text-right text-slate-700">₩' + fmt(c) + '</td>' + '<td class="py-2 px-3 text-right font-bold ' + (remain >= 0 ? 'text-indigo-700' : 'text-red-600') + '">₩' + fmt(remain) + '</td>' + '<td class="py-2 px-3"><div class="flex items-center gap-2 justify-end">' + '<div class="w-20 h-2 bg-slate-100 rounded-full overflow-hidden hidden md:block"><div class="h-full ' + barColor + ' rounded-full" style="width:' + barPct + '%"></div></div>' + '<span class="text-xs font-semibold w-12 text-right ' + (usage != null && usage > 100 ? 'text-red-600' : 'text-slate-600') + '">' + (usage == null ? '-' : Math.round(usage * 10) / 10 + '%') + '</span>' + '</div></td>' + '</tr>';
      });
      const tUsage = tAlloc > 0 ? Math.round(tCost / tAlloc * 1000) / 10 : null;
      rowsHtml += '<tr class="bg-slate-50/70">' + '<td class="py-2 px-3 font-bold text-slate-600">합계</td>' + '<td class="py-2 px-3 text-right font-bold text-slate-900">₩' + fmt(tAlloc) + '</td>' + '<td class="py-2 px-3 text-right font-bold text-slate-800">₩' + fmt(tCost) + '</td>' + '<td class="py-2 px-3 text-right font-bold ' + (tAlloc - tCost >= 0 ? 'text-indigo-700' : 'text-red-600') + '">₩' + fmt(tAlloc - tCost) + '</td>' + '<td class="py-2 px-3 text-right text-xs font-bold ' + (tUsage != null && tUsage > 100 ? 'text-red-600' : 'text-slate-600') + '">' + (tUsage == null ? '-' : tUsage + '%') + '</td>' + '</tr>';

      // 부서별 월별 인원
      const __hc = headcountData();
      const hcDeptMonth = __hc.byDept[norm(dept)] || null;
      const hcCur = __hc.latest[norm(dept)] || null;
      const hcLabel = hcCur ? ' <span class="text-xs font-semibold text-slate-500">· 현재 인원 ' + hcCur.emp + '명</span>' : '';

      // 계정별 비용 구성 (기준월) — 가운데 도넛 + 꺾은선 라벨 (요청사항 4)
      const items = accItems[dept] || {};
      const __kwIdf = buildKwIdf(items); // ① 이 부서 도넛의 계정들을 문서로 IDF 계산
      const accTotals = Object.entries(items).map(([a, descs]) => [a, Object.values(descs).reduce((s, v) => s + v, 0)]).filter(e => e[1] > 0).sort((a, b) => b[1] - a[1]);
      const top6 = accTotals.slice(0, 6);
      const etc = accTotals.slice(6).reduce((s, e) => s + e[1], 0);
      const slices = top6.map(e => ({
        a: e[0],
        v: e[1],
        kws: topKeywords(items[e[0]] || {}, 2, __kwIdf)
      }));
      if (etc > 0) slices.push({
        a: '기타',
        v: etc,
        kws: []
      });
      const donutTotal = slices.reduce((s, x) => s + x.v, 0);
      const donutHtml = slices.length && donutTotal > 0 ? '<div class="mb-4 rounded-2xl border border-slate-100 kj-donut-panel p-4">' + '<div class="flex items-center justify-between mb-1">' + '<h4 class="text-sm font-bold text-slate-700 flex items-center gap-2 kj-sec-title">' + '<span class="kj-badge w-7 h-7 rounded-lg bg-indigo-50 text-indigo-600 flex-shrink-0"><i data-lucide="pie-chart" class="w-4 h-4"></i></span>' + mLabel(cur) + ' 계정별 비용 구성</h4>' + '<span class="text-[11px] text-slate-400">비중 순 · 상위 6개 + 기타 · 태그는 적요 키워드</span>' + '</div>' + donutLeaderSVG(slices, donutTotal, mLabel(cur)) + '</div>' : '';
      const incChips = ins.inc.map(x => {
        const up = x.dir === 'up';
        const cls = up ? 'bg-red-50 text-red-600 border-red-100' : 'bg-blue-50 text-blue-600 border-blue-100';
        const amt = (up ? '+₩' : '-₩') + fmtShort(Math.abs(x.d));
        return '<span class="text-[11px] px-2 py-1 rounded-full border ' + cls + ' whitespace-nowrap" title="' + mLabel(ins.cur) + ' 비용이 이전 개월 대비 크게 ' + (up ? '증가' : '감소') + '">' + (up ? '▲' : '▼') + ' ' + x.a + ' (' + amt + ')</span>';
      }).join('');
      // 소진율 초과·임박 경고 (배분 수익 대비 비용) — 수익 배분 맥락의 핵심 점검
      let budgetChip = '';
      if (curAlloc > 0) {
        if (curCost > curAlloc) budgetChip = '<span class="text-[11px] px-2 py-1 rounded-full bg-red-100 text-red-700 border border-red-200 font-semibold whitespace-nowrap" title="이번 기준월 비용이 배분 수익을 초과했습니다">⚠ 배분 초과 · 소진율 ' + curUsage + '%</span>';
        else if (curUsage != null && curUsage >= 85) budgetChip = '<span class="text-[11px] px-2 py-1 rounded-full bg-amber-50 text-amber-700 border border-amber-200 font-semibold whitespace-nowrap" title="배분 수익 소진이 임박했습니다(85%↑)">△ 소진 임박 · ' + curUsage + '%</span>';
      }
      const chipsInner = budgetChip + incChips;
      const chipsHtml = chipsInner ? '<div class="mt-3 pt-3 border-t border-slate-100 flex flex-wrap items-center gap-1.5"><span class="text-[11px] font-semibold text-slate-400 mr-1">점검 포인트 <span class="text-slate-300">(소진율 초과·임박 / 계정 급증·급감)</span>:</span>' + chipsInner + '</div>' : '';
      const badges = parts.map(p => { const gcc = GROUP_COLORS[p.g.key] || '#475569'; return '<span class="text-[10px] font-bold bg-white rounded-full px-2 py-0.5 align-middle" style="color:' + gcc + ';border:1px solid ' + gcc + '33">' + p.g.label + '</span>'; }).join(' ');
      html += '<div class="bg-white rounded-2xl kj-prem-card border border-slate-200 p-4">' + '<div class="al-card-head flex items-center justify-between gap-3 mb-3">' + '<h3 class="font-bold text-lg text-slate-800 kj-sec-title">' + dept + hcLabel + ' ' + badges + ' <span class="text-xs font-semibold text-indigo-500">배분율 ' + compo + '</span></h3>' + '<button data-dept="' + dept + '" class="al-drill flex items-center gap-1 text-xs font-semibold text-indigo-600 hover:text-indigo-800 transition-colors">상세 내역 보기 <i data-lucide="arrow-right" class="w-3.5 h-3.5"></i></button>' + '</div>' + kpiHtml + donutHtml + '<div class="grid lg:grid-cols-2 gap-4">' + '<div class="rounded-xl border border-slate-100 p-3">' + '<p class="text-[11px] font-semibold text-slate-500 mb-1 kj-sec-title">월별 배분 수익 vs 비용</p>' + barChartSVG(months, allocSeries, costSeries, hcDeptMonth, { supAlloc: supAllocSer, supCost: supCostSer }) + '<p class="text-[10px] text-slate-400 mt-1 text-center"><span class="inline-block w-2 h-2 rounded-sm align-middle mr-1" style="background:#0066cc"></span>배분 수익 <span class="inline-block w-2 h-2 rounded-sm align-middle ml-3 mr-1" style="background:#f59e0b"></span>비용 <span class="text-red-400 ml-2">(초과 시 빨강)</span><span class="text-slate-400 ml-2">· 년월 아래 숫자 = 부서 인원</span></p>' + '</div>' + '<div class="rounded-xl border border-slate-100 p-3"><p class="text-[11px] font-semibold text-slate-500 mb-1 kj-sec-title">월별 상세</p><div class="overflow-x-auto custom-scrollbar"><table class="w-full text-sm">' + '<thead><tr class="text-slate-400 text-[11px] border-b border-slate-200"><th class="py-1.5 px-3 text-left font-semibold">월</th><th class="py-1.5 px-3 text-right font-semibold">배분 수익</th><th class="py-1.5 px-3 text-right font-semibold">비용</th><th class="py-1.5 px-3 text-right font-semibold">잔여</th><th class="py-1.5 px-3 text-right font-semibold">소진율</th></tr></thead>' + '<tbody>' + rowsHtml + '</tbody></table></div></div>' + '</div>' + chipsHtml + '</div>';
    }
    wrap.innerHTML = html;
    const monthsNow = months;
    wrap.querySelectorAll('.al-drill').forEach(btn => {
      btn.addEventListener('click', () => { if (window.__kjDeptCostDrill) window.__kjDeptCostDrill({ dept: btn.dataset.dept, months: monthsNow }); else drillDown(btn.dataset.dept, monthsNow); });
    });
    if (window.lucide) lucide.createIcons();
  }
  function render() {
    if (!$('alCards')) return;
    renderAdminEditor();
    renderCards();
  }

  // ── 초기화 ────────────────────────────────────────────────────────────

  // ── 새 설정 화면(React) 브리지 — 상태·저장 로직은 이 모듈이 그대로 수행 ──
  function cfgNotify() { try { window.dispatchEvent(new CustomEvent('kjhub:cfg', { detail: { part: 'groups' } })); } catch (e) {} }
  window.KJHub = window.KJHub || {}; window.KJHub.cfg = window.KJHub.cfg || {};
  window.KJHub.cfg.groups = {
    GROUPS: GROUPS, GROUP_COLORS: GROUP_COLORS,
    month: () => alSelMonth,
    setMonth(m) { alSelMonth = m; seedDraft(); try { renderAdminEditor(); renderCards(); } catch (e) {} updateDirtyBadge(); },
    rows: gk => editRatios(gk).map(r => ({ dept: r.dept, pct: Number(r.pct) || 0 })),
    deptOptions: gk => deptOptions(GROUPS.find(g => g.key === gk) || {}),
    setPct(gk, i, v) { const r = editRatios(gk)[i]; if (r) r.pct = Number(v) || 0; try { renderCards(); } catch (e) {} updateDirtyBadge(); },
    del(gk, i) { editRatios(gk).splice(i, 1); try { renderCards(); } catch (e) {} updateDirtyBadge(); },
    add(gk, dept) { if (!dept || editRatios(gk).some(r => r.dept === dept)) return; editRatios(gk).push({ dept: dept, pct: 0 }); try { renderCards(); } catch (e) {} updateDirtyBadge(); },
    equal(gk) { const rs = editRatios(gk); if (!rs.length) return; const per = Math.floor(10000 / rs.length) / 100; rs.forEach((r, i) => { r.pct = i === 0 ? Math.round((100 - per * (rs.length - 1)) * 100) / 100 : per; }); try { renderCards(); } catch (e) {} updateDirtyBadge(); },
    manual: gk => String((draft[gk] || {}).manualMargin || ''),
    setManual(gk, v) { draft[gk].manualMargin = v; try { renderCards(); } catch (e) {} updateDirtyBadge(); },
    isDirty: () => isDirty(),
    save: () => saveConfig(),
    applyEvery() { const d = new Date(); const now = mIdxA(String(d.getFullYear()) + ('0' + (d.getMonth() + 1)).slice(-2)); GROUPS.forEach(g => { const cur = editRatios(g.key).map(r => ({ dept: r.dept, pct: Number(r.pct) || 0 })); for (let i = now; i > now - 24; i--) draft[g.key].ratiosByMonth[mStrA(i)] = cur.map(r => ({ dept: r.dept, pct: r.pct })); }); saveConfig(); },
    revert() { seedDraft(); try { renderAdminEditor(); renderCards(); } catch (e) {} updateDirtyBadge(); },
    hasOwnMonth: gk => !!(((alloc.groups || {})[gk] || {}).ratiosByMonth || {})[alSelMonth],
    sourceMonth(gk) { const byM = ((alloc.groups || {})[gk] || {}).ratiosByMonth || {}; if (byM[alSelMonth]) return alSelMonth; const ks = Object.keys(byM).filter(k => mIdxA(k) <= mIdxA(alSelMonth)).map(mIdxA).sort((a, b) => b - a); return ks.length ? mStrA(ks[0]) : null; },
    monthlyMargin: gk => { const g = GROUPS.find(x => x.key === gk); return g ? groupMonthlyMargin(g) : {}; },
    manualOf: gk => groupManual(gk),
    msg() { const el = $('alSaveMsg'); return el ? { text: el.innerText || '', cls: /red/.test(el.className) ? 'neg' : /emerald/.test(el.className) ? 'pos' : '' } : { text: '', cls: '' }; },
    updatedAt: () => alloc.updatedAt, updatedBy: () => alloc.updatedBy,
  };
  function init() {
    if (!$('alCards')) return;
    // 기준월 목록 (최근 24개월)
    (function () {
      const sel = $('alRatioMonth');
      if (!sel) return;
      const d = new Date();
      const now = mIdxA(String(d.getFullYear()) + ('0' + (d.getMonth() + 1)).slice(-2));
      const out = [];
      for (let i = now; i > now - 24; i--) out.push(mStrA(i));
      if (!alSelMonth) alSelMonth = out[0];
      if (out.indexOf(alSelMonth) < 0) out.unshift(alSelMonth); // 마감월이 목록 밖이면 추가
      sel.innerHTML = out.map(m => '<option value="' + m + '"' + (m === alSelMonth ? ' selected' : '') + '>' + mLblA(m) + '</option>').join('');
      sel.addEventListener('change', () => {
        alSelMonth = sel.value;
        seedDraft();
        renderAdminEditor();
        renderCards();
        updateDirtyBadge();
      });
    })();
    // 기준월 적용 = 현재 입력값을 선택 월에만 저장 / 전체 일괄 적용 = 최근 24개월 전체에 저장
    if ($('alApplyMonthBtn')) $('alApplyMonthBtn').addEventListener('click', () => saveConfig());
    if ($('alApplyEveryBtn')) $('alApplyEveryBtn').addEventListener('click', () => {
      window.KJHub.confirm({
        title: '전체 일괄 적용',
        message: '현재 입력한 비율을 전체 기준월(최근 24개월)에 적용하고 저장합니다.\n기존 월별 설정도 덮어씁니다.',
        okText: '적용하고 저장'
      }).then(ok => {
      if (!ok) return;
      const d = new Date();
      const now = mIdxA(String(d.getFullYear()) + ('0' + (d.getMonth() + 1)).slice(-2));
      GROUPS.forEach(g => {
        const cur = editRatios(g.key).map(r => ({ dept: r.dept, pct: Number(r.pct) || 0 }));
        for (let i = now; i > now - 24; i--) draft[g.key].ratiosByMonth[mStrA(i)] = cur.map(r => ({ dept: r.dept, pct: r.pct }));
      });
      saveConfig();
      });
    });
    $('alSaveBtn').addEventListener('click', saveConfig);
    $('alMonths').addEventListener('change', renderCards);
    $('alSort').addEventListener('change', renderCards);
    $('alBaseMonth').addEventListener('change', renderCards);
    window.KJHub.actions = window.KJHub.actions || {};
    window.KJHub.actions['margin-alloc'] = {
      setBaseMonth(v) { const el = $('alBaseMonth'); if (el && el.value !== v) { el.value = v; renderCards(); } },
      setMonths(n) { const el = $('alMonths'); if (el && String(el.value) !== String(n)) { el.value = String(n); renderCards(); } },
      get() { const a = $('alBaseMonth'), b = $('alMonths'); return { baseMonth: a ? a.value : '', months: Number(b && b.value || 3) }; },
      render: renderCards,
    };
    $('alBaseMonth').addEventListener('blur', () => {
      const el = $('alBaseMonth');
      if (el.value && el.value < '2025-01') {
        el.value = '2025-01';
        if (window.__kjToast) window.__kjToast('조회 가능 기간은 2025년 1월부터예요. 기준월을 2025-01로 맞췄습니다.', { title: '조회 기간 안내' });
        renderCards();
      }
    });
    $('alRevertBtn').addEventListener('click', () => {
      seedDraft();
      renderAdminEditor();
      renderCards();
      updateDirtyBadge();
      $('alSaveMsg').className = 'text-xs font-semibold text-slate-400';
      $('alSaveMsg').innerText = '마지막 저장본으로 되돌렸습니다.';
    });
    window.addEventListener('kjhub:login', loadConfig);
    window.addEventListener('kjhub:data', () => {
      _aggCache = null;
      render();
    });
    applyCloseMonthTo('alBaseMonth', render); // 기준월 기본값 = 마감월
    window.addEventListener('kjhub:results', render);
    // 지원 내역 설정이 (늦게) 도착하거나 바뀌면 국전·부서별 화면 모두 다시 계산 — 이전에는 국전 화면이 갱신되지 않아 금액이 어긋났음
    window.addEventListener('kjsupport:ready', () => { if (window.KJHub && window.KJHub.refreshModule) window.KJHub.refreshModule('profit', '지원 설정'); else render(); });
    window.addEventListener('kjhub:closemonth', e => { // 마감월 변경 → 기준월 동기화
      alSelMonth = (e.detail && e.detail.month) || alSelMonth;
      const sm = $('alRatioMonth');
      if (sm) { if (!Array.from(sm.options).some(o => o.value === alSelMonth)) sm.insertBefore(new Option(alSelMonth.slice(0, 4) + '-' + alSelMonth.slice(4, 6), alSelMonth), sm.firstChild); sm.value = alSelMonth; }
      seedDraft(); renderAdminEditor(); renderCards(); updateDirtyBadge();
    });
    if (user()) loadConfig();else {
      seedDraft();
      render();
    }
  }
  if (document.readyState === 'loading') __onReady(init);else init();

  // ==========================================================================
  // 🏭 국전 수익/비용 · 사업단위 수익/비용 — 공용 팩토리
  //   수익 = 배분 수익(배분 비율 설정 기준) · 비용 = 전표(voucher) 부서 합계
  //   SUF: 요소 id 접미사('' = 임원용 전체, '-my' = 본부장용 복제 화면)
  //   TITLES: 권한(화면명) 조회 키 목록 (첫 항목 우선, 이후 구명칭 호환)
  // ==========================================================================
  function buScreenSetup(SUF, TITLES, OPTS) {
    const $id = id => document.getElementById(id + SUF);
    if (!document.getElementById('screen-bu-margin' + SUF)) return;
    const DEPT_LEVEL = !!(OPTS && OPTS.deptLevel); // true = 구성/점검/인원을 본부가 아닌 '부서' 단위로 (본부장 화면)
    const REALIZED = !!(OPTS && OPTS.realized);   // true = 수익을 '실현 수익'(판매금액−제조원가×수량)으로 산출
    const fmtWon = v => '₩' + fmt(Math.round(v)); // 원 단위(콤마)

    // 허용부서 항목이 본부명(BizUnitName)이면 부서 마스터 기준 소속 전 부서로 확장
    //   (본부장 계정: 허용부서에 'API사업본부' 등 본부명 입력 → 소속 부서 전체 허용)
    function expandBizUnits(list) {
      const rows = deptMasterRows();
      if (!rows.length || !list.length) return list;
      const byBiz = Object.create(null);
      const deptSet = new Set();
      for (const r of rows) {
        const biz = norm(r['BizUnitName']);
        const dn = String(r['DeptName'] || '').trim();
        if (dn) deptSet.add(norm(dn));
        if (biz && dn) (byBiz[biz] = byBiz[biz] || []).push(dn);
      }
      const out = [];
      const seen = new Set();
      const push = d => { const k = norm(d); if (k && !seen.has(k)) { seen.add(k); out.push(d); } };
      list.forEach(t0 => {
        const t = String(t0 || '').trim();
        if (!t) return;
        const k = norm(t);
        if (t.endsWith('*') || deptSet.has(k)) { push(t); return; }
        if (byBiz[k]) { byBiz[k].forEach(push); return; }
        push(t);
      });
      return out;
    }
    function buDepts() {
      if (hub().screenDepts) {
        let l = hub().screenDepts(TITLES[0]);
        // 권한 시트가 구 화면명으로 설정된 경우 호환 (예: '사업장별 …')
        if (l != null && l.length === 0) {
          for (let i = 1; i < TITLES.length; i++) {
            const alt = hub().screenDepts(TITLES[i]);
            if (alt != null && alt.length) { l = alt; break; }
          }
        }
        if (l != null) return expandBizUnits(l);
      }
      return null; // 전체
    }
    function deptAllowed(d) {
      const list = buDepts();
      if (list == null) return true;
      const dd = String(d || '').trim();
      for (const p0 of list) {
        const p = String(p0 || '').trim();
        if (!p) continue;
        if (p.endsWith('*')) { if (dd.startsWith(p.slice(0, -1))) return true; }
        else if (dd === p) return true;
      }
      return false;
    }

    // 부서 마스터: dept(norm) → 본부(BizUnitName)
    function hqMap() {
      const rows = deptMasterRows();
      const m = Object.create(null);
      for (const r of rows) {
        const dn = String(r['DeptName'] || '').trim();
        const hq = String(r['BizUnitName'] || '').trim();
        if (dn && hq) m[norm(dn)] = hq;
      }
      return m;
    }
    // 본부 표시 순서 (마스터 등장 순서 유지하되 선호 순서 우선)
    const HQ_ORDER = ['경영전략본부', 'API사업본부', 'API합성본부', '소재사업본부'];
    function hqList(map) {
      const set = new Set(Object.values(map));
      const rest = Array.from(set).filter(x => !HQ_ORDER.includes(x)).sort();
      return HQ_ORDER.filter(x => set.has(x)).concat(rest);
    }
    // 사업장(수익 BU) → 본부 매핑: 본부명에서 '사업본부/본부'를 뗀 토큰이 BU명에 포함되면 그 본부(긴 토큰 우선).
    //   미매칭 BU((주)국전, (주)국전 ATS 등)는 'API' 토큰 본부(API사업본부)로 귀속.
    function assignBUtoHQ(buKeys, hqs) {
      const toks = hqs.map(hq => ({ hq: hq, t: hq.replace(/사업본부$|본부$/, '') })).sort((a, b) => b.t.length - a.t.length);
      // 미매칭 BU는 API 본부 → 없으면 첫 본부로 귀속 (어떤 BU도 누락되지 않게 → 본부 합계 = 사업장 합계 보장)
      const fallback = (toks.find(x => x.t.toUpperCase() === 'API') || toks[0] || {}).hq || '기타';
      const out = Object.create(null); // bu → hq
      buKeys.forEach(b => {
        const hit = toks.find(x => x.t && b.replace(/\s+/g, '').toUpperCase().includes(x.t.replace(/\s+/g, '').toUpperCase()));
        out[b] = hit ? hit.hq : fallback;
      });
      return out;
    }

    function buMonthList() {
      const n = Number($id('buMonths') && $id('buMonths').value || 6);
      const r = hub().results || {};
      const byBU = r.marginMonthlyByBU || {};
      const set = new Set();
      Object.values(byBU).forEach(o => Object.keys(o || {}).forEach(m => set.add(m)));
      const agg = aggregate(TITLES[0]).deptMonth;
      Object.values(agg).forEach(o => Object.keys(o || {}).forEach(m => set.add(m)));
      let all = Array.from(set).filter(m => m >= '202501').sort();
      const bm = $id('buBaseMonth') && $id('buBaseMonth').value;
      if (bm) {
        const key = bm.replace('-', '');
        all = all.filter(m => m <= key);
        if (!all.includes(key)) all.push(key);
        all = Array.from(new Set(all)).sort();
      }
      return all.slice(-n);
    }

    const pct = (a, b) => b > 0 ? Math.round((a / b) * 1000) / 10 : null;
    const mom = (cur, prev) => prev > 0 ? Math.round(((cur - prev) / prev) * 1000) / 10 : null;
    const momHtml = v => v == null ? '' : '<span class="text-[11px] font-bold ' + (v >= 0 ? 'text-emerald-600' : 'text-red-500') + '">' + (v >= 0 ? '▲ +' : '▼ ') + v + '%</span>';

    // 스파크라인 + 축 라벨(시작월/끝월)
    function sparkSVG(series, color, m0, m1) {
      const w = 280, h = 90, padX = 6, top = 10, base = 66; // 확대: 영역 채움 + 데이터 점
      const max = Math.max(1, ...series.map(v => Math.abs(v)));
      const n = series.length;
      const step = n > 1 ? (w - padX * 2) / (n - 1) : 0;
      const xy = series.map((v, i) => [padX + i * step, base - (Math.max(0, v) / max) * (base - top)]);
      const line = xy.map(p => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ');
      const area = padX + ',' + base + ' ' + line + ' ' + (padX + (n - 1) * step).toFixed(1) + ',' + base;
      const dots = xy.map((p, i) => '<circle cx="' + p[0].toFixed(1) + '" cy="' + p[1].toFixed(1) + '" r="' + (i === n - 1 ? 3 : 1.8) + '" fill="' + color + '"/>').join('');
      return '<svg viewBox="0 0 ' + w + ' ' + h + '" class="w-full" style="max-height:96px">' +
        '<polygon points="' + area + '" fill="' + color + '" opacity="0.10"/>' +
        '<line x1="' + padX + '" y1="' + base + '" x2="' + (w - padX) + '" y2="' + base + '" stroke="#e2e8f0" stroke-width="1"/>' +
        '<polyline fill="none" stroke="' + color + '" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" points="' + line + '"/>' +
        dots +
        '<text x="' + padX + '" y="' + (h - 4) + '" font-size="10" fill="#94a3b8">' + m0 + '</text>' +
        '<text x="' + (w - padX) + '" y="' + (h - 4) + '" text-anchor="end" font-size="10" fill="#94a3b8">' + m1 + '</text></svg>';
    }
    // 부서 TOP: 부서행(순위/부서/막대/금액/증감) + 그 아래 상세(계정과목·금액·키워드) · 더블클릭 드릴
    function topGridHTML(items) {
      if (!items.length) return '<p class="text-xs text-slate-400">표시할 데이터가 없습니다.</p>';
      const max = Math.max(1, ...items.map(x => x.v));
      const dcol = 'grid-template-columns:minmax(52px,0.7fr) 74px 18px 1.4fr';
      return items.map((x, i) => {
        const w = Math.max(2, Math.round(x.v / max * 100));
        const mm = x.mom == null ? '<span class="text-slate-300">-</span>' : '<span class="' + (x.mom >= 0 ? 'text-red-500' : 'text-blue-500') + '">(' + (x.mom >= 0 ? '+' : '') + x.mom + '%)</span>';
        // 순번 ↔ 부서명 한 칸 띄움(gap-x-3) · 부서행 더블클릭 → 부서별 비용
        const main = '<div class="bu-top-row grid items-center gap-x-3 rounded cursor-pointer hover:bg-indigo-50/50 transition-colors" data-dept="' + x.d + '" title="더블클릭: 부서별 비용에서 ' + x.d + ' 조회" style="grid-template-columns:20px 128px 1fr 116px 54px">' +
          '<span class="text-right text-[11px] font-bold text-slate-400">' + (i + 1) + '</span>' +
          '<span class="truncate text-xs font-semibold text-slate-700" title="' + x.d + '">' + x.d + '</span>' +
          '<div class="h-3.5 bg-slate-100 rounded-full overflow-hidden"><div class="h-full rounded-full" style="width:' + w + '%;background:linear-gradient(90deg,#3d8bff,#0066cc)"></div></div>' +
          '<span class="text-right text-xs font-semibold text-slate-700" style="font-variant-numeric:tabular-nums">' + fmtWon(x.v) + '</span>' +
          '<span class="text-right text-[11px] font-semibold" style="font-variant-numeric:tabular-nums">' + mm + '</span>' +
          '</div>';
        // 상세: 기준월 상위 계정 · 금액 · 키워드 (부서명 아래 들여쓰기) · 더블클릭 → 부서+계정 조회
        let det = '';
        if (x.det && x.det.length) {
          det = '<div class="mt-1 mb-0.5 space-y-0.5" style="padding-left:32px">' + x.det.map(a =>
            '<div class="bu-top-detail grid gap-x-1 items-center text-[11px] rounded cursor-pointer hover:bg-indigo-50/60 transition-colors" data-dept="' + x.d + '" data-acc="' + a.acc + '" title="더블클릭: ' + x.d + ' · ' + a.acc + ' 조회" style="' + dcol + '">' +
            '<span class="text-slate-500 truncate" title="' + a.acc + '">' + a.acc + '</span>' +
            '<span class="text-right text-slate-500" style="font-variant-numeric:tabular-nums">' + fmtWon(a.v) + '</span>' +
            '<span></span>' +
            '<span class="flex flex-wrap gap-1">' + (a.kw ? '<span class="px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-500 border border-slate-200">' + a.kw + '</span>' : '<span class="text-slate-300">-</span>') + '</span>' +
            '</div>').join('') + '</div>';
        }
        return '<div class="py-1.5 border-b border-slate-50 last:border-0">' + main + det + '</div>';
      }).join('');
    }
    const kpiBox = (label, value, sub, subCls) => '<div class="flex-1 min-w-[170px] bg-slate-50 rounded-xl px-3.5 py-2.5 border border-slate-100">' + '<p class="text-[11px] font-semibold text-slate-400">' + label + '</p>' + '<p class="text-base font-bold text-slate-900 leading-tight whitespace-nowrap" style="font-variant-numeric:tabular-nums">' + value + '</p>' + (sub ? '<p class="text-[11px] font-semibold ' + (subCls || 'text-slate-400') + '">' + sub + '</p>' : '') + '</div>';

    function renderBU() {
      if (!$id('buKpiStrip')) return;
      const months = buMonthList();
      const r = hub().results || {};
      const byBU = r.marginMonthlyByBU || {};
      const busAll = Object.keys(byBU);
      const empty = $id('buEmpty');
      if (!months.length || !busAll.length) {
        empty.classList.remove('hidden');
        empty.innerText = '표시할 데이터가 없습니다. [구매 및 판매 내역] 데이터가 로드되면 수익이 계산됩니다.';
        try { window.KJHub.models = window.KJHub.models || {}; window.KJHub.models['bu-margin' + SUF] = { id: 'bu-margin' + SUF, empty: true, reason: !months.length ? 'months' : 'results' }; window.dispatchEvent(new CustomEvent('kjhub:model', { detail: { id: 'bu-margin' + SUF } })); } catch (e) {}
        return;
      }
      empty.classList.add('hidden');
      const cur = months[months.length - 1];
      const prev = months.length > 1 ? months[months.length - 2] : null;
      $id('buUpdatedAt').innerText = '기준월 ' + mLabel(cur) + ' · 비교 기간 ' + months.length + '개월 (' + mLabel(months[0]) + ' ~ ' + mLabel(cur) + ')';

      // ── (참고) 전사 실현 수익 — 화면 표시에는 쓰지 않고 데이터 유무 판단에만 사용 ──
      const buSeries = {};
      busAll.forEach(b => { buSeries[b] = months.map(m => (byBU[b] || {})[m] || 0); });
      const totalMarginSeries = months.map((m, i) => busAll.reduce((s, b) => s + buSeries[b][i], 0));
      const tMargin = totalMarginSeries.reduce((s, v) => s + v, 0);

      // ── 비용 ──
      const agg = aggregate(TITLES[0]);
      const dm = agg.deptMonth;
      const deptList = Object.keys(dm).filter(deptAllowed);
      // 비용 = 전표 비용 + 지원 비용(지원 받은 금액)
      const supCostSeriesBU = months.map(m => deptList.reduce((s, d) => s + supportRecv(d, m), 0));
      const supAllocSeriesBU = months.map(m => deptList.reduce((s, d) => s + supportGive(d, m), 0));
      const totalCostSeries = months.map((m, i) => deptList.reduce((s, d) => s + (dm[d][m] || 0), 0) + (REALIZED ? 0 : (supCostSeriesBU[i] || 0)));
      const tCost = totalCostSeries.reduce((s, v) => s + v, 0);
      const curCost = totalCostSeries[months.length - 1] || 0;
      const prevCost = months.length > 1 ? totalCostSeries[months.length - 2] : 0;

      // ── 본부별 배분 수익 데이터 (배분 비율 설정 기준) — KPI/카드/비교 카드 공용 ──
      //   허용 부서만 합산 → 권한 제한 사용자(본부장)는 본인 본부의 배분 수익만 집계
      const hqm = hqMap();
      const hqs = hqList(hqm);
      const hqDepts = Object.create(null);
      deptList.forEach(d => {
        const hq = hqm[norm(d)] || '기타';
        (hqDepts[hq] = hqDepts[hq] || []).push(d);
      });
      const r0 = hub().results || {}; // 실현 수익(부서별) 원본
      const amap = deptAllocMap(months);
      const hqAllocSeries = Object.create(null); // hq → [월별 배분 수익]
      const hqAllocCnt = Object.create(null);
      if (REALIZED) { // 실현 수익은 배분 설정과 무관하게 부서별로 존재 → 대상에 추가
        Object.keys(r0.marginMonthlyByDept || {}).forEach(d => { if (!amap.has(d)) amap.set(d, { dept: d, parts: [] }); });
      }
      amap.forEach((ent, dname) => {
        if (!deptAllowed(dname)) return; // 화면 권한 밖 부서의 배분 수익 제외
        const ser = allocSeriesFor(ent.parts, months, dname);
        // 실현 수익 화면: 배분 비율이 없어도 실현 수익이 있는 부서는 모두 포함 (전체 = 회사 실현 수익과 일치)
        const use = REALIZED ? months.map(m => ((r0.marginMonthlyByDept || {})[dname] || {})[m] || 0) : ser;
        if (REALIZED ? !use.some(v => v !== 0) : !ser.some(v => v > 0)) return;
        const hq = hqm[norm(dname)] || '기타';
        if (!hqAllocSeries[hq]) { hqAllocSeries[hq] = months.map(() => 0); hqAllocCnt[hq] = 0; }
        use.forEach((v, i) => { hqAllocSeries[hq][i] += v; });
        hqAllocCnt[hq]++;
      });
      // 실현 수익 화면의 본부 표시 규칙
      //   · 본부별 수익       : 수익이 있는 본부만
      //   · 본부별 수익 vs 비용 : 수익 또는 비용이 있는 본부 (둘 다 없으면 숨김)
      const hasMargin = hq => hqAllocSeries[hq] && hqAllocSeries[hq].some(v => v !== 0);
      const hasCost = hq => (hqDepts[hq] || []).some(d => months.some(m => ((dm[d] || {})[m] || 0) !== 0));
      const hqShow = REALIZED
        ? hqs.filter(hq => hasMargin(hq) || hasCost(hq))
        : hqs.filter(hq => (hqDepts[hq] || []).length || (hqAllocSeries[hq] && hqAllocSeries[hq].some(v => v > 0)));
      if (!REALIZED && (hqDepts['기타'] || hqAllocSeries['기타']) && hqShow.indexOf('기타') < 0) hqShow.push('기타');
      if (REALIZED && (hasMargin('기타') || hasCost('기타')) && hqShow.indexOf('기타') < 0) hqShow.push('기타');
      // 본부별 '수익' 카드에만 쓰는 목록 (실현 화면은 수익 있는 본부만)
      const hqShowMargin = REALIZED ? hqShow.filter(hasMargin) : hqShow;
      const allocSeriesTotal = months.map((m, i) => Object.keys(hqAllocSeries).reduce((s, hq) => s + hqAllocSeries[hq][i], 0));
      const allocTotal = allocSeriesTotal.reduce((a, b) => a + b, 0);

      // ── 화면 표시 수익 기준: 세 화면(국전·사업단위·부서별) 모두 '배분 수익'으로 통일 ──
      //   배분 수익 = 구매/판매 내역의 이윤 × [배분 비율 설정(부서)] 비율 + 지원 내역 설정 수취액
      //   (실현 수익(판매금액−제조원가×수량)은 참고 지표로만 유지)
      const dispMarginSeries = REALIZED ? totalMarginSeries : allocSeriesTotal;
      const dispTMargin = REALIZED ? tMargin : allocTotal;
      const curMargin = dispMarginSeries[months.length - 1] || 0;
      const prevMargin = months.length > 1 ? dispMarginSeries[months.length - 2] : 0;
      const marginLbl = ' 수익';

      // ── KPI (원 단위) ──
      const usage = pct(tCost, dispTMargin);
      $id('buKpiStrip').innerHTML =
        kpiBox('기간 총' + marginLbl, fmtWon(dispTMargin), months.length + '개월 합계') +
        kpiBox(mLabel(cur) + marginLbl, fmtWon(curMargin), prev ? '전월 대비 ' + (mom(curMargin, prevMargin) == null ? '-' : (mom(curMargin, prevMargin) >= 0 ? '+' : '') + mom(curMargin, prevMargin) + '%') : '', prev && curMargin < prevMargin ? 'text-red-500' : 'text-emerald-600') +
        kpiBox('기간 총 비용', fmtWon(tCost), months.length + '개월 합계') +
        kpiBox(mLabel(cur) + ' 비용', fmtWon(curCost), prev ? '전월 대비 ' + (mom(curCost, prevCost) == null ? '-' : (mom(curCost, prevCost) >= 0 ? '+' : '') + mom(curCost, prevCost) + '%') : '', prev && curCost > prevCost ? 'text-red-500' : 'text-emerald-600') +
        kpiBox('기간 소진율', usage == null ? '-' : usage + '%', '비용 ÷ 수익', usage != null && usage > 100 ? 'text-red-500' : 'text-slate-400');

      // ── 전사/본부 추이 (제한 폭 컨테이너 안) ──
      $id('buTrend').innerHTML = barChartSVG(months, dispMarginSeries, totalCostSeries, null, REALIZED ? {} : { supAlloc: supAllocSeriesBU, supCost: supCostSeriesBU })
        + '<p class="text-[10px] text-slate-400 mt-1 text-center"><span class="inline-block w-2 h-2 rounded-sm align-middle mr-1" style="background:#0066cc"></span>' + (REALIZED ? '수익' : '배분 수익')
        + (REALIZED ? '' : ' <span class="inline-block w-2 h-2 rounded-sm align-middle ml-2 mr-1" style="background:#7dd3fc"></span>지원 수익')
        + ' <span class="inline-block w-2 h-2 rounded-sm align-middle ml-3 mr-1" style="background:#f59e0b"></span>비용'
        + (REALIZED ? '' : ' <span class="inline-block w-2 h-2 rounded-sm align-middle ml-2 mr-1" style="background:#c4b5fd"></span>지원 비용') + '</p>';

      // ── 본부별 수익 카드 (배분 수익 기준, 4개 본부) ──
      const buColors = ['#0066cc', '#0ea5e9', '#10b981', '#a855f7', '#f59e0b', '#64748b'];
      $id('buBUCards').innerHTML = hqShowMargin.map((hq, i) => {
        const s = hqAllocSeries[hq] || months.map(() => 0);
        const sum = s.reduce((x, y) => x + y, 0);
        const c = s[s.length - 1] || 0;
        const p = s.length > 1 ? s[s.length - 2] : 0;
        const share = DEPT_LEVEL ? null : pct(sum, allocTotal); // 본부장 화면은 '전사 비중' 표기 생략
        return '<div class="rounded-xl border border-slate-100 bg-slate-50/50 p-3">' +
          '<div class="flex items-center justify-between gap-2"><p class="text-sm font-bold text-slate-800 truncate" title="' + hq + '">' + hq + '</p>' + momHtml(mom(c, p)) + '</div>' +
          '<p class="text-base font-bold text-slate-900 mt-0.5" style="font-variant-numeric:tabular-nums">' + fmtWon(sum) + ' <span class="text-[11px] font-semibold text-slate-400">기간 배분 수익</span></p>' +
          '<p class="text-[11px] font-semibold text-slate-500" style="font-variant-numeric:tabular-nums">' + mLabel(cur) + ' 배분 수익 ' + fmtWon(c) + (share != null ? ' · 전사 비중 ' + share + '%' : '') + '</p>' +
          '<p class="text-[10px] text-slate-400 mt-1 mb-0.5">월별 배분 수익 추이 (가로: 월 · 세로: 원)</p>' +
          sparkSVG(s, buColors[i % buColors.length], mLabel(months[0]), mLabel(cur)) + '</div>';
      }).join('');
      if ($id('buMarginTotal')) $id('buMarginTotal').innerText = '· 기간 합계 배분 수익 ' + fmtWon(allocTotal);

      // ── 본부(BizUnitName)별: 배분 수익 vs 비용 / 도넛 / 인원 ──

      // 본부별 배분 수익 vs 비용 카드
      $id('buGroupWrap').innerHTML = hqShow.map(hq => {
        const dep = hqDepts[hq] || [];
        const mSer = hqAllocSeries[hq] || months.map(() => 0);
        const supCSer = months.map(m => REALIZED ? 0 : dep.reduce((s, d) => s + supportRecv(d, m), 0)); // 지원 비용
        const supMSer = months.map(m => REALIZED ? 0 : dep.reduce((s, d) => s + supportGive(d, m), 0));  // 지원 수익
        const cSer = months.map((m, i) => dep.reduce((s, d) => s + ((dm[d] && dm[d][m]) || 0), 0) + (supCSer[i] || 0));
        const gm = mSer.reduce((a, b2) => a + b2, 0), gc = cSer.reduce((a, b2) => a + b2, 0);
        const gu = pct(gc, gm);
        return '<div class="bg-white rounded-2xl kj-prem-card border border-slate-200 p-4">' +
          '<div class="flex items-center justify-between gap-2 mb-1"><h3 class="font-bold text-base text-slate-800 kj-sec-title">' + hq + ' — 배분 수익 vs 비용</h3>' +
          '<span class="text-[11px] font-semibold ' + (gu != null && gu > 100 ? 'text-red-500' : 'text-slate-400') + '">기간 소진율 ' + (gu == null ? '-' : gu + '%') + '</span></div>' +
          '<p class="text-[11px] text-slate-400 mb-1" style="font-variant-numeric:tabular-nums">배분 적용 부서 ' + (hqAllocCnt[hq] || 0) + '개 · 배분 수익 ' + fmtWon(gm) + ' · 비용 ' + fmtWon(gc) + '</p>' +
          barChartSVG(months, mSer, cSer, null, { supAlloc: supMSer, supCost: supCSer }) + '</div>';
      }).join('');
      if ($id('buGroupTotal')) $id('buGroupTotal').innerText = '합계 배분 수익 ' + fmtWon(allocTotal) + ' · 비용 ' + fmtWon(tCost) + ' (수익 = 부서 배분율 적용 합계)';

      // 비용 구성 도넛 (기준월) + 주요 계정·키워드 — 단위: 본부(임원) / 부서(본부장)
      const acc = agg.deptMonthAcc;
      const hqCur = {}, hqAcc = {};
      hqShow.forEach(hq => {
        let v = 0;
        const am = {};
        (hqDepts[hq] || []).forEach(d => {
          v += (dm[d][cur] || 0);
          const a = (acc[d] || {})[cur] || {};
          for (const k in a) am[k] = (am[k] || 0) + a[k];
        });
        hqCur[hq] = v;
        hqAcc[hq] = am;
      });
      // 구성 단위 추상화: u = 본부명 또는 부서명
      const unitCur = u => DEPT_LEVEL ? (dm[u] && dm[u][cur] || 0) : (hqCur[u] || 0);
      const unitAccMap = u => DEPT_LEVEL ? ((acc[u] || {})[cur] || {}) : (hqAcc[u] || {});
      const unitDeptsOf = u => DEPT_LEVEL ? [u] : (hqDepts[u] || []);
      const topAccOf = u => Object.entries(unitAccMap(u)).filter(e => e[1] > 0).sort((a, b) => b[1] - a[1]);
      // 슬라이스: 본부 전체 / 부서 상위 6 + 기타
      let divUnits, divSlices;
      if (DEPT_LEVEL) {
        const ranked = deptList.filter(d => unitCur(d) > 0).sort((a, b) => unitCur(b) - unitCur(a));
        divUnits = ranked.slice(0, 6);
        divSlices = divUnits.map(d => ({ a: d, v: unitCur(d), kws: topAccOf(d).slice(0, 2).map(e => e[0].replace(/^\((판|제)\)/, '')) }));
        const etc = ranked.slice(6).reduce((s, d) => s + unitCur(d), 0);
        if (etc > 0) divSlices.push({ a: '기타', v: etc, kws: [] });
      } else {
        divUnits = hqShow.filter(hq => unitCur(hq) > 0);
        divSlices = divUnits.map(hq => ({ a: hq, v: unitCur(hq), kws: topAccOf(hq).slice(0, 2).map(e => e[0].replace(/^\((판|제)\)/, '')) }));
      }
      const divTotal = divSlices.reduce((s, x) => s + x.v, 0);
      $id('buDivDonutMonth').innerText = mLabel(cur);
      $id('buDivDonut').innerHTML = divSlices.length && divTotal > 0 ? donutLeaderSVG(divSlices, divTotal, mLabel(cur)) : '<p class="text-xs text-slate-400 py-6 text-center">기준월 비용 데이터가 없습니다.</p>';
      // 도넛 아래: 단위별 주요 계정 TOP3 + 적요 키워드
      const items1mo = collectAccItems(new Set(deptList), [cur], TITLES[0]); // dept → acc → desc → amt
      $id('buDivDetail').innerHTML = divUnits.map(u => {
        // 단위 소속 부서들의 계정별 적요 병합 (부서 단위면 자기 자신)
        const accDescs = {};
        unitDeptsOf(u).forEach(d => {
          const per = items1mo[d] || {};
          for (const a in per) { const t = accDescs[a] = accDescs[a] || {}; const dd = per[a]; for (const de in dd) t[de] = (t[de] || 0) + dd[de]; }
        });
        const idf = buildKwIdf(accDescs);
        const tops = topAccOf(u).slice(0, 3); // 금액 내림차순
        var gcol = 'grid-template-columns:minmax(54px,0.75fr) 74px 18px 1.5fr';
        return '<div class="border-t border-slate-100 pt-1.5 mt-1.5">' +
          '<p class="text-xs font-bold text-slate-700 mb-1">' + u + '</p>' +
          '<div class="grid gap-x-1 text-[10px] font-semibold text-slate-400 mb-0.5" style="' + gcol + '"><span>계정과목</span><span class="text-right">금액</span><span></span><span>키워드</span></div>' +
          tops.map(e => {
            const kws = topKeywords(accDescs[e[0]] || {}, 2, idf);
            const dattr = DEPT_LEVEL ? 'data-dept="' + u + '"' : 'data-hq="' + u + '"';
            return '<div class="bu-div-row grid gap-x-1 items-center text-[11px] py-0.5 rounded cursor-pointer hover:bg-indigo-50/60 transition-colors" ' + dattr + ' data-acc="' + e[0] + '" title="더블클릭: 부서별 비용에서 ' + u + ' · ' + e[0] + ' 조회" style="' + gcol + '">' +
              '<span class="font-semibold text-slate-600 truncate" title="' + e[0] + '">' + e[0] + '</span>' +
              '<span class="text-right text-slate-500" style="font-variant-numeric:tabular-nums">' + fmtWon(e[1]) + '</span>' +
              '<span></span>' +
              '<span class="flex flex-wrap gap-1">' + (kws.length ? kws.map(k => '<span class="px-1.5 py-0.5 rounded-full bg-indigo-50 text-indigo-600 border border-indigo-100">' + k + '</span>').join('') : '<span class="text-slate-300">-</span>') + '</span>' +
              '</div>';
          }).join('') +
          '</div>';
      }).join('');
      $id('buDivDetail').querySelectorAll('.bu-div-row').forEach(el => {
        el.addEventListener('dblclick', () => { if (window.__kjDeptCostDrill) window.__kjDeptCostDrill({ dept: el.dataset.dept || '', unit: el.dataset.hq || '', acc: el.dataset.acc, baseMonth: cur, months: months }); });
      });

      // ── 부서 TOP 10 (정렬 통일) + 부서별 상세(계정과목·금액·키워드) ──
      const topAccForDept = d => {
        const per = (acc[d] || {})[cur] || {}; // {계정과목: 금액}
        const descByAcc = items1mo[d] || {}; // {계정과목: {적요: 금액}}
        const idfD = buildKwIdf(descByAcc);
        return Object.entries(per).filter(e => e[1] > 0).sort((a, b) => b[1] - a[1]).slice(0, 2).map(e => {
          const kws = topKeywords(descByAcc[e[0]] || {}, 1, idfD);
          return { acc: e[0], v: e[1], kw: kws[0] || '' };
        });
      };
      const tops = deptList.map(d => {
        const v = dm[d][cur] || 0;
        const pv = prev ? (dm[d][prev] || 0) : 0;
        return { d: d, v: v, mom: mom(v, pv), det: topAccForDept(d) };
      }).filter(x => x.v > 0).sort((a, b) => b.v - a.v).slice(0, 10);
      $id('buTopMonth').innerText = mLabel(cur);
      $id('buTopDepts').innerHTML = topGridHTML(tops);
      $id('buTopDepts').querySelectorAll('.bu-top-row').forEach(el => {
        el.addEventListener('dblclick', () => { if (window.__kjDeptCostDrill) window.__kjDeptCostDrill({ dept: el.dataset.dept, baseMonth: cur, months: months }); });
      });
      $id('buTopDepts').querySelectorAll('.bu-top-detail').forEach(el => {
        el.addEventListener('dblclick', () => { if (window.__kjDeptCostDrill) window.__kjDeptCostDrill({ dept: el.dataset.dept, acc: el.dataset.acc, baseMonth: cur, months: months }); });
      });

      // ── 점검 포인트: 본부(사업장)별로 나누고 부서 기준 나열 · 더블클릭 → 부서별 비용 조회 ──
      const ups = [], downs = [];
      deptList.forEach(d => {
        const ins = insights(d, months, TITLES[0]);
        (ins.inc || []).forEach(x => (x.dir === 'up' ? ups : downs).push({ d: d, a: x.a, v: Math.abs(x.d) }));
      });
      const chip = (x, up) => '<span class="bu-alert-chip cursor-pointer text-[11px] px-2 py-1 rounded-full border ' + (up ? 'bg-red-50 text-red-600 border-red-100 hover:bg-red-100' : 'bg-blue-50 text-blue-600 border-blue-100 hover:bg-blue-100') + ' whitespace-nowrap transition-colors" data-dept="' + x.d + '" data-acc="' + x.a + '" title="더블클릭: 부서별 비용에서 ' + x.d + ' · ' + x.a + ' 조회" style="font-variant-numeric:tabular-nums">' + (up ? '▲' : '▼') + ' ' + x.d + ' · ' + x.a + ' (' + (up ? '+' : '-') + fmtWon(x.v) + ')</span>';
      // 본부별 그룹핑(임원) / 부서 기준 플랫 나열(본부장) — 금액 큰 순
      const groupByHq = (list, up) => {
        if (!list.length) return '<p class="text-xs text-slate-400">기준월에 급' + (up ? '증' : '감') + '한 부서 계정이 없습니다.</p>';
        if (DEPT_LEVEL) {
          const items = list.sort((a, b) => b.v - a.v).slice(0, 10);
          return '<div class="flex flex-wrap gap-1.5">' + items.map(x => chip(x, up)).join('') + '</div>';
        }
        const byHq = Object.create(null);
        list.forEach(x => { const hq = hqm[norm(x.d)] || '기타'; (byHq[hq] = byHq[hq] || []).push(x); });
        const order = hqShow.filter(h => byHq[h]).concat(Object.keys(byHq).filter(h => hqShow.indexOf(h) < 0));
        return order.map(hq => {
          const items = byHq[hq].sort((a, b) => b.v - a.v).slice(0, 6);
          return '<div class="mb-2 last:mb-0"><p class="text-[10px] font-bold ' + (up ? 'text-red-400' : 'text-blue-400') + ' mb-1">' + hq + '</p><div class="flex flex-wrap gap-1.5">' + items.map(x => chip(x, up)).join('') + '</div></div>';
        }).join('');
      };
      $id('buAlertsUp').innerHTML = groupByHq(ups, true);
      $id('buAlertsDown').innerHTML = groupByHq(downs, false);
      ['buAlertsUp', 'buAlertsDown'].forEach(id => {
        const box = $id(id);
        if (!box) return;
        box.querySelectorAll('.bu-alert-chip').forEach(el => {
          el.addEventListener('dblclick', () => { if (window.__kjDeptCostDrill) window.__kjDeptCostDrill({ dept: el.dataset.dept, acc: el.dataset.acc, baseMonth: cur, months: months }); });
        });
      });

      // ── 인원 · 인당 비용 (본부 단위(임원) / 부서 단위(본부장)) · 더블클릭 → 부서별 화면 조회 ──
      const hc = headcountData();
      let hcRows;
      if (DEPT_LEVEL) {
        hcRows = deptList.map(d => {
          const rec = (hc.byDept[norm(d)] || {})[cur];
          return { hq: d, emp: rec ? rec.emp : 0, cost: dm[d][cur] || 0 };
        }).filter(x => x.cost > 0 || x.emp > 0).sort((a, b) => b.cost - a.cost).map(x => Object.assign(x, { per: x.emp > 0 ? x.cost / x.emp : null }));
      } else {
        const hqHc = {};
        Object.keys(hc.byDept).forEach(k => {
          const rec = hc.byDept[k][cur];
          if (!rec) return;
          const hq = hqm[k] || '기타';
          hqHc[hq] = (hqHc[hq] || 0) + rec.emp;
        });
        hcRows = hqShow.map(hq => ({ hq: hq, emp: hqHc[hq] || 0, cost: hqCur[hq] || 0 })).filter(x => x.cost > 0 || x.emp > 0).map(x => Object.assign(x, { per: x.emp > 0 ? x.cost / x.emp : null }));
      }
      const hcUnitLbl = DEPT_LEVEL ? '부서' : '본부';
      $id('buHcMonth').innerText = mLabel(cur);
      $id('buHeadcount').innerHTML = hcRows.length ? '<table class="w-full text-sm"><thead><tr class="text-slate-400 text-[11px] border-b border-slate-200"><th class="py-1.5 px-3 text-left font-semibold">' + hcUnitLbl + '</th><th class="py-1.5 px-3 text-right font-semibold">인원</th><th class="py-1.5 px-3 text-right font-semibold">비용</th><th class="py-1.5 px-3 text-right font-semibold">인당 비용</th></tr></thead><tbody>' + hcRows.map(x => '<tr class="border-b border-slate-100 cursor-pointer hover:bg-indigo-50/40 bu-hc-row" data-hq="' + x.hq + '" title="더블클릭: 부서별 수익/비용에서 ' + x.hq + ' 조회"><td class="py-2 px-3 font-semibold text-slate-700">' + x.hq + '</td><td class="py-2 px-3 text-right text-slate-700" style="font-variant-numeric:tabular-nums">' + (x.emp || '-') + (x.emp ? '명' : '') + '</td><td class="py-2 px-3 text-right font-semibold text-slate-800" style="font-variant-numeric:tabular-nums">' + fmtWon(x.cost) + '</td><td class="py-2 px-3 text-right text-slate-700" style="font-variant-numeric:tabular-nums">' + (x.per != null ? fmtWon(x.per) : '-') + '</td></tr>').join('') + '</tbody></table>' : '<p class="text-xs text-slate-400">기준월 인원 데이터가 없습니다. (부서별 월별 인원 시트 연동 필요)</p>';
      // ── ★ 새 화면(React)용 모델 내보내기 — 계산 결과를 그대로 전달 ──
      try {
        const zeros = () => months.map(() => 0);
        const model = {
          id: 'bu-margin' + SUF, realized: REALIZED, deptLevel: DEPT_LEVEL, months, cur, prev,
          kpi: { tMargin: dispTMargin, curMargin, prevMargin, tCost, curCost, prevCost, usage, allocTotal },
          series: { margin: dispMarginSeries, cost: totalCostSeries, supAlloc: REALIZED ? zeros() : supAllocSeriesBU, supCost: REALIZED ? zeros() : supCostSeriesBU },
          hqCards: hqShowMargin.map(hq => { const s2 = hqAllocSeries[hq] || zeros(); const sum = s2.reduce((x, y) => x + y, 0); return { hq, series: s2, sum, cur: s2[s2.length - 1] || 0, prev: s2.length > 1 ? s2[s2.length - 2] : 0, share: DEPT_LEVEL ? null : pct(sum, allocTotal) }; }),
          hqGroups: hqShow.map(hq => { const dep = hqDepts[hq] || []; const mSer = hqAllocSeries[hq] || zeros();
            const supC = months.map(m => REALIZED ? 0 : dep.reduce((s3, d) => s3 + supportRecv(d, m), 0)); const supM = months.map(m => REALIZED ? 0 : dep.reduce((s3, d) => s3 + supportGive(d, m), 0));
            const cSer = months.map((m, i) => dep.reduce((s3, d) => s3 + ((dm[d] && dm[d][m]) || 0), 0) + (supC[i] || 0));
            return { hq, margin: mSer, cost: cSer, supAlloc: supM, supCost: supC, deptCount: hqAllocCnt[hq] || 0, depts: dep }; }),
          donut: divSlices, divDetail: divUnits.map(u => { const accDescs = {}; unitDeptsOf(u).forEach(d => { const per = items1mo[d] || {}; for (const a in per) { const t = accDescs[a] = accDescs[a] || {}; const dd = per[a]; for (const de in dd) t[de] = (t[de] || 0) + dd[de]; } });
            const idf = buildKwIdf(accDescs); return { unit: u, isDept: DEPT_LEVEL, total: unitCur(u), tops: topAccOf(u).slice(0, 3).map(e => ({ acc: e[0], v: e[1], kws: topKeywords(accDescs[e[0]] || {}, 2, idf) })) }; }),
          topDepts: tops, alerts: { ups: ups.map(x => Object.assign({ hq: hqm[norm(x.d)] || '기타' }, x)), downs: downs.map(x => Object.assign({ hq: hqm[norm(x.d)] || '기타' }, x)) },
          headcount: hcRows.map(x => Object.assign({ depts: DEPT_LEVEL ? [x.hq] : (hqDepts[x.hq] || []) }, x)),
          hqOrder: hqShow,
          // 수익은 어디서 났나: 이윤 원천(그룹)별 · 사업장(BU)별 · 부서별(배분 후) · 지원 수익
          revenue: (function () {
            const byGroup = GROUPS.map(g => { const mm = groupMonthlyMargin(g); const ser = months.map(m => mm[m] || 0); return { key: g.key, label: g.label, series: ser, cur: ser[ser.length - 1] || 0, prev: ser.length > 1 ? ser[ser.length - 2] : 0, sum: ser.reduce((a, b) => a + b, 0) }; }).filter(x => x.series.some(v => v !== 0));
            const byBUList = busAll.map(b => { const ser = buSeries[b]; return { bu: b, series: ser, cur: ser[ser.length - 1] || 0, prev: ser.length > 1 ? ser[ser.length - 2] : 0, sum: ser.reduce((a, b2) => a + b2, 0) }; }).filter(x => x.series.some(v => v !== 0));
            const byDeptList = [];
            amap.forEach((ent, dname) => { if (!deptAllowed(dname)) return; const ser = allocSeriesFor(ent.parts, months, dname); const use = REALIZED ? months.map(m => ((r0.marginMonthlyByDept || {})[dname] || {})[m] || 0) : ser; if (!use.some(v => REALIZED ? v !== 0 : v > 0)) return; byDeptList.push({ d: dname, hq: hqm[norm(dname)] || '기타', cur: use[use.length - 1] || 0, prev: use.length > 1 ? use[use.length - 2] : 0, sum: use.reduce((a, b) => a + b, 0), groups: ent.parts.map(p => p.g.label), support: REALIZED ? 0 : supportGive(dname, cur) }); });
            byDeptList.sort((a, b) => b.cur - a.cur);
            return { byGroup, byBU: byBUList, byDept: byDeptList, supportCur: REALIZED ? 0 : (supAllocSeriesBU[months.length - 1] || 0) };
          })(),
          // 부서 단위 행 (본부 펼침용): 수익·비용·인원
          deptRows: (function () {
            const rows = [];
            const seen = new Set();
            const push = (d) => {
              if (seen.has(d)) return; seen.add(d);
              const ent = amap.get(d);
              const ser = ent ? allocSeriesFor(ent.parts, months, d) : zeros();
              const use = REALIZED ? months.map(m => ((r0.marginMonthlyByDept || {})[d] || {})[m] || 0) : ser;
              const costSer = months.map(m => ((dm[d] && dm[d][m]) || 0) + (REALIZED ? 0 : supportRecv(d, m)));
              const rec = (hc.byDept[norm(d)] || {})[cur];
              rows.push({ d, hq: hqm[norm(d)] || '기타', margin: use, cost: costSer, emp: rec ? rec.emp : 0 });
            };
            deptList.forEach(push);
            amap.forEach((ent, d) => { if (deptAllowed(d)) push(d); });
            return rows;
          })(),
        };
        window.KJHub.models = window.KJHub.models || {};
        window.KJHub.models[model.id] = model;
        window.dispatchEvent(new CustomEvent('kjhub:model', { detail: { id: model.id } }));
      } catch (e) { console.error('[KJHub] 모델 내보내기 실패', e); }
      $id('buHeadcount').querySelectorAll('.bu-hc-row').forEach(tr => {
        tr.addEventListener('dblclick', () => {
          const key = tr.dataset.hq;
          const list = DEPT_LEVEL ? [key] : (hqDepts[key] || []).slice();
          const bmEl = $('alBaseMonth');
          if (bmEl) bmEl.value = cur.slice(0, 4) + '-' + cur.slice(4, 6); // 기준월 유지
          if (window.__kjMarginSelectDepts) window.__kjMarginSelectDepts(list);
          if (hub().showScreen) hub().showScreen('margin-alloc');
        });
      });
    }

    function initBU() {
      if (!$id('buKpiStrip')) return;
      ['buMonths', 'buBaseMonth'].forEach(id => {
        const el = $id(id);
        if (el) el.addEventListener('change', renderBU);
      });
      const bm = $id('buBaseMonth');
      if (bm) bm.addEventListener('blur', () => {
        if (bm.value && bm.value < '2025-01') {
          bm.value = '2025-01';
          if (window.__kjToast) window.__kjToast('조회 가능 기간은 2025년 1월부터예요.', { title: '조회 기간 안내' });
          renderBU();
        }
      });
      window.addEventListener('kjhub:data', renderBU);
      window.addEventListener('kjhub:results', renderBU);
      // ★ 새 화면(React)에서 조회 조건을 바꿀 때 사용
      window.KJHub.actions = window.KJHub.actions || {};
      window.KJHub.actions['bu-margin' + SUF] = {
        setBaseMonth(v) { const el = $id('buBaseMonth'); if (el && el.value !== v) { el.value = v; renderBU(); } },
        setMonths(n) { const el = $id('buMonths'); if (el && String(el.value) !== String(n)) { el.value = String(n); renderBU(); } },
        get() { const a = $id('buBaseMonth'), b = $id('buMonths'); return { baseMonth: a ? a.value : '', months: Number(b && b.value || 6) }; },
        render: renderBU,
      };
      // 기준월 기본값 = 마감월 (국전 수익/비용 · 사업단위 수익/비용)
      (function () {
        const el = $id('buBaseMonth');
        if (!el) return;
        const set = () => {
          const m = (window.KJHub && window.KJHub.closeMonth) ? window.KJHub.closeMonth() : '';
          if (!m) return;
          const v = m.slice(0, 4) + '-' + m.slice(4, 6);
          if (el.value !== v) { el.value = v; renderBU(); }
        };
        set();
        window.addEventListener('kjhub:closemonth', set);
        window.addEventListener('kjhub:login', set);
      })();
      renderBU();
    }
    if (document.readyState === 'loading') __onReady(initBU);else initBU();
  }
  // ── 인스턴스 1: 국전 수익/비용 (대표·부대표·임원 — 전체) ──
  buScreenSetup('', ['국전 수익/비용', '사업단위별 수익 및 사용 내역', '사업장별 수익 및 사용 내역']); // 뒤 두 개는 기존 권한 설정 호환용
  // ── 인스턴스 2: 사업단위 수익/비용 (본부장 — 본인 본부만) ──
  //   원본 화면을 복제(-my 접미사)해 동일 구성으로 만들고, 권한(허용부서=본부명)으로 데이터만 제한
  (function () {
    const src = document.getElementById('screen-bu-margin');
    if (src && !document.getElementById('screen-bu-margin-my')) {
      const c = src.cloneNode(true);
      c.id = 'screen-bu-margin-my';
      c.classList.add('hidden'); // 복제 직후엔 항상 숨김 (showScreen이 표시 관리)
      c.querySelectorAll('[id]').forEach(el => { el.id = el.id + '-my'; });
      src.parentNode.insertBefore(c, src.nextSibling);
      // 본부장 화면 전용 문구 정리 (선행 텍스트만 교체 → 값 표시 span 은 보존)
      const setLead = (id, txt) => {
        const el = c.querySelector('#' + id);
        if (!el) return;
        if (el.firstChild && el.firstChild.nodeType === 3) el.firstChild.nodeValue = txt;
        else el.textContent = txt;
      };
      setLead('buTrendTitle-my', '본부 비용');
      setLead('buMarginTitle-my', '본부 수익 ');
      setLead('buGroupTitle-my', ''); // '본부별 수익 vs 비용' 문구 삭제
      setLead('buDivTitle-my', '부서 비용 구성 ');
      setLead('buTopTitle-my', '부서 비용 ');
      setLead('buInspectLabel-my', '부서 · 기준월 계정 · 직전 개월 평균 대비');
      setLead('buHcTitle-my', '부서 인원 · 인당 비용 ');

      // 본부장 화면만: '본부 수익'(좌) + 'vs 비용'(우) 좌우 배치
      const secM = c.querySelector('#buMarginSection-my');
      const secG = c.querySelector('#buGroupSection-my');
      if (secM && secG) {
        const row = c.ownerDocument.createElement('div');
        row.className = 'grid lg:grid-cols-2 gap-4 items-start';
        secM.parentNode.insertBefore(row, secM);
        row.appendChild(secM);
        row.appendChild(secG);
        const bc = c.querySelector('#buBUCards-my'); if (bc) bc.className = 'grid grid-cols-1 gap-3';
        const gw = c.querySelector('#buGroupWrap-my'); if (gw) gw.className = 'grid grid-cols-1 gap-4';
      }
      // 합계 문구: '본부 비용'(전사 추이) 카드 위로 이동 + 오른쪽 정렬
      const trendEl = c.querySelector('#buTrend-my');
      const trendCard = trendEl ? trendEl.closest('.kj-prem-card') : null;
      const gtot = c.querySelector('#buGroupTotal-my');
      if (trendCard && gtot) {
        gtot.className = 'block text-right text-[11px] font-semibold text-slate-400 px-1';
        trendCard.parentNode.insertBefore(gtot, trendCard);
      }
      const gh = c.querySelector('#buGroupHead-my'); if (gh) gh.remove(); // 빈 헤더(삭제된 제목) 제거
    }
    buScreenSetup('-my', ['사업단위 수익/비용', '사업단위 수익 및 사용 내역'], { deptLevel: true }); // 뒤는 기존 권한 설정 호환용
  })();
  // ── 인스턴스 3: 국전 수익/비용(실현 수익) ──
  //   수익 = 구매/판매 내역의 실현 수익(판매금액 − 제조원가 × 판매수량), 비용 = 부서별 비용(전표)
  (function () {
    const src = document.getElementById('screen-bu-margin');
    if (src && !document.getElementById('screen-bu-margin-real')) {
      const c = src.cloneNode(true);
      c.id = 'screen-bu-margin-real';
      c.classList.add('hidden');
      c.querySelectorAll('[id]').forEach(el => { el.id = el.id + '-real'; });
      src.parentNode.insertBefore(c, src.nextSibling);
      const setLead = (id, txt) => {
        const el = c.querySelector('#' + id);
        if (!el) return;
        if (el.firstChild && el.firstChild.nodeType === 3) el.firstChild.nodeValue = txt;
        else el.textContent = txt;
      };
      setLead('buTrendTitle-real', '전사 월별 수익 vs 비용 (실현)');
      setLead('buMarginTitle-real', '본부별 수익 (실현) ');
      setLead('buGroupTitle-real', '본부별 수익 vs 비용 (실현)');
    }
    buScreenSetup('-real', ['국전 수익/비용(실현 수익)', '국전 수익/비용'], { realized: true }); // 권한은 국전 화면과 동일 적용
  })();

  // ==========================================================================
  // 📦 배분 비율 설정(품목) — 관리자 전용
  //   품목별 판매가(기본: 이전 분기 구매 평균가 — 없으면 직전 구매 분기)와 비율(%) 설정.
  //   [구매 및 판매 내역]의 '실현 수익(구매)' = 판매가 × 구매수량 × 비율 − 구매원가 계산에 사용.
  //   저장은 기존 saveAllocation 채널의 items 키로 함께 저장/로드.
  // ==========================================================================
  (function itemAllocScreen() {
    if (!document.getElementById('screen-alloc-items')) return;
    const $a = id => document.getElementById(id);
    const gv = (row, keys) => {
      for (const k of keys) { const v = row[k]; if (v != null && String(v).trim() !== '') return v; }
      return '';
    };
    const num = v => { const n = parseFloat(String(v == null ? '' : v).replace(/,/g, '')); return isFinite(n) ? n : 0; };
    const fmtN = v => (Math.round(v * 100) / 100).toLocaleString('ko-KR');

    // ── 컬럼명 자동 탐지 (시트 헤더가 대소문자·공백·한글 어떤 형태여도 인식) ──
    const nk = k => String(k).replace(/[\s_\-().]/g, '').toLowerCase();
    function pickKey(rows, patterns, exclude) {
      if (!rows || !rows.length) return null;
      const keys = Object.keys(rows[0] || {});
      for (const pat of patterns) {
        for (const k of keys) {
          const n = nk(k);
          if (exclude && exclude.some(x => n.includes(x))) continue;
          if (pat.test(n)) return k;
        }
      }
      return null;
    }
    let detected = { note: '' };
    function detectCols(rows, kind) {
      const code = pickKey(rows, [/^itemnochk$/, /^itemno$/, /^품번$/, /^품목코드$/, /itemno/, /품번/, /품목코드/, /품목번호/]);
      const name = pickKey(rows, [/^itemname$/, /^품목명$/, /^품명$/, /itemname/, /품목명/, /품명/, /^품목$/]);
      const qty = pickKey(rows, [/^qty$/, /^수량$/, /qty/, /수량/], ['재고', 'stock', 'disposal', '폐기']);
      const unit = pickKey(rows, [/^unitname$/, /^단위$/, /unitname/, /단위/]);
      const amt = pickKey(rows, [/^domamt$/, /^판매금액$/, /^구매금액$/, /^원화금액$/, /domamt/, /판매금액/, /구매금액/, /원화금액/, /금액/], ['부대', 'exp']);
      const price = pickKey(rows, [/^price$/, /^단가$/, /^외화단가$/, /price/, /단가/], ['원화', 'won', 'exrate', '환율', '제조']); // 구매 단가(Price)
      const exrate = pickKey(rows, [/^exrate$/, /^환율$/, /exrate/, /환율/]); // 환율(ExRate)
      const impkind = pickKey(rows, [/^smimpkindname$/, /^smimpkind$/, /^수입구분$/, /smimpkind/, /수입구분/]); // 수입구분(폐기 제외용)
      const date = kind === 'purchase'
        ? pickKey(rows, [/^permitdate$/, /^수입면장일자$/, /^입고일자?$/, /^구매일자?$/, /permitdate/, /면장일/, /입고일/, /구매일/, /발주일/, /^일자$/, /date/])
        : pickKey(rows, [/^billdate$/, /^청구일자$/, /^판매일자$/, /billdate/, /청구일자/, /판매일자/, /발행일/, /^일자$/, /date/]);
      return { code, name, qty, unit, amt, price, exrate, impkind, date, kind };
    }
    // 분기 유틸: 'YYYYMM' → 분기 인덱스 / 라벨
    // 월 유틸: 'YYYYMM' ↔ 월 인덱스
    const mIdx = m => Number(m.slice(0, 4)) * 12 + (Number(m.slice(4, 6)) - 1);
    const mStr = mi => String(Math.floor(mi / 12)) + String(mi % 12 + 1).padStart(2, '0');
    const mLbl = m => m.slice(0, 4) + '년 ' + Number(m.slice(4, 6)) + '월';
    const curMonth = () => { const n = new Date(); return String(n.getFullYear()) + String(n.getMonth() + 1).padStart(2, '0'); };

    // ── 원천 집계: 품목 목록(구매 ∪ 판매, 중복 제거) ──
    let base = { list: [], byCode: Object.create(null) };
    let baseSrc = null; // [purchase, sale] 참조 스냅샷 — 바뀔 때만 재계산
    function ensureBase() {
      const pur = (hub().data && hub().data.purchase) || null;
      const sal = (hub().data && hub().data.sale) || null;
      const mfg = (hub().data && hub().data.mfgcost) || null;
      const syn = (hub().data && hub().data.synth) || null; // ★ 합성 대상 데이터 변경도 감지
      if (baseSrc && baseSrc[0] === pur && baseSrc[1] === sal && baseSrc[2] === mfg && baseSrc[3] === syn) return false;
      baseSrc = [pur, sal, mfg, syn];
      recomputeBase();
      return true;
    }
    function recomputeBase() {
      const pur = (hub().data && hub().data.purchase) || [];
      const sal = (hub().data && hub().data.sale) || [];
      const P = detectCols(pur, 'purchase');
      const S = detectCols(sal, 'sale');
      const byCode = Object.create(null);
      const ent = c => byCode[c] || (byCode[c] = { code: c, name: '', pQty: 0, unit: Object.create(null), months: Object.create(null), src: '' });
      const val = (row, key) => key ? (row[key] == null ? '' : row[key]) : '';
      // 구매 데이터의 품목 (+ 분기별 구매금액/수량 → 기준 판매가 산출용)
      for (const p of pur) {
        const c = String(val(p, P.code)).trim().toUpperCase();
        if (!c) continue;
        // ★ 수입구분이 '폐기'인 행은 제외 (판매가·수량 집계 모두)
        if (String(val(p, P.impkind)).trim() === '폐기') continue;
        const e = ent(c);
        if (!e.name) e.name = String(val(p, P.name)).trim();
        if (!e.asset) e.asset = String(gv(p, ['ASSETNAME', 'AssetName', '자산분류', '자산명'])).trim(); // 자산분류
        const q = num(val(p, P.qty));
        e.pQty += q;
        const u = String(val(p, P.unit)).trim();
        if (u) e.unit[u] = (e.unit[u] || 0) + 1;
        if (e.src.indexOf('구매') < 0) e.src += (e.src ? '·' : '') + '구매';
        const m = String(val(p, P.date)).replace(/[^0-9]/g, '').slice(0, 6);
        const a = num(val(p, P.amt));
        if (m.length === 6 && q !== 0) {
          const mm = e.months[m] || (e.months[m] = { q: 0, a: 0, pw: 0 });
          mm.q += q; mm.a += a;
          const ex = num(val(p, P.exrate)) || 1; // 환율 (없거나 0이면 1 — 원화 거래)
          mm.pw += ex * num(val(p, P.price)) * q; // ★ 판매가 산출용: Σ(ExRate × Price × Qty)
        }
      }
      // 판매 데이터의 품목 (목록 합집합용 — 중복 코드는 병합)
      for (const sr of sal) {
        const c = String(val(sr, S.code)).trim().toUpperCase();
        if (!c) continue;
        const e = ent(c);
        if (!e.name) e.name = String(val(sr, S.name)).trim();
        const u = String(val(sr, S.unit)).trim();
        if (u) e.unit[u] = (e.unit[u] || 0) + 1;
        if (e.src.indexOf('판매') < 0) e.src += (e.src ? '·' : '') + '판매';
      }
      // ── 월별품목별제조원가 인덱스: (품목|YYYYMM) → { q: InQty, proc: ProcPrice, mat: InputMatUnit } ──
      const mfgRows = (hub().data && hub().data.mfgcost) || [];
      const mfgIdx = Object.create(null);   // code → { ym: {q,proc,mat} }
      for (const r of mfgRows) {
        const c = String(gv(r, ['ITEMNO', 'ItemNo', '품번', '품목코드'])).trim().toUpperCase();
        const m = String(gv(r, ['DATE', 'Date', '년월', '월'])).replace(/[^0-9]/g, '').slice(0, 6);
        if (!c || m.length !== 6) continue;
        const rec = (mfgIdx[c] = mfgIdx[c] || Object.create(null));
        const q = num(gv(r, ['INQTY', 'InQty', '입고수량', '수량']));
        rec[m] = { q: q, proc: num(gv(r, ['PROCPRICE', 'ProcPrice', '제조원가'])), mat: num(gv(r, ['INPUTMATUNIT', 'InputMatUnit'])) };
      }
      base.mfgIdx = mfgIdx;
      // 3개월(입고월 직전) InQty 가중평균: field='mat'|'proc' — 예시 엑셀 '월별품목별제조원가 계산' 탭과 동일 (ROUND(Σ값×InQty ÷ ΣInQty))
      base.mfgAvg3 = (code, ym, field) => {
        const rec = mfgIdx[String(code || '').trim().toUpperCase()];
        if (!rec) return null;
        if (!ym || String(ym).length !== 6) ym = curMonth();
        const yi = mIdx(String(ym));
        const win = endI => {
          let q = 0, a = 0;
          for (let k = endI; k > endI - 3; k--) { const mm = rec[mStr(k)]; if (mm && mm.q > 0) { q += mm.q; a += mm[field] * mm.q; } }
          return q > 0 ? Math.round(a / q) : null;
        };
        let v = win(yi - 1);
        if (v == null) { // 직전 3개월에 없으면 이전 마지막 데이터 월 기준 3개월 승계
          const keys = Object.keys(rec).map(mIdx).sort((a, b) => a - b);
          let last = null;
          for (let i = keys.length - 1; i >= 0; i--) { if (keys[i] <= yi - 1) { last = keys[i]; break; } }
          if (last == null && keys.length) last = keys[0];
          if (last != null) v = win(last);
        }
        return v;
      };
      // 참고열 '판매가': 기준월 직전 3개월만 사용(승계 없음) — 데이터 없으면 0
      //   ★ 구매 데이터 기준: ROUND(Σ(ExRate × Price × Qty) ÷ ΣQty) — 원화 환산 수량가중평균
      // 판매가 참고값: 기준월 직전 3개월 수량가중평균.
      //   3개월 내 데이터가 없으면 그 이전의 '마지막 데이터 월' 금액을 승계하고 그 년월(src)을 함께 반환.
      base.avgPrice3Info = (code, ym) => {
        const e = byCode[String(code || '').trim().toUpperCase()];
        if (!e || !e.months) return { v: 0, src: null };
        if (!ym || String(ym).length !== 6) ym = curMonth();
        const yi = mIdx(String(ym));
        let q = 0, w = 0;
        for (let k = yi - 1; k > yi - 4; k--) { const mm = e.months[mStr(k)]; if (mm && mm.q > 0) { q += mm.q; w += mm.pw || 0; } }
        if (q > 0) return { v: Math.round(w / q), src: null }; // 정상(직전 3개월)
        // 승계: 기준월을 포함해 데이터가 있는 가장 최근 월 (첫 입고월은 그 달 자신의 금액을 사용)
        const keys = Object.keys(e.months).filter(m => mIdx(m) <= yi && e.months[m].q > 0).map(mIdx).sort((a, b) => b - a);
        if (!keys.length) return { v: 0, src: null };
        const lm = mStr(keys[0]), mm2 = e.months[lm];
        return { v: Math.round((mm2.pw || 0) / mm2.q), src: lm };
      };
      base.avgPrice3Strict = (code, ym) => base.avgPrice3Info(code, ym).v;
      base.mfgProcAt = (code, ym) => { // 입고월의 ProcPrice (해당 월 없으면 이전 마지막 월)
        const rec = mfgIdx[String(code || '').trim().toUpperCase()];
        if (!rec) return null;
        if (!ym || String(ym).length !== 6) ym = curMonth();
        if (rec[ym]) return rec[ym].proc;
        const keys = Object.keys(rec).map(mIdx).sort((a, b) => a - b);
        const yi = mIdx(String(ym));
        for (let i = keys.length - 1; i >= 0; i--) { if (keys[i] <= yi) return rec[mStr(keys[i])].proc; }
        return null;
      };
      base.mfgMatAt = (code, ym) => { // 입고월의 InputMatUnit(재료비) — 해당 월 없으면 이전 마지막 월 (mfgProcAt 과 동일 규칙)
        const rec = mfgIdx[String(code || '').trim().toUpperCase()];
        if (!rec) return null;
        if (!ym || String(ym).length !== 6) ym = curMonth();
        if (rec[ym]) return rec[ym].mat;
        const keys = Object.keys(rec).map(mIdx).sort((a, b) => a - b);
        const yi = mIdx(String(ym));
        for (let i = keys.length - 1; i >= 0; i--) { if (keys[i] <= yi) return rec[mStr(keys[i])].mat; }
        return null;
      };
      base.synthItems = (() => { // ★ 합성 대상 데이터의 품번 집합 — 판매가(합성)은 이 품번만 적용
        const set = Object.create(null);
        const rows = (hub().data && hub().data.synth) || [];
        for (const r of rows) {
          const c = String(gv(r, ['ITEMNO', 'ItemNo', '품번', '품목코드'])).trim().toUpperCase();
          if (c) set[c] = true;
        }
        return set;
      })();
      const list = Object.values(byCode);
      list.forEach(e => {
        // 월별 기본 판매가(ym): ym 직전 3개월(Σ구매금액 ÷ Σ수량) 가중평균.
        //   그 3개월에 구매가 없으면, 그보다 앞선 마지막 구매월을 끝으로 하는 3개월 평균 (이전 금액 승계).
        const mKeys = Object.keys(e.months).map(mIdx).sort((a, b) => a - b);
        e.baseFor = ym => {
          if (!ym || String(ym).length !== 6) ym = curMonth();
          // ① 월별품목별제조원가 InputMatUnit 의 직전 3개월 수량가중평균 (예시 엑셀 기준)
          const mv = base.mfgAvg3 ? base.mfgAvg3(e.code, ym, 'mat') : null;
          if (mv != null) return { price: mv, label: '월별품목별제조원가 InputMatUnit 직전 3개월 가중평균' };
          if (!mKeys.length) return { price: null, label: '' };
          const yi = mIdx(String(ym));
          const win = (endIdx) => { // endIdx 부터 과거 3개월 합
            let q = 0, a = 0, used = [];
            for (let k = endIdx; k > endIdx - 3; k--) { const mm = e.months[mStr(k)]; if (mm) { q += mm.q; a += mm.a; used.push(mStr(k)); } }
            return q > 0 ? { price: a / q, used: used.sort() } : null;
          };
          let w = win(yi - 1); // 입고월 직전 3개월
          let note = '';
          if (!w) {
            let last = null;
            for (let i = mKeys.length - 1; i >= 0; i--) { if (mKeys[i] <= yi - 1) { last = mKeys[i]; break; } }
            if (last == null) last = mKeys[0]; // 전부 미래(해당 월 이후) 구매뿐이면 가장 이른 구매월 기준
            w = win(last);
            note = ' (이전 구매분 승계)';
          }
          if (!w) return { price: null, label: '' };
          return { price: w.price, label: w.used.map(mLbl).join('·') + ' 구매 평균가' + note };
        };
        const us = Object.entries(e.unit).sort((x, y) => y[1] - x[1]);
        e.unitName = us.length ? us[0][0] : '';
      });
      list.sort((x, y) => y.pQty - x.pQty || x.code.localeCompare(y.code));
      base.list = list;
      base.byCode = byCode; // (mfgIdx/mfgAvg3/mfgProcAt 는 위에서 base 에 이미 세팅됨 — 재할당 금지)
      detected = {
        note: '구매 ' + pur.length.toLocaleString() + '건(품번열 ' + (P.code || '미검출') + ') · 판매 ' + sal.length.toLocaleString() + '건(품번열 ' + (S.code || '미검출') + ')'
      };
    }

    // ── 설정(draft) — alloc.items 를 편집 ──
    let iDraft = { defaultPct: 100, defaultPctSyn: 100, byItem: Object.create(null) };
    function normItems(src) {
      src = src || {};
      const out = { defaultPct: src.defaultPct != null ? Number(src.defaultPct) : 100,
                    defaultPctSyn: src.defaultPctSyn != null ? Number(src.defaultPctSyn) : 100,
                    byItem: {} };
      const bi = src.byItem || {};
      const cpMon = src2 => { const o = {}; const s = src2 || {}; for (const m in s) if (s[m] != null && s[m] !== '') o[m] = Number(s[m]); return o; };
      for (const c in bi) {
        out.byItem[c] = {
          price: bi[c].price != null ? Number(bi[c].price) : null,
          pct: bi[c].pct != null ? Number(bi[c].pct) : null,
          pctSyn: bi[c].pctSyn != null ? Number(bi[c].pctSyn) : null,
          priceByMonth: cpMon(bi[c].priceByMonth),
          sellBuyByMonth: cpMon(bi[c].sellBuyByMonth),   // 판매가(구매) — 월별 금액(원)
          sellSynByMonth: cpMon(bi[c].sellSynByMonth)    // 판매가(합성) — 월별 금액(원)
        };
      }
      return out;
    }
    function seedItemDraft() {
      const n = normItems(alloc.items);
      iDraft = { defaultPct: n.defaultPct, defaultPctSyn: n.defaultPctSyn, byItem: Object.create(null) };
      for (const c in n.byItem) iDraft.byItem[c] = n.byItem[c];
    }
    function itemsDirty() {
      return JSON.stringify(normItems(iDraft)) !== JSON.stringify(normItems(alloc.items));
    }

    // ── 전역 공개: React(구매/판매)에서 실현 수익(구매) 계산에 사용 ──
    function publish(items) {
      const it = items || {};
      const bi = it.byItem || {};
      const dp = it.defaultPct != null ? Number(it.defaultPct) : 100;
      const dpS = it.defaultPctSyn != null ? Number(it.defaultPctSyn) : 100;
      // priceOf/pctOf 는 mfgOf(內 제조원가 계산)에서도 쓰므로 지역 함수로 선언 후 공용 사용
      const priceOfFn = (code, ym) => {
        const c = String(code || '').trim().toUpperCase();
        const rec = bi[c] || {};
        const m = (ym && String(ym).length === 6) ? String(ym) : curMonth();
        const pbm = rec.priceByMonth || {};
        if (pbm[m] != null) return Number(pbm[m]); // 월별 설정 우선
        if (rec.price != null) return Number(rec.price); // (구버전) 공통 설정
        try { ensureBase(); } catch (e) {}
        const b = base.byCode[c];
        if (!b || !b.baseFor) return null;
        const r = b.baseFor(m);
        return r.price != null ? r.price : null;
      };
      const pctOfFn = code => {
        const c = String(code || '').trim().toUpperCase();
        const ov = bi[c] && bi[c].pct != null ? Number(bi[c].pct) : null;
        return ov != null ? ov : dp;
      };
      // 참고 판매가(직전 3개월 가중평균 · 없으면 0)
      const basePriceFn = (code, ym) => {
        try { ensureBase(); } catch (e) {}
        return base.avgPrice3Strict ? base.avgPrice3Strict(code, ym) : 0;
      };
      const isSynthItem = code => {
        try { ensureBase(); } catch (e) {}
        return !!(base.synthItems && base.synthItems[String(code || '').trim().toUpperCase()]);
      };
      // 판매가(구매)/(합성) 유효값 = 기준월에 '저장된 값'만 사용 (미설정 = 0)
      //   ★ 전체 비율(%)은 [전체 일괄 적용]·[조회 내역 적용] 버튼으로 값을 채울 때만 쓰는 입력값이며,
      //     저장된 다른 품목의 값에는 영향을 주지 않습니다.
      //   판매가(합성)은 '합성 대상 데이터'에 있는 품번만 입력·적용 — 그 외는 항상 0
      //   판매가(구매)는 반대로 합성 대상이 아닌 품번만 — 합성 품목은 원자재 구매 내역으로 계산되므로 0
      const sellOfFn = (code, ym, kind) => {
        const c = String(code || '').trim().toUpperCase();
        if (kind === 'syn' && !isSynthItem(c)) return 0;
        if (kind === 'buy' && isSynthItem(c)) return 0;
        const rec = bi[c] || {};
        const m = (ym && String(ym).length === 6) ? String(ym) : curMonth();
        const store = (kind === 'syn' ? rec.sellSynByMonth : rec.sellBuyByMonth) || {};
        return store[m] != null ? Number(store[m]) : 0;
      };
      window.__kjItemAlloc = {
        ready: true,
        defaultPct: dp,
        defaultPctSyn: dpS,
        basePriceOf: basePriceFn,
        basePriceInfo: (code, ym) => { try { ensureBase(); } catch (e) {} return base.avgPrice3Info ? base.avgPrice3Info(code, ym) : { v: 0, src: null }; },
        sellBuyOf: (code, ym) => sellOfFn(code, ym, 'buy'), // 內 단가 = 판매가(구매)
        sellSynOf: (code, ym) => sellOfFn(code, ym, 'syn'), // 內 제조원가 = 판매가(합성)
        mfgOf: (code, ym) => {
          const proc = base.mfgProcAt ? base.mfgProcAt(code, ym) : null;   // 입고월 ProcPrice (제조원가)
          const mat3 = base.mfgAvg3 ? base.mfgAvg3(code, ym, 'mat') : null; // 內 단가 = InputMatUnit 3개월 가중평균
          // 內 제조원가 = 제조원가(입고월 ProcPrice) − 재료비(입고월 InputMatUnit) + 판매가 + 구매팀 이윤(판매가 × 비율(구매)%)
          //   — 예시 엑셀 '내 제조원가 계산': M = D − E + J + (J × K / 100)
          //   판매가 = [배분 비율 설정(품목)] 설정값 우선, 없으면 內 단가(기본값)
          let proc3 = null;
          const matM = base.mfgMatAt ? base.mfgMatAt(code, ym) : null;     // 입고월 InputMatUnit(재료비)
          const selP = priceOfFn(code, ym);
          if (proc != null && matM != null && selP != null) {
            proc3 = proc - matM + selP + selP * pctOfFn(code) / 100;
          }
          return { proc: proc, mat3: mat3, proc3: proc3 };
        },
        pctSynthOf: code => {
          const c = String(code || '').trim().toUpperCase();
          const ov = bi[c] && bi[c].pctSyn != null ? Number(bi[c].pctSyn) : null;
          return ov != null ? ov : dpS;
        },
        priceOf: priceOfFn,
        pctOf: pctOfFn
      };
      window.dispatchEvent(new CustomEvent('kjhub:itemalloc'));
    }
    window.__kjPublishItemAlloc = function (items) {
      try {
        publish(items);
        if (!userEdited) seeded = false; // 편집 전이면 서버 설정으로 입력칸 재시드
        renderItems();
      } catch (e) { console.error('[품목 배분] 갱신 실패:', e); }
    };

    // ── 렌더 ──
    const PAGE_SIZE = 100; // 기본 조회 100개 · '더보기' 100개씩 추가
    let aiLimit = PAGE_SIZE; // 현재 표시 개수 (전체보기 시 Infinity)
    let lastRows = []; // 마지막 조회(필터) 결과
    function renderItems() {
      const body = $a('aiBody');
      if (!body) return;
      seedGuard();
      // 데이터가 준비된 뒤 처음 렌더될 때 목록을 채우고, React(구매/판매)에도 재계산을 알림
      if (ensureBase() && base.list.length) {
        try { window.dispatchEvent(new CustomEvent('kjhub:itemalloc')); } catch (e) {}
      }
      const qNo = String(($a('aiSearchNo') && $a('aiSearchNo').value) || '').trim().toLowerCase();
      const qNm = String(($a('aiSearchName') && $a('aiSearchName').value) || '').trim().toLowerCase();
      let rows = base.list;
      if (qNo) rows = rows.filter(e => e.code.toLowerCase().includes(qNo));
      if (qNm) rows = rows.filter(e => (e.name || '').toLowerCase().includes(qNm));
      // 자산분류 옵션 채우기(1회) + 필터
      const selA = $a('aiSearchAsset');
      if (selA && selA.options.length <= 1 && base.list.length) {
        const set = [];
        base.list.forEach(e => { if (e.asset && set.indexOf(e.asset) < 0) set.push(e.asset); });
        set.sort((a, b) => a.localeCompare(b, 'ko'));
        selA.innerHTML = '<option value="">전체</option>' + set.map(v => '<option value="' + v + '">' + v + '</option>').join('');
      }
      const qA = selA ? selA.value : '';
      if (qA) rows = rows.filter(e => (e.asset || '') === qA);
      // 합성대상 필터 (전체 / 비합성 품목 / 합성 품목)
      const qSyn = String(($a('aiSynthFilter') && $a('aiSynthFilter').value) || '');
      if (qSyn) rows = rows.filter(e => {
        const isS = !!(base.synthItems && base.synthItems[e.code]);
        return qSyn === 'syn' ? isS : !isS;
      });
      // ★ 최초 입고월 이전 기준월에서는 목록에 나오지 않음 (아직 존재하지 않는 품목)
      const yiSel = mIdx(aiSelMonth);
      const firstM = e => {
        if (!e.months) return null;
        const ks = Object.keys(e.months).filter(k => e.months[k].q > 0).map(mIdx).sort((a, b) => a - b);
        return ks.length ? mStr(ks[0]) : null;
      };
      const notYet = rows.filter(e => { const f = firstM(e); return f && mIdx(f) > yiSel; });
      rows = rows.filter(e => { const f = firstM(e); return !f || mIdx(f) <= yiSel; });
      const shown = aiLimit === Infinity ? rows : rows.slice(0, aiLimit);
      lastRows = rows; // '조회 내역 적용' 대상 = 현재 조회(필터) 결과 전체
      const rest = rows.length - shown.length;
      if ($a('aiCount')) $a('aiCount').textContent = '표시 ' + shown.length.toLocaleString() + '개 / 조회 ' + rows.length.toLocaleString() + '개 / 전체 품목 ' + base.list.length.toLocaleString() + '개'
        + (rest > 0 ? ' — ' + rest.toLocaleString() + '개 더 있음' : '')
        + (notYet.length ? ' · 최초 입고월 이후 품목만 표시 (' + notYet.length.toLocaleString() + '개 제외)' : '')
        + (base.list.length === 0 && detected.note ? ' · ' + detected.note : '');
      if ($a('aiMoreWrap')) $a('aiMoreWrap').classList.toggle('hidden', rest <= 0);
      if ($a('aiMoreBtn')) $a('aiMoreBtn').textContent = '더보기 (' + Math.min(PAGE_SIZE, rest).toLocaleString() + '개 · 남은 ' + rest.toLocaleString() + '개)';
      if ($a('aiDefaultPct') && document.activeElement !== $a('aiDefaultPct')) $a('aiDefaultPct').value = iDraft.defaultPct;
      if ($a('aiDefaultPctSyn') && document.activeElement !== $a('aiDefaultPctSyn')) $a('aiDefaultPctSyn').value = iDraft.defaultPctSyn;
      // 기준월(입고월) 옵션: 구매 데이터 존재 월 + 현재월
      const selM = $a('aiMonth');
      if (selM) {
        const cmM = (window.KJHub && window.KJHub.closeMonth) ? window.KJHub.closeMonth() : curMonth();
        let minI = Math.min(mIdx(curMonth()), mIdx(cmM));
        base.list.forEach(e => { for (const m in e.months) { const i = mIdx(m); if (i < minI) minI = i; } });
        const maxI = Math.max(mIdx(curMonth()), mIdx(cmM)); // 마감월이 미래여도 목록에 포함
        const opts = [];
        for (let i = maxI; i >= minI; i--) opts.push(mStr(i)); // 현재월부터 과거로 연속
        const want = opts.join(',');
        if (selM.dataset.opts !== want) {
          selM.dataset.opts = want;
          const keep = aiSelMonth;
          selM.innerHTML = opts.map(m => '<option value="' + m + '">' + mLbl(m) + '</option>').join('');
          aiSelMonth = opts.indexOf(keep) >= 0 ? keep : (opts[0] || curMonth());
          selM.value = aiSelMonth;
        }
      }
      body.innerHTML = shown.map(e => {
        const ov = iDraft.byItem[e.code] || {};
        // 판매가(참고·수정 불가): 기준월 직전 3개월 수량가중평균 — 없으면 마지막 데이터 월 승계(년월 표기)
        const bpi = base.avgPrice3Info ? base.avgPrice3Info(e.code, aiSelMonth) : { v: 0, src: null };
        const bp = bpi.v;
        const pctB = ov.pct != null ? ov.pct : iDraft.defaultPct;
        const pctS = ov.pctSyn != null ? ov.pctSyn : iDraft.defaultPctSyn;
        const buyOv = (ov.sellBuyByMonth && ov.sellBuyByMonth[aiSelMonth] != null) ? ov.sellBuyByMonth[aiSelMonth] : '';
        const synOv = (ov.sellSynByMonth && ov.sellSynByMonth[aiSelMonth] != null) ? ov.sellSynByMonth[aiSelMonth] : '';
        const isSyn = !!(base.synthItems && base.synthItems[e.code]); // 합성 대상 품번 여부
        const buyCell = isSyn
          ? '<span class="text-slate-300" title="합성 대상 품목 — 원자재 구매 내역으로 수익을 계산하므로 판매가(구매) 미적용(0)">0</span>'
          : '<input type="number" step="1" min="0" class="ai-sellbuy w-32 bg-white border border-slate-200 rounded-lg px-2 py-1 text-right text-sm outline-none focus:border-indigo-500" placeholder="0" value="' + buyOv + '" title="' + mLbl(aiSelMonth) + ' 기준 저장값 (미입력 = 0)">';
        // 판매가(합성)은 합성 대상 품번만 입력 가능 (합성팀·소재생산팀 이윤 산출용)
        const synCell = isSyn
          ? '<input type="number" step="1" min="0" class="ai-sellsyn w-32 bg-white border border-slate-200 rounded-lg px-2 py-1 text-right text-sm outline-none focus:border-indigo-500" placeholder="0" value="' + synOv + '" title="' + mLbl(aiSelMonth) + ' 기준 저장값 (미입력 = 0)">'
          : '<span class="text-slate-300" title="합성 대상 데이터에 없는 품번 — 판매가(합성) 미적용(0)">0</span>';
        return '<tr class="border-b border-slate-100 hover:bg-slate-50/60" data-code="' + e.code + '">' +
          '<td class="py-1.5 px-3 font-semibold text-slate-700 whitespace-nowrap">' + e.code + (e.src ? ' <span class="text-[10px] font-medium text-slate-400">' + e.src + '</span>' : '') + '</td>' +
          '<td class="py-1.5 px-3 text-slate-600 truncate" style="max-width:260px" title="' + (e.name || '') + '">' + (e.name || '-') + '</td>' +
          '<td class="py-1.5 px-3 text-slate-500 truncate" style="max-width:160px" title="' + (e.asset || '') + '">' + (e.asset || '-') + '</td>' +
          '<td class="py-1.5 px-3 text-right ' + (bp > 0 ? 'text-slate-600' : 'text-slate-300') + ' bg-slate-50/60" style="font-variant-numeric:tabular-nums" title="' + mLbl(aiSelMonth) + ' 기준 · ROUND(Σ(ExRate×Price×Qty) ÷ ΣQty) · 직전 3개월 · 폐기 제외' + (bpi.src ? ' · 직전 3개월 데이터 없음 → ' + mLbl(bpi.src) + ' 금액 승계' : '') + ' (참고용 · 수정 불가)">' + fmtN(bp)
            + (bpi.src ? ' <span class="text-[10px] font-semibold text-amber-600">(' + mLbl(bpi.src) + ')</span>' : '') + '</td>' +
          '<td class="py-1.5 px-3 text-right">' + buyCell + '</td>' +
          '<td class="py-1.5 px-3 text-right">' + synCell + '</td>' +
          '</tr>';
      }).join('') || '<tr><td colspan="6" class="py-6 text-center text-slate-400 text-sm">' + (base.list.length
        ? '표시할 품목이 없습니다.'
          + (notYet.length
              ? '<br><span class="text-[11px] text-amber-600 font-semibold">'
                + notYet.slice(0, 5).map(e => e.code + ' — 최초 입고 ' + mLbl(firstM(e))).join(' · ')
                + (notYet.length > 5 ? ' 외 ' + (notYet.length - 5) + '건' : '')
                + '</span><br><span class="text-[11px] text-slate-400">기준월(' + mLbl(aiSelMonth) + ')이 최초 입고월 이전이라 조회되지 않습니다.</span>'
              : '')
        : '구매·판매 데이터에서 품목을 찾지 못했습니다.' + (detected.note ? '<br><span class="text-[11px]">' + detected.note + '</span>' : '')) + '</td></tr>';
      body.querySelectorAll('tr[data-code]').forEach(tr => {
        const code = tr.dataset.code;
        const bi2 = tr.querySelector('.ai-sellbuy'), si2 = tr.querySelector('.ai-sellsyn');
        const upd = () => {
          userEdited = true;
          const rec = ensureRec(code);
          const b = (bi2 && bi2.value !== '') ? Number(bi2.value) : null;
          const s2 = (si2 && si2.value !== '') ? Number(si2.value) : null; // 비합성 품번은 입력칸 자체가 없음
          if (b == null) delete rec.sellBuyByMonth[aiSelMonth]; else rec.sellBuyByMonth[aiSelMonth] = b; // 기준월에 저장
          if (s2 == null) delete rec.sellSynByMonth[aiSelMonth]; else rec.sellSynByMonth[aiSelMonth] = s2;
          pruneRec(code);
          syncDirty();
        };
        if (bi2) bi2.addEventListener('input', upd);
        if (si2) si2.addEventListener('input', upd);
      });
      syncDirty();
    }
    let seeded = false;
    let userEdited = false;
    let aiSelMonth = ((window.KJHub && window.KJHub.closeMonth) ? window.KJHub.closeMonth() : curMonth()); // 기준월(입고월) 선택 상태 — 기본값 = 마감월 // 사용자가 이 세션에서 입력을 수정했는지 (서버 로드가 편집 중 초안을 덮지 않도록)
    function seedGuard() { if (!seeded) { seedItemDraft(); seeded = true; } }
    // 품목 설정 레코드 확보 / 빈 레코드 정리
    function ensureRec(code) {
      const rec = iDraft.byItem[code] || (iDraft.byItem[code] = { price: null, pct: null, pctSyn: null, priceByMonth: {}, sellBuyByMonth: {}, sellSynByMonth: {} });
      if (!rec.priceByMonth) rec.priceByMonth = {};
      if (!rec.sellBuyByMonth) rec.sellBuyByMonth = {};
      if (!rec.sellSynByMonth) rec.sellSynByMonth = {};
      return rec;
    }
    function pruneRec(code) {
      const rec = iDraft.byItem[code];
      if (!rec) return;
      const empty = rec.price == null && rec.pct == null && rec.pctSyn == null
        && !Object.keys(rec.priceByMonth || {}).length
        && !Object.keys(rec.sellBuyByMonth || {}).length
        && !Object.keys(rec.sellSynByMonth || {}).length;
      if (empty) delete iDraft.byItem[code];
    }
    function syncDirty() {
      const d = itemsDirty();
      if ($a('aiDirtyBadge')) $a('aiDirtyBadge').classList.toggle('hidden', !d);
      itemsNotify();
    }

    // ── 저장 (groups 보존 + items 저장) ──
    // 저장 payload 의 byItem: 서버 저장본을 기준으로 '선택 기준월' 값만 갈아끼움 → 다른 월 설정은 절대 건드리지 않음
    function buildByItemForSave(scope) {
      if (scope === 'all') return JSON.parse(JSON.stringify(iDraft.byItem)); // 전체 월 저장
      const saved = normItems(alloc.items).byItem;
      const out = {};
      const codes = Object.create(null);
      for (const c in saved) codes[c] = true;
      for (const c in iDraft.byItem) codes[c] = true;
      for (const c in codes) {
        const sv = saved[c] || {};
        const inDraft = Object.prototype.hasOwnProperty.call(iDraft.byItem, c);
        if (!inDraft) { // 이번 세션에서 건드리지 않은 품목 → 저장본을 그대로 보존
          const keep = {
            price: sv.price != null ? sv.price : null,
            pct: sv.pct != null ? sv.pct : null,
            pctSyn: sv.pctSyn != null ? sv.pctSyn : null,
            priceByMonth: Object.assign({}, sv.priceByMonth),
            sellBuyByMonth: Object.assign({}, sv.sellBuyByMonth),
            sellSynByMonth: Object.assign({}, sv.sellSynByMonth)
          };
          const kEmpty = keep.price == null && keep.pct == null && keep.pctSyn == null
            && !Object.keys(keep.priceByMonth).length && !Object.keys(keep.sellBuyByMonth).length && !Object.keys(keep.sellSynByMonth).length;
          if (!kEmpty) out[c] = keep;
          continue;
        }
        const dr = iDraft.byItem[c] || {};
        const rec = {
          price: sv.price != null ? sv.price : null,
          pct: sv.pct != null ? sv.pct : null,
          pctSyn: sv.pctSyn != null ? sv.pctSyn : null,
          priceByMonth: Object.assign({}, sv.priceByMonth),
          sellBuyByMonth: Object.assign({}, sv.sellBuyByMonth),
          sellSynByMonth: Object.assign({}, sv.sellSynByMonth)
        };
        // ★ 기준월 항목만 draft 값으로 대체 (draft 에 없으면 그 달만 삭제)
        const db = (dr.sellBuyByMonth || {})[aiSelMonth];
        const ds = (dr.sellSynByMonth || {})[aiSelMonth];
        if (db != null) rec.sellBuyByMonth[aiSelMonth] = Number(db); else delete rec.sellBuyByMonth[aiSelMonth];
        if (ds != null) rec.sellSynByMonth[aiSelMonth] = Number(ds); else delete rec.sellSynByMonth[aiSelMonth];
        const empty = rec.price == null && rec.pct == null && rec.pctSyn == null
          && !Object.keys(rec.priceByMonth).length && !Object.keys(rec.sellBuyByMonth).length && !Object.keys(rec.sellSynByMonth).length;
        if (!empty) out[c] = rec;
      }
      return out;
    }
    function saveItems(scope) {
      const btn = $a('aiSaveBtn'), msg = $a('aiSaveMsg');
      // ★ 이 탭은 items.byItem 만 전송 — groups·byMat 은 서버가 기존값을 그대로 유지합니다
      const payload = {
        items: { defaultPct: Number(iDraft.defaultPct) || 0, defaultPctSyn: Number(iDraft.defaultPctSyn) || 0, byItem: buildByItemForSave(scope) }
      };
      if (!isAppsScript() || !token()) {
        alloc = Object.assign({}, alloc, { items: payload.items });
        msg.className = 'text-xs font-semibold text-amber-600';
        msg.innerText = '보안 서버 모드가 아니라 이 브라우저에서만 임시 적용되었습니다 (저장 안 됨).';
        seeded = false; userEdited = false; publish(alloc.items); renderItems();
        return;
      }
      btn.disabled = true; btn.innerText = '저장 중...';
      google.script.run.withSuccessHandler(saved => {
        alloc = saved || alloc;
        // 서버가 items 키를 보존하지 않는 경우: 로컬 설정을 유지해 화면 반영은 보장
        const serverKept = !!(saved && saved.items);
        if (!serverKept) alloc.items = payload.items;
        btn.disabled = false; btn.innerText = '저장';
        msg.className = serverKept ? 'text-xs font-semibold text-emerald-600' : 'text-xs font-semibold text-amber-600';
        msg.textContent = serverKept
          ? '저장 완료 (' + new Date().toLocaleString('ko-KR') + ') — [구매 및 판매 내역]의 실현 수익(구매)에 즉시 반영됩니다.'
          : '적용 완료 — 화면에는 즉시 반영되지만, 서버가 품목 설정을 저장하지 않아 재접속 시 초기화됩니다. (Apps Script의 saveAllocation 이 payload.items 를 함께 저장하도록 보완 필요)';
        seeded = false; userEdited = false; publish(alloc.items); renderItems();
      }).withFailureHandler(err => {
        btn.disabled = false; btn.innerText = '저장';
        msg.className = 'text-xs font-semibold text-red-600';
        msg.innerText = '저장 실패: ' + (err && err.message ? err.message : err);
        itemsNotify();
      }).saveAllocation(token(), payload);
    }

    // ── 이벤트 ──
    function initItems() {
      try {
        bindItems();
      } catch (e) {
        console.error('[품목 배분] 초기화 실패:', e);
      }
    }
    function bindItems() {
      if ($a('aiSaveBtn')) $a('aiSaveBtn').addEventListener('click', () => saveItems('month'));
      if ($a('aiRevertBtn')) $a('aiRevertBtn').addEventListener('click', () => { seeded = false; userEdited = false; renderItems(); if ($a('aiSaveMsg')) $a('aiSaveMsg').innerText = ''; });
      const doSearch = () => { aiLimit = PAGE_SIZE; renderItems(); }; // 새 조회는 100개부터
      if ($a('aiMonth')) $a('aiMonth').addEventListener('change', () => { aiSelMonth = $a('aiMonth').value; renderItems(); });
      if ($a('aiSynthFilter')) $a('aiSynthFilter').addEventListener('change', doSearch);
      if ($a('aiSearchAsset')) $a('aiSearchAsset').addEventListener('change', doSearch);
      if ($a('aiMoreBtn')) $a('aiMoreBtn').addEventListener('click', () => { if (aiLimit !== Infinity) aiLimit += PAGE_SIZE; renderItems(); });
      if ($a('aiAllBtn')) $a('aiAllBtn').addEventListener('click', () => { aiLimit = Infinity; renderItems(); });
      // 이전 월 적용: 직전 월에 적용된 판매가(구매)·(합성) 유효값을 현재 기준월로 복사
      // 이전 월 적용: 기준월 이전에 입력된 값 중 '가장 최근 월'의 값을 가져와 적용 + 저장
      if ($a('aiPrevMonthBtn')) $a('aiPrevMonthBtn').addEventListener('click', () => {
        seedGuard();
        try { ensureBase(); } catch (e) {}
        const yi = mIdx(aiSelMonth);
        const latestBefore = map => {
          const ks = Object.keys(map || {}).filter(m => mIdx(m) < yi && map[m] != null).map(mIdx).sort((a, b) => b - a);
          return ks.length ? Number(map[mStr(ks[0])]) : 0;
        };
        let n = 0;
        base.list.forEach(e => {
          const ov = iDraft.byItem[e.code] || {};
          const pb = latestBefore(ov.sellBuyByMonth);
          const ps = latestBefore(ov.sellSynByMonth);
          if (!pb && !ps) return;
          const rec = ensureRec(e.code);
          if (pb) rec.sellBuyByMonth[aiSelMonth] = pb;
          if (ps) rec.sellSynByMonth[aiSelMonth] = ps;
          pruneRec(e.code);
          n++;
        });
        userEdited = true;
        renderItems();
        if ($a('aiSaveMsg')) {
          $a('aiSaveMsg').className = 'text-xs font-semibold text-slate-500';
          $a('aiSaveMsg').innerText = '가장 최근에 입력된 값을 ' + mLbl(aiSelMonth) + '로 복사했습니다 (' + n.toLocaleString() + '개 품목). 저장 중...';
        }
        saveItems('month'); // ★ 적용 후 자동 저장
      });
      if ($a('aiSearchBtn')) $a('aiSearchBtn').addEventListener('click', doSearch);
      if ($a('aiResetBtn')) $a('aiResetBtn').addEventListener('click', () => {
        if ($a('aiSearchNo')) $a('aiSearchNo').value = '';
        if ($a('aiSearchName')) $a('aiSearchName').value = '';
        if ($a('aiSynthFilter')) $a('aiSynthFilter').value = '';
        if ($a('aiSearchAsset')) $a('aiSearchAsset').value = '';
        aiLimit = PAGE_SIZE;
        renderItems();
      });
      ['aiSearchNo', 'aiSearchName'].forEach(id => {
        if ($a(id)) $a(id).addEventListener('keydown', ev => { if (ev.key === 'Enter') doSearch(); });
      });
      if ($a('aiDefaultPct')) $a('aiDefaultPct').addEventListener('input', () => { seedGuard(); userEdited = true; iDraft.defaultPct = Number($a('aiDefaultPct').value) || 0; syncDirty(); });
      if ($a('aiDefaultPctSyn')) $a('aiDefaultPctSyn').addEventListener('input', () => { seedGuard(); userEdited = true; iDraft.defaultPctSyn = Number($a('aiDefaultPctSyn').value) || 0; syncDirty(); });
      // ── 일괄 적용: '선택 기준월'의 판매가(구매)/(합성)만 기본값(판매가 × (1+비율%))으로 채움 ──
      //    다른 월 설정에는 영향 없음. 합성은 '합성 대상 데이터' 품번만 기록(그 외 0 유지).
      // 대상 품목 × 대상 월에 기본값(판매가 × (1+비율%))을 채움
      //   months=[기준월] : 기준월만 / months=전체 : 각 품목의 최초 입고월~현재월 전체
      const applyBulk = (targets, months, label, saveScope) => {
        seedGuard();
        try { ensureBase(); } catch (e) {}
        let n = 0, cells = 0;
        const pctB = Number(iDraft.defaultPct) || 0;   // 입력한 비율(구매)
        const pctS = Number(iDraft.defaultPctSyn) || 0; // 입력한 비율(합성)
        targets.forEach(e => {
          const isS = !!(base.synthItems && base.synthItems[e.code]);
          const rec = ensureRec(e.code);
          const ms = (months === 'all') ? monthsOfItem(e) : months;
          ms.forEach(m => {
            const bp = base.avgPrice3Strict ? base.avgPrice3Strict(e.code, m) : 0;
            // 판매가(구매)는 비합성 품목만, 판매가(합성)은 합성 품목만
            if (!isS) {
              const vb = Math.round(bp * (1 + pctB / 100));
              if (vb) { rec.sellBuyByMonth[m] = vb; cells++; } else delete rec.sellBuyByMonth[m];
              delete rec.sellSynByMonth[m];
            } else {
              const vs = Math.round(bp * (1 + pctS / 100));
              if (vs) { rec.sellSynByMonth[m] = vs; cells++; } else delete rec.sellSynByMonth[m];
              delete rec.sellBuyByMonth[m];
            }
          });
          pruneRec(e.code);
          n++;
        });
        userEdited = true;
        renderItems();
        if ($a('aiSaveMsg')) {
          $a('aiSaveMsg').className = 'text-xs font-semibold text-slate-500';
          $a('aiSaveMsg').innerText = label + ' — 품목 ' + n.toLocaleString() + '개 / 값 ' + cells.toLocaleString() + '건에 기본값(구매 ' + pctB + '% · 합성 ' + pctS + '%)을 적용했습니다. 저장 중...';
        }
        saveItems(saveScope); // ★ 적용 후 자동 저장
      };
      // 품목별 대상 월 목록: 최초 입고월 ~ 현재월
      const monthsOfItem = e => {
        const out = [];
        if (!e.months) return out;
        const ks = Object.keys(e.months).filter(k => e.months[k].q > 0).map(mIdx).sort((a, b) => a - b);
        if (!ks.length) return out;
        for (let i = ks[0]; i <= mIdx(curMonth()); i++) out.push(mStr(i));
        return out;
      };
      window.__kjItemsApply = applyBulk;
      // 기준월 적용: 선택 기준월만 / 전체 일괄 적용: 전체 품목 × 전체 월 / 조회 내역 적용: 조회 결과 × 기준월
      if ($a('aiApplyAllBtn')) $a('aiApplyAllBtn').addEventListener('click', () => applyBulk(base.list, [aiSelMonth], mLbl(aiSelMonth) + ' 기준월 적용', 'month'));
      if ($a('aiApplyEveryBtn')) $a('aiApplyEveryBtn').addEventListener('click', () => {
        window.KJHub.confirm({
          title: '전체 일괄 적용',
          message: '전체 품목의 모든 기준월에 기본값을 적용하고 저장합니다.\n기존에 입력한 값도 덮어씁니다.',
          okText: '적용하고 저장'
        }).then(ok => { if (ok) applyBulk(base.list, 'all', '전체 일괄 적용', 'all'); });
      });
      if ($a('aiApplyViewBtn')) $a('aiApplyViewBtn').addEventListener('click', () => applyBulk(lastRows, [aiSelMonth], '조회 내역 적용(' + mLbl(aiSelMonth) + ')', 'month'));
      window.addEventListener('kjhub:data', () => {
        try { ensureBase(); publish(alloc.items); renderItems(); } catch (e) { console.error('[품목 배분] 데이터 갱신 실패:', e); }
      });
      window.addEventListener('kjhub:login', () => { seeded = false; });
      window.addEventListener('kjhub:closemonth', e => { aiSelMonth = (e.detail && e.detail.month) || aiSelMonth; renderItems(); }); // 마감월 변경 → 기준월 동기화
      ensureBase();
      publish(alloc.items);
      renderItems();
    }

    // ── 새 설정 화면(React) 브리지 ──
    function itemsNotify() { try { window.dispatchEvent(new CustomEvent('kjhub:cfg', { detail: { part: 'items' } })); } catch (e) {} }
    window.KJHub = window.KJHub || {}; window.KJHub.cfg = window.KJHub.cfg || {};
    window.KJHub.cfg.items = {
      month: () => aiSelMonth,
      setMonth(m) { aiSelMonth = m; renderItems(); },
      monthOptions() { try { ensureBase(); } catch (e) {} const cmM = (window.KJHub && window.KJHub.closeMonth) ? window.KJHub.closeMonth() : curMonth(); let minI = Math.min(mIdx(curMonth()), mIdx(cmM)); (base.list || []).forEach(e => { for (const m in e.months) { const i = mIdx(m); if (i < minI) minI = i; } }); const maxI = Math.max(mIdx(curMonth()), mIdx(cmM)); const opts = []; for (let i = maxI; i >= minI; i--) opts.push(mStr(i)); return opts; },
      list() { try { ensureBase(); } catch (e) { return []; } return (base.list || []).map(e => ({ code: e.code, name: e.name || '', asset: e.asset || '', src: e.src || '', unit: e.unitName || '', first: (() => { if (!e.months) return null; const ks = Object.keys(e.months).filter(k => e.months[k].q > 0).map(mIdx).sort((a, b) => a - b); return ks.length ? mStr(ks[0]) : null; })(), isSynth: !!(base.synthItems && base.synthItems[e.code]) })); },
      refPrice: (code, ym) => (base.avgPrice3Info ? base.avgPrice3Info(code, ym || aiSelMonth) : { v: 0, src: null }),
      value(code, kind, ym) { seedGuard(); const r = iDraft.byItem[code]; if (!r) return null; const st = (kind === 'syn' ? r.sellSynByMonth : r.sellBuyByMonth) || {}; const m = ym || aiSelMonth; return st[m] != null ? Number(st[m]) : null; },
      latestBefore(code, kind, ym) { seedGuard(); const r = iDraft.byItem[code]; if (!r) return null; const st = (kind === 'syn' ? r.sellSynByMonth : r.sellBuyByMonth) || {}; const yi = mIdx(ym || aiSelMonth); const ks = Object.keys(st).filter(m => mIdx(m) < yi && st[m] != null).map(mIdx).sort((a, b) => b - a); return ks.length ? { m: mStr(ks[0]), v: Number(st[mStr(ks[0])]) } : null; },
      setValue(code, kind, v) { seedGuard(); userEdited = true; const rec = ensureRec(code); const st = kind === 'syn' ? rec.sellSynByMonth : rec.sellBuyByMonth; if (v == null || v === '') delete st[aiSelMonth]; else st[aiSelMonth] = Number(v); pruneRec(code); syncDirty(); },
      defaultPct: () => ({ buy: Number(iDraft.defaultPct) || 0, syn: Number(iDraft.defaultPctSyn) || 0 }),
      setDefaultPct(kind, v) { seedGuard(); userEdited = true; if (kind === 'syn') iDraft.defaultPctSyn = Number(v) || 0; else iDraft.defaultPct = Number(v) || 0; syncDirty(); },
      dirty: () => { seedGuard(); return itemsDirty(); },
      save: () => saveItems('month'),
      revert() { seeded = false; userEdited = false; renderItems(); },
      applyMonthAll() { if (window.__kjItemsApply) window.__kjItemsApply(base.list, [aiSelMonth], mLbl(aiSelMonth) + ' 기준월 적용', 'month'); },
      applyEvery() { if (window.__kjItemsApply) window.__kjItemsApply(base.list, 'all', '전체 일괄 적용', 'all'); },
      applyView(codes) { const set = Object.create(null); (codes || []).forEach(c => { set[c] = true; }); if (window.__kjItemsApply) window.__kjItemsApply((base.list || []).filter(e => set[e.code]), [aiSelMonth], '조회 내역 적용(' + mLbl(aiSelMonth) + ')', 'month'); },
      prevMonth() { const b = $a('aiPrevMonthBtn'); if (b) b.click(); },
      msg() { const el = $a('aiSaveMsg'); return el ? { text: el.innerText || '', cls: /red/.test(el.className) ? 'neg' : /emerald/.test(el.className) ? 'pos' : '' } : { text: '', cls: '' }; },
      saving: () => { const b = $a('aiSaveBtn'); return !!(b && b.disabled); },
    };
    if (document.readyState === 'loading') __onReady(initItems);else initItems();
  })();
})();
  
}
