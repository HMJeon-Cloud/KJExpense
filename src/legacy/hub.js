// ===== KJ Expense · 공용 셸 (Supabase 판) =====
// 기존 Apps Script 셸(block 4)의 KJHub API 를 그대로 제공하되, 데이터는 Supabase rows 테이블에서 읽습니다.
import { supabase, DATASETS, SUPABASE_URL, SUPABASE_ANON } from '../lib/supabase';

export const KJHub = {
    data: {},
    // { purchase: rows|null, expense, sale, voucher, ... }
    meta: {},
    // { 키: { state: idle|loading|ready|error, note } }
    publish(changedKeys) { publishGated(changedKeys); },
    // ── 화면별 권한: 이 화면에서 볼 수 있는 부서 목록 ──────────────────
    //   반환 null = 제한 없음(전체) / [] = 이 화면 권한 없음 / [부서..] = 그 부서만
    screenDepts(screenTitle) {
      const u = this.user;
      if (!u) return null; // file 모드 등 비로그인 → 제한 없음
      const role = String(u.role || '').toLowerCase();
      if (role === 'admin' || role === 'all' || role === '전체') return null;
      const rules = u.rules && u.rules.length ? u.rules : [{ screens: null, depts: u.depts || [] }];
      const nrm = s => String(s == null ? '' : s).replace(/\s+/g, '').toLowerCase();
      // 화면 이름이 바뀌어도 기존 권한 설정이 계속 동작하도록 옛 이름을 함께 인정
      const ALIAS = {
        '국전 수익/비용': ['사업단위별 수익 및 사용 내역', '사업장별 수익 및 사용 내역'],
        '사업단위 수익/비용': ['사업단위 수익 및 사용 내역'],
        '부서별 수익/비용': ['부서별 수익 및 사용 내역', '부서별 마진 및 사용 내역'],
        '부서별 비용': ['부서별 사용 내역'],
        '구매/판매 내역': ['구매 및 판매 내역']
      };
      const keys = new Set();
      keys.add(nrm(screenTitle || ''));
      (ALIAS[screenTitle] || []).forEach(a => keys.add(nrm(a)));
      for (const k0 in ALIAS) { if (ALIAS[k0].some(a => nrm(a) === nrm(screenTitle || ''))) keys.add(nrm(k0)); }
      const sk = nrm(screenTitle || '');
      const seen = new Set();
      const out = [];
      for (const rl of rules) {
        const applies = !sk ? true : (!rl.screens ? true : (rl.screens || []).some(s => keys.has(nrm(s))));
        if (!applies) continue;
        for (const d of rl.depts || []) {
          const k = nrm(d);
          if (k && !seen.has(k)) { seen.add(k); out.push(d); }
        }
      }
      return this.__expandBizUnits(out); // 항목이 본부명(BizUnitName)이면 소속 부서로 확장
    },
    // 허용부서 전개: 본부명(BizUnitName) → 부서 마스터 기준 소속 전 부서 (서버 확장 규칙과 동일)
    __expandBizUnits(list) {
      const rows = this.data && this.data.dept;
      if (!Array.isArray(rows) || !rows.length || !list.length) return list;
      const nrm = s => String(s == null ? '' : s).replace(/\s+/g, '').toLowerCase();
      const byBiz = Object.create(null);
      const deptSet = new Set();
      for (const r of rows) {
        const biz = nrm(r['BizUnitName']);
        const dn = String(r['DeptName'] || '').trim();
        if (dn) deptSet.add(nrm(dn));
        if (biz && dn) (byBiz[biz] = byBiz[biz] || []).push(dn);
      }
      const out = [];
      const seen = new Set();
      const push = d => { const k = nrm(d); if (k && !seen.has(k)) { seen.add(k); out.push(d); } };
      for (const t0 of list) {
        const t = String(t0 || '').trim();
        if (!t) continue;
        const k = nrm(t);
        if (t.endsWith('*') || deptSet.has(k)) { push(t); continue; }
        if (byBiz[k]) { byBiz[k].forEach(push); continue; }
        push(t);
      }
      return out;
    },
    // 화면 기준으로 좁혀진 행 반환 (데이터셋별 부서 컬럼 기준, 결과 캐시)
    rowsFor(key, screenTitle) {
      const rows = this.data[key];
      if (!Array.isArray(rows)) return rows;
      const allow = this.screenDepts(screenTitle);
      if (allow == null) return rows; // 제한 없음
      const DCOLS = { voucher: ['CostCCtrName', '코스트센터', '부서'], purchase: ['DEPTNAME', '부서'], sale: ['DEPTNAME', '부서'], expense: ['DEPTNAME', '부서'] };
      const cols = DCOLS[key];
      if (!cols) return rows; // 참조 데이터(dept 등)는 그대로
      const ck = '__sf_' + key + '_' + (screenTitle || '') + '_' + allow.join('|');
      this.__sfCache = this.__sfCache || {};
      const hit = this.__sfCache[ck];
      if (hit && hit.src === rows) return hit.out;
      const nrm = s => String(s == null ? '' : s).replace(/\s+/g, '').toLowerCase();
      const exact = new Set();
      const prefixes = [];
      for (const d of allow) {
        const t = nrm(d);
        if (!t) continue;
        if (t.endsWith('*')) prefixes.push(t.slice(0, -1));
        else exact.add(t);
      }
      const out = allow.length === 0 ? [] : rows.filter(r => {
        for (const c of cols) {
          const v = nrm(r[c]);
          if (!v) continue;
          if (exact.has(v)) return true;
          for (const p of prefixes) if (p && v.indexOf(p) === 0) return true;
        }
        return false;
      });
      this.__sfCache[ck] = { src: rows, out: out };
      return out;
    },
  };
  Object.keys(DATASETS).forEach(k => {
    KJHub.data[k] = null;
    KJHub.meta[k] = {
      state: 'idle',
      note: ''
    };
  });
  // ===== 공용 확인 모달 =========================================
  //   브라우저 기본 confirm 대신 화면 톤에 맞춘 모달을 사용합니다.
  KJHub.confirm = function (opts) {
    const o = typeof opts === 'string' ? { message: opts } : (opts || {});
    return new Promise(resolve => {
      const ov = document.createElement('div');
      ov.className = 'fixed inset-0 z-50 flex items-center justify-center px-4';
      ov.setAttribute('style', 'background:rgba(15,23,42,.45)');
      ov.innerHTML = '<div class="bg-white rounded-xl shadow-xl border border-slate-200" style="width:100%;max-width:400px;overflow:hidden">'
        + '<div style="padding:22px 22px 16px 22px;display:flex;align-items:flex-start;gap:12px">'
        + '<span style="flex:0 0 auto;width:32px;height:32px;border-radius:8px;display:flex;align-items:center;justify-content:center;background:#fffbeb;color:#b45309"><i data-lucide="alert-triangle" style="width:17px;height:17px"></i></span>'
        + '<div style="min-width:0;padding-top:2px">'
        + '<h4 style="font-size:13.5px;font-weight:700;color:#1e293b;margin:0 0 6px 0;line-height:1.4">' + (o.title || '확인') + '</h4>'
        + '<p style="font-size:12px;color:#64748b;margin:0;line-height:1.75;white-space:pre-line">' + (o.message || '') + '</p>'
        + '</div></div>'
        + '<div style="padding:12px 22px 18px 22px;display:flex;align-items:center;justify-content:flex-end;gap:8px;border-top:1px solid #f1f5f9;background:#fafbfc">'
        + '<button data-act="cancel" style="font-size:12px;font-weight:600;color:#475569;background:#fff;border:1px solid #cbd5e1;padding:7px 16px;border-radius:8px;cursor:pointer">' + (o.cancelText || '취소') + '</button>'
        + '<button data-act="ok" style="font-size:12px;font-weight:600;color:#fff;background:#1e293b;border:1px solid #1e293b;padding:7px 16px;border-radius:8px;cursor:pointer">' + (o.okText || '계속') + '</button>'
        + '</div></div>';
      const done = v => { try { document.body.removeChild(ov); } catch (e) {} document.removeEventListener('keydown', onKey); resolve(v); };
      const onKey = e => { if (e.key === 'Escape') done(false); if (e.key === 'Enter') done(true); };
      ov.addEventListener('click', e => {
        if (e.target === ov) return done(false);
        const b = e.target.closest('button');
        if (b) done(b.dataset.act === 'ok');
      });
      document.addEventListener('keydown', onKey);
      document.body.appendChild(ov);
      if (window.lucide && window.lucide.createIcons) window.lucide.createIcons();
      const okb = ov.querySelector('[data-act="ok"]');
      if (okb) okb.focus();
    });
  };

Object.keys(DATASETS).forEach(k => { KJHub.data[k] = null; KJHub.meta[k] = { state: 'idle', note: '' }; });
window.KJHub = KJHub;

// ── 마감월 ─────────────────────────────────────────────
let closeMonth = '';
const curYm = () => { const d = new Date(); return d.getFullYear() + ('0' + (d.getMonth() + 1)).slice(-2); };
KJHub.closeMonth = () => closeMonth || curYm();
KJHub.closeMonthEnd = () => { const m = KJHub.closeMonth(); const y = +m.slice(0, 4), mo = +m.slice(4, 6); const last = new Date(y, mo, 0).getDate(); return y + '-' + ('0' + mo).slice(-2) + '-' + ('0' + last).slice(-2); };
KJHub.setCloseMonth = (v, opts) => {
  v = String(v || '').replace(/[^0-9]/g, '').slice(0, 6);
  if (!/^[0-9]{6}$/.test(v)) return;
  const changed = v !== closeMonth; closeMonth = v;
  if (changed || (opts && opts.force)) { try { window.dispatchEvent(new CustomEvent('kjhub:closemonth', { detail: { month: v } })); } catch (e) {} }
};

// ── 화면별 계산 게이트 ───────────────────────────────────
//  기존 화면 모듈들은 'kjhub:data' 가 오면 전부 다시 계산한다(한 번에 20~30초).
//  → 모듈 초기화 중에 등록되는 'kjhub:data' 리스너를 모듈별로 가로채 두고,
//    데이터가 바뀌면 "지금 보이는 화면의 모듈"만 즉시 계산, 나머지는 dirty 표시 후 그 화면을 열 때 계산.
export const MODULE_SCREENS = {
  deptCost: ['dept-cost'], matInput: ['mat-input'], trade: ['purchase-sales'], mats: ['alloc-mats'],
  support: ['support'], deptSupport: ['dept-support'], lotStock: ['lot-stock'],
  profit: ['margin-alloc', 'bu-margin', 'bu-margin-my', 'bu-margin-real', 'alloc-settings', 'alloc-items'],
};
const moduleListeners = Object.create(null); // module -> [fn]
const dirty = Object.create(null);           // module -> true
let curModule = null;
const GATED = new Set(['kjhub:data', 'kjhub:results']);
const ALWAYS = new Set(['trade']); // 구매/판매 결과(results)를 수익 화면들이 쓰므로 항상 계산
const _add = window.addEventListener.bind(window), _remove = window.removeEventListener.bind(window);
window.addEventListener = function (type, fn, opts) {
  if (GATED.has(type) && typeof fn === 'function') {
    const m = curModule || 'trade'; // 초기화 밖(React effect 등)에서 등록되는 것은 구매/판매 모듈
    (moduleListeners[m] = moduleListeners[m] || []).push({ type, fn });
    return;
  }
  return _add(type, fn, opts);
};
window.removeEventListener = function (type, fn, opts) {
  if (GATED.has(type)) { for (const m in moduleListeners) moduleListeners[m] = moduleListeners[m].filter(l => l.fn !== fn); return; }
  return _remove(type, fn, opts);
};
export function beginModule(name) { curModule = name; }
export function endModule() { curModule = null; }
function moduleOfScreen(id) { for (const m in MODULE_SCREENS) if (MODULE_SCREENS[m].includes(id)) return m; return null; }
function runModule(m, why, onlyType) {
  const fns = (moduleListeners[m] || []).filter(l => !onlyType || l.type === onlyType);
  if (!fns.length) { dirty[m] = false; return; }
  const t0 = performance.now();
  const evs = { 'kjhub:data': new CustomEvent('kjhub:data', { detail: { data: KJHub.data } }), 'kjhub:results': new CustomEvent('kjhub:results') };
  const seen = new Set();
  fns.slice().forEach(l => { if (seen.has(l.fn)) return; seen.add(l.fn); try { l.fn.call(window, evs[l.type]); } catch (e) { console.error('[KJHub] ' + m + ' 계산 오류', e); } });
  dirty[m] = false;
  console.log('[KJHub] 화면 계산 ' + m + ' (' + why + ') ' + Math.round(performance.now() - t0) + 'ms');
}
function publishGated(changedKeys) {
  const keys = changedKeys || Object.keys(KJHub.data);
  const activeM = moduleOfScreen(activeScreen);
  for (const m in MODULE_SCREENS) {
    const screens = MODULE_SCREENS[m];
    const needs = new Set(screens.flatMap(sc => SCREEN_DATASETS[sc] || []));
    if (!keys.some(k => needs.has(k))) continue; // 이 모듈과 무관한 데이터
    if (ALWAYS.has(m) && !KJHub.resultsFromDb) { runModule(m, '데이터 ' + keys.join(','), 'kjhub:data'); continue; }
    if (m === activeM) {
      const activeNeeds = SCREEN_DATASETS[activeScreen] || [];
      if (keys.some(k => activeNeeds.includes(k))) runModule(m, '데이터 ' + keys.join(','), 'kjhub:data');
      else dirty[m] = true;
    } else dirty[m] = true;
  }
}
// 구매/판매 모듈이 보내는 'kjhub:results' 도 같은 규칙으로 (보이는 화면만 즉시, 나머지는 dirty)
let resultsTimer = null;
const _dispatch = window.dispatchEvent.bind(window);
window.dispatchEvent = function (ev) {
  if (ev && ev.type === 'kjhub:results') {
    clearTimeout(resultsTimer);
    resultsTimer = setTimeout(() => {
      const activeM = moduleOfScreen(activeScreen);
      for (const m in MODULE_SCREENS) {
        if (!(moduleListeners[m] || []).some(l => l.type === 'kjhub:results')) continue;
        if (m === activeM) runModule(m, 'results', 'kjhub:results'); else dirty[m] = true;
      }
    }, 400); // 연속으로 오는 results 는 한 번으로 합침
    return true;
  }
  return _dispatch(ev);
};

// ── 화면 전환 (React 라우터가 호출) ─────────────────────
let activeScreen = null;
let navHook = null; // (screenId) => void  — React 쪽 라우팅
export function setNavHook(fn) { navHook = fn; }
const SCROLL_POS = Object.create(null);
KJHub.showScreen = function (id, opts) {
  const o = opts || {};
  const prev = activeScreen;
  if (prev && prev !== id) SCROLL_POS[prev] = window.scrollY || 0;
  activeScreen = id;
  document.querySelectorAll('section.hub-screen').forEach(el => el.classList.toggle('hidden', el.id !== 'screen-' + id));
  const m = moduleOfScreen(id);
  if (m && dirty[m]) setTimeout(() => runModule(m, '화면 열림'), 30); // 미뤄둔 계산을 이 화면 것만 수행
  const y = SCROLL_POS[id] || 0;
  requestAnimationFrame(() => window.scrollTo(0, y));
  if (!o.fromRouter && navHook) navHook(id);
};
KJHub.activeScreen = () => activeScreen;
KJHub.runModuleNow = (m, why) => runModule(m, why || '요청', 'kjhub:data'); // 검증 화면: 구매/판매 계산을 지금 수행
// 설정(지원 내역 등)이 바뀌었을 때 모듈을 다시 계산 — 보이는 화면이면 바로(합쳐서 1회), 아니면 그 화면을 열 때
const refreshTimers = Object.create(null);
KJHub.refreshModule = function (m, why) {
  if (moduleOfScreen(activeScreen) !== m) { dirty[m] = true; return; }
  clearTimeout(refreshTimers[m]);
  refreshTimers[m] = setTimeout(() => runModule(m, why || '설정 변경', 'kjhub:results'), 300);
};

// ── 사용자 ─────────────────────────────────────────────
// 신 권한 모델(employees.screen_depts: {경로: [부서]}) → 구 규칙([{screens:[제목], depts}])
const PATH_TITLE = {
  '/bu': '국전 수익/비용', '/bu-real': '국전 수익/비용(실현 수익)', '/bu-unit': '사업단위 수익/비용', '/dept': '부서별 수익/비용',
  '/dept-cost': '부서별 비용', '/dept-support': '부서별 지원 내역', '/trade': '구매/판매 내역', '/matinput': '실자재 투입 내역', '/stock': 'Lot별 재고조회',
};
export function setUser(emp) {
  if (!emp) { KJHub.user = null; return; }
  const sd = emp.screen_depts || {};
  const rules = Object.keys(sd).map(p => ({ screens: [PATH_TITLE[p] || p], depts: sd[p] || [] }));
  KJHub.user = { email: emp.login_id, name: emp.name, role: emp.role, depts: [], rules: rules.length ? rules : [{ screens: null, depts: [] }] };
  KJHub.getToken = () => 'supabase';
  try { window.dispatchEvent(new CustomEvent('kjhub:login')); } catch (e) {}
}

// ── 데이터 로딩 (Supabase rows) ─────────────────────────
const LOADING = {};
const listeners = new Set();
export function onMeta(fn) { listeners.add(fn); return () => { listeners.delete(fn); }; }
function setMeta(key, state, note) { KJHub.meta[key] = { state, note: note || '' }; listeners.forEach(f => f(KJHub.meta)); }

// ── 브라우저 캐시(IndexedDB): 업로드 버전이 같으면 다시 내려받지 않음 (무료 플랜 전송량 절약) ──
const DB_NAME = 'kjhub-cache', STORE = 'datasets';
function idb() {
  return new Promise((res, rej) => {
    try {
      const r = indexedDB.open(DB_NAME, 1);
      r.onupgradeneeded = () => { r.result.createObjectStore(STORE); };
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    } catch (e) { rej(e); }
  });
}
async function cacheGet(key) { try { const db = await idb(); return await new Promise((res, rej) => { const t = db.transaction(STORE, 'readonly').objectStore(STORE).get(key); t.onsuccess = () => res(t.result || null); t.onerror = () => rej(t.error); }); } catch (e) { return null; } }
async function cachePut(key, val) { try { const db = await idb(); await new Promise((res, rej) => { const t = db.transaction(STORE, 'readwrite').objectStore(STORE).put(val, key); t.onsuccess = () => res(); t.onerror = () => rej(t.error); }); } catch (e) { /* 캐시 실패는 무시 */ } }
export async function cacheClear() { try { const db = await idb(); await new Promise((res) => { const t = db.transaction(STORE, 'readwrite').objectStore(STORE).clear(); t.onsuccess = () => res(); t.onerror = () => res(); }); } catch (e) {} }

let versions = null; // { dataset: { ver, cnt } }
async function fetchVersions() {
  const { data, error } = await supabase.rpc('dataset_versions');
  if (error) { console.warn('dataset_versions 실패(0003 SQL 미실행?):', error.message); return {}; }
  const m = {}; (data || []).forEach(r => { m[r.dataset] = { ver: r.ver, cnt: Number(r.cnt) }; });
  return m;
}
// 데이터셋을 JSON "문자열" 그대로 받아 캐시에 저장 (객체를 IndexedDB 에 넣으면 복제 비용이 커서 화면이 멈춤)
// {cols, rows} → 원래 행 객체 (null 값은 키 자체를 넣지 않음 — 업로드 원본과 같은 모양)
export function expandCompact(obj) {
  if (!obj || !Array.isArray(obj.cols) || !Array.isArray(obj.rows)) return Array.isArray(obj) ? obj : [];
  const cols = obj.cols, n = cols.length, out = new Array(obj.rows.length);
  for (let i = 0; i < obj.rows.length; i++) {
    const r = obj.rows[i], o = {};
    for (let j = 0; j < n; j++) { const v = r[j]; if (v !== null && v !== undefined) o[cols[j]] = v; }
    out[i] = o;
  }
  return out;
}
function parseRowsText(text) { const v = JSON.parse(text); return Array.isArray(v) ? v : expandCompact(v); }
const NO_COMPACT = { v: false }; // 0005 SQL 이 없으면 한 번 실패 후 예전 방식으로 고정
async function fetchDatasetText(key) {
  if (!NO_COMPACT.v) {
    try { return await rpcText('dataset_rows_compact', { p_dataset: key }); }
    catch (e) { NO_COMPACT.v = true; console.warn('[KJHub] 압축 전송(0005 SQL) 없음 → 예전 방식:', e.message); }
  }
  return fetchDatasetTextFull(key);
}
async function fetchDatasetTextFull(key) {
  const { data: { session } } = await supabase.auth.getSession();
  const res = await fetch(SUPABASE_URL + '/rest/v1/rpc/dataset_rows', {
    method: 'POST', headers: { apikey: SUPABASE_ANON, Authorization: 'Bearer ' + (session ? session.access_token : SUPABASE_ANON), 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_dataset: key }),
  });
  if (!res.ok) throw new Error('dataset_rows HTTP ' + res.status + ' (0003 SQL 실행 여부 확인)');
  return await res.text();
}
// ── B단계: 전표는 DB 집계 + 필요한 달 범위의 원본만 ─────────────────
//   · voucher_agg(): 부서×월×계정 합계 (전체 기간) → KJHub.agg.voucher
//   · voucher_rows_range(from, to): 마감월 기준 최근 N개월 원본 (전표 상세·키워드)
//   0004 SQL 이 아직 없으면 예전 방식(전체 원본)으로 자동 복귀합니다.
KJHub.agg = KJHub.agg || {};
export const VOUCHER_WINDOW = 13; // 마감월 포함 13개월 (화면 최대 12개월 + 전월 비교)
function voucherRange() {
  const end = KJHub.closeMonth();
  let y = +end.slice(0, 4), m = +end.slice(4, 6) - (VOUCHER_WINDOW - 1);
  while (m < 1) { m += 12; y--; }
  return { from: y + ('0' + m).slice(-2), to: '999912' }; // 마감월 이후 달도 포함 (업로드 직후 확인용)
}
KJHub.voucherRange = voucherRange;
// 13개월보다 이전 달을 볼 때: 그 범위의 전표 원본을 추가로 받아 붙임 (전표 상세·키워드용)
let extraFrom = null; // 지금까지 추가로 받은 가장 이른 달
KJHub.ensureVoucherFrom = async function (ym) {
  ym = String(ym || '').slice(0, 6);
  const base = voucherRange().from;
  const have = extraFrom || base;
  if (!/^[0-9]{6}$/.test(ym) || ym >= have || !Array.isArray(KJHub.data.voucher)) return false;
  let y = +have.slice(0, 4), m = +have.slice(4, 6) - 1; if (m < 1) { m = 12; y--; }
  const to = y + ('0' + m).slice(-2);
  const t0 = performance.now();
  let text;
  try { text = await rpcText(NO_COMPACT.v ? 'voucher_rows_range' : 'voucher_rows_range_compact', { p_from: ym, p_to: to }); }
  catch (e) { text = await rpcText('voucher_rows_range', { p_from: ym, p_to: to }); }
  const more = parseRowsText(text);
  KJHub.data.voucher = more.concat(KJHub.data.voucher);
  extraFrom = ym;
  console.log('[KJHub] 전표 추가 ' + ym + '~' + to + ' ' + more.length + '건 ' + Math.round(performance.now() - t0) + 'ms');
  publishGated(['voucher']);
  try { window.dispatchEvent(new CustomEvent('kjhub:data', { detail: { data: KJHub.data } })); } catch (e) {}
  return true;
};
async function rpcText(name, body) {
  const { data: { session } } = await supabase.auth.getSession();
  const res = await fetch(SUPABASE_URL + '/rest/v1/rpc/' + name, {
    method: 'POST', headers: { apikey: SUPABASE_ANON, Authorization: 'Bearer ' + (session ? session.access_token : SUPABASE_ANON), 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
  if (!res.ok) throw new Error(name + ' HTTP ' + res.status);
  return await res.text();
}
let _cmResolve = null; const closeMonthReady = new Promise(r => { _cmResolve = r; });
async function fetchVoucherText(ver) {
  await Promise.race([closeMonthReady, sleep(4000)]); // 마감월을 먼저 알아야 범위가 정확함
  const r = voucherRange();
  const ck = 'voucher@' + r.from;
  const cached = await cacheGet(ck);
  if (cached && ver && cached.ver === ver.ver && typeof cached.text === 'string' && typeof cached.agg === 'string') return { text: cached.text, agg: cached.agg, src: '캐시' };
  const rangeText = async () => {
    if (!NO_COMPACT.v) { try { return await rpcText('voucher_rows_range_compact', { p_from: r.from, p_to: r.to }); } catch (e) { NO_COMPACT.v = true; } }
    return rpcText('voucher_rows_range', { p_from: r.from, p_to: r.to });
  };
  const [agg, text] = await Promise.all([rpcText('voucher_agg'), rangeText()]);
  if (ver) cachePut(ck, { ver: ver.ver, text, agg });
  return { text, agg, src: '서버' };
}
async function fetchDatasetPaged(key) {
  const PAGE = 1000; let from = 0; const out = [];
  for (;;) {
    const { data, error } = await supabase.from('rows').select('data').eq('dataset', key).order('id').range(from, from + PAGE - 1);
    if (error) throw error;
    for (const r of data) out.push(r.data);
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return out;
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
export async function loadKeys(keys, force) {
  const need = (keys || []).filter(k => DATASETS[k] && (force || !KJHub.data[k]) && !LOADING[k]);
  if (!need.length) return;
  if (!versions || force) versions = await fetchVersions();
  need.forEach(k => { LOADING[k] = true; setMeta(k, 'loading'); });
  // 1) 네트워크는 병렬, 2) JSON 파싱은 순차(화면 멈춤 최소화), 3) 화면 갱신(publish)은 마지막에 한 번
  const tFetch = performance.now();
  // 동시 요청은 2개까지 (무료 플랜 DB 에서 한꺼번에 보내면 시간 제한에 걸림)
  const queue = need.slice(); const texts = [];
  const worker = async () => { while (queue.length) texts.push(await fetchOne(queue.shift())); };
  const fetchOne = async k => {
    try {
      const v = versions[k];
      if (v && v.cnt === 0) return { k, text: '[]', src: '없음' };
      if (k === 'voucher') {
        try { const r = await fetchVoucherText(force ? null : v); return { k, text: r.text, agg: r.agg, src: r.src + '·DB집계' }; }
        catch (e) { console.warn('[KJHub] voucher DB 집계 실패(0004 SQL 미실행?) → 전체 원본 방식:', e.message); }
      }
      const cached = force ? null : await cacheGet(k);
      if (cached && v && cached.ver === v.ver && typeof cached.text === 'string') return { k, text: cached.text, src: '캐시' };
      try {
        const t1 = performance.now();
        const text = await fetchDatasetText(k);
        console.log('[KJHub] 받기 ' + k + ' ' + Math.round(performance.now() - t1) + 'ms, ' + Math.round(text.length / 1024) + 'KB' + (NO_COMPACT.v ? '' : ' (압축형)'));
        if (v) cachePut(k, { ver: v.ver, text }); // 문자열 저장 — 복제 비용 거의 없음
        return { k, text, src: '서버' };
      } catch (e) {
        console.warn('[KJHub] ' + k + ' 단일 요청 실패 → 페이지 방식:', e.message);
        try { return { k, rows: await fetchDatasetPaged(k), src: '서버(페이지)' }; }
        catch (e2) { await sleep(1500); return { k, rows: await fetchDatasetPaged(k), src: '서버(페이지·재시도)' }; }
      }
    } catch (e) { return { k, err: e }; }
  };
  await Promise.all([worker(), worker()]);
  console.log('[KJHub] 수신 ' + need.join(',') + ' ' + Math.round(performance.now() - tFetch) + 'ms');
  for (const t of texts) {
    try {
      if (t.err) throw t.err;
      const tp = performance.now();
      const rows = t.rows || parseRowsText(t.text);
      console.log('[KJHub] 파싱 ' + t.k + ' ' + Math.round(performance.now() - tp) + 'ms, ' + Math.round((t.text || '').length / 1024) + 'KB');
      KJHub.data[t.k] = Array.isArray(rows) ? rows : [];
      if (t.k === 'voucher') { // DB 집계가 함께 왔으면 보관, 아니면(예전 방식) 집계 없음 → 화면 코드가 원본으로 계산
        try { KJHub.agg.voucher = t.agg ? JSON.parse(t.agg) : null; } catch (e) { KJHub.agg.voucher = null; }
        if (KJHub.agg.voucher) console.log('[KJHub] voucher DB 집계 ' + KJHub.agg.voucher.length + '행 · 원본 ' + KJHub.data[t.k].length + '건(' + voucherRange().from + '~)');
      }
      setMeta(t.k, 'ready', KJHub.data[t.k].length.toLocaleString('ko-KR') + '건 · ' + t.src);
      console.log('[KJHub] ' + t.k + ' ' + KJHub.data[t.k].length + '건 (' + t.src + ')');
    } catch (e) { console.error('[KJHub] ' + t.k + ' 로딩 실패', e); setMeta(t.k, 'error', e.message || String(e)); }
    finally { LOADING[t.k] = false; }
    await sleep(0); // 파싱 사이에 화면이 숨 쉴 틈
  }
  KJHub.publish(need);
}
export const loadAll = force => loadKeys(Object.keys(DATASETS), force);

// 화면별 필요 데이터 (기존 셸의 SCREENS.datasets 와 동일)
const TRADE_SETS = ['purchase', 'expense', 'sale'];
export const SCREEN_DATASETS = {
  'bu-margin': ['voucher', 'dept', 'headcount'],          // 수익은 DB 집계(results) — DB 집계가 없을 때만 구매/판매 데이터를 더 받음
  'bu-margin-real': ['voucher', 'dept', 'headcount'],
  'bu-margin-my': ['voucher', 'dept', 'headcount'],
  'margin-alloc': ['voucher', 'dept', 'headcount'],
  'purchase-sales': ['purchase', 'expense', 'sale', 'synth', 'mfgcost', 'matinput'],
  'mat-input': ['matinput', 'synth', 'purchase'],
  'dept-cost': ['voucher'],
  'dept-support': ['dept', 'headcount'],
  'lot-stock': ['stock'],
  'alloc-settings': ['purchase', 'expense', 'sale', 'voucher', 'dept'],
  'alloc-items': ['purchase', 'sale', 'mfgcost', 'synth'],
  'alloc-mats': ['purchase', 'matinput'],
  'support': ['dept', 'headcount'],
};
// 보고 있는 화면 것부터 받고, 나머지는 잠시 뒤 한 번에 (계산 횟수를 줄이기 위해 묶어서)
let bgTimer = null;
const PROFIT_SCREENS = new Set(['bu-margin', 'bu-margin-real', 'bu-margin-my', 'margin-alloc', 'alloc-settings']);
export async function loadForScreen(screenId) {
  let first = (SCREEN_DATASETS[screenId] || []).slice();
  if (PROFIT_SCREENS.has(screenId)) {
    if (!KJHub.resultsFromDb) await loadResults('첫 화면');
    if (!KJHub.resultsFromDb) first = first.concat(TRADE_SETS, screenId === 'bu-margin-real' ? ['synth', 'mfgcost', 'matinput'] : []); // DB 집계 없음 → 예전 방식
  }
  await loadKeys(first);
  clearTimeout(bgTimer);
  const rest = Object.keys(DATASETS).filter(k => !KJHub.data[k] && !LOADING[k]);
  if (rest.length) bgTimer = setTimeout(() => loadKeys(rest), 800);
}

// ── B단계 2차: 수익 집계(사업단위·부서별 월 수익, 이윤 9종)를 DB에서 받기 ──
//   0006·0007 SQL 이 있으면 구매/판매 데이터 없이도 국전·부서별 화면이 뜹니다. 없으면 예전처럼 브라우저 계산.
KJHub.resultsFromDb = false;
let resultsLoading = null;
export async function loadResults(why) {
  if (resultsLoading) return resultsLoading;
  resultsLoading = (async () => {
    const t0 = performance.now();
    try {
      const [a, b] = await Promise.all([supabase.rpc('trade_profit_groups'), supabase.rpc('trade_monthly_margin')]);
      if (a.error) throw new Error(a.error.message); if (b.error) throw new Error(b.error.message);
      const m = b.data || {};
      KJHub.results = Object.assign({}, KJHub.results, { profitMonthlyByGroup: a.data || {}, marginMonthlyByBU: m.byBU || {}, marginMonthlyByDept: m.byDept || {}, marginMonthlyFull: m.full || {} });
      KJHub.resultsFromDb = true;
      console.log('[KJHub] 수익 집계 DB 수신 (' + (why || '') + ') ' + Math.round(performance.now() - t0) + 'ms · LOT ' + (m.lots || '?'));
      try { window.dispatchEvent(new CustomEvent('kjhub:results')); } catch (e) {}
    } catch (e) {
      if (!KJHub.resultsFromDb) console.warn('[KJHub] 수익 집계 DB 없음(0006·0007 SQL 미실행?) → 브라우저 계산:', e.message);
    } finally { resultsLoading = null; }
  })();
  return resultsLoading;
}
KJHub.refreshResults = why => loadResults(why || '갱신');
window.addEventListener('kjhub:allocsaved', () => loadResults('설정 저장'));   // 판매가·배분 설정 저장 후
window.addEventListener('kjhub:uploaded', () => loadResults('업로드'));        // 데이터 업로드 후

// 설정(마감월) 초기 로드
export async function loadCloseMonth() {
  const { data } = await supabase.from('config').select('value').eq('key', 'closeMonth').maybeSingle();
  const v = typeof data?.value === 'string' ? data.value : '';
  if (v) KJHub.setCloseMonth(v, { force: true });
  else { try { window.dispatchEvent(new CustomEvent('kjhub:closemonth', { detail: { month: KJHub.closeMonth() } })); } catch (e) {} }
  if (_cmResolve) { _cmResolve(); _cmResolve = null; }
}
