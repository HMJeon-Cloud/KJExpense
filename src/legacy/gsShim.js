// google.script.run 셈 — 기존 화면 코드가 호출하던 Apps Script 서버 함수를 Supabase 로 대체
/* eslint-disable */
import { supabase } from '../lib/supabase';

const CFG_KEYS = ['groups', 'items', 'support', 'closeMonth'];
const GROUP_KEYS_ = ['ops', 'matops', 'salessup', 'matsalessup', 'globalpur', 'scm', 'synth', 'matprod', 'sales', 'matsales'];
const emptyGroups_ = () => { const o = {}; GROUP_KEYS_.forEach(k => { o[k] = { ratios: [], ratiosByMonth: {}, manualMargin: null }; }); return o; };

export function dedupeSupport_(support) {
  var bm = (support && support.byMonth) || {};
  var months = Object.keys(bm).sort();
  var out = {}, prevJson = null;
  for (var i = 0; i < months.length; i++) {
    var m = months[i];
    var j = JSON.stringify(bm[m]);
    if (j !== prevJson) { out[m] = bm[m]; prevJson = j; }
  }
  return { byMonth: out };
}
export function cleanMonthMap_(src) {
  var out = {};
  var m = src || {};
  for (var ym in m) {
    if (!/^[0-9]{6}$/.test(String(ym))) continue;
    var v = Number(m[ym]);
    if (isFinite(v) && v >= 0) out[ym] = Math.round(v * 100) / 100;
  }
  return out;
}
export function summarizeConfig_(config) {
  var scr = [], sum = [];
  if (config && config.groups) { var n = 0; for (var k in config.groups) n++; if (n) { scr.push('배분 비율 설정(부서)'); sum.push('그룹 ' + n + '개'); } }
  if (config && config.items && config.items.byItem) { scr.push('배분 비율 설정(품목)'); sum.push('품목 ' + Object.keys(config.items.byItem).length + '건'); }
  if (config && config.items && config.items.byMat) { scr.push('배분 비율 설정(원자재)'); sum.push('자재 ' + Object.keys(config.items.byMat).length + '건'); }
  if (config && config.closeMonth != null) { scr.push('마감월'); sum.push(String(config.closeMonth)); }
  if (config && config.support && config.support.byMonth) {
    var bm = config.support.byMonth, mm = Object.keys(bm), tasks = 0;
    mm.forEach(function (m) { (bm[m] || []).forEach(function (g) { tasks += (g.tasks || []).length; }); });
    scr.push('지원 내역 설정');
    sum.push('월 ' + mm.length + '개 · 업무 ' + tasks + '건');
  }
  return { screen: scr.join(', ') || '설정', summary: sum.join(' / ') };
}
// 이력 목록 (최근 200건) — 관리자

export async function getAllocation() {
  const { data, error } = await supabase.from('config').select('key,value,updated_at,updated_by').in('key', CFG_KEYS);
  if (error) throw new Error(error.message);
  const m = {}; (data || []).forEach(r => { m[r.key] = r; });
  const cfg = { groups: emptyGroups_(), items: { defaultPct: 100, defaultPctSyn: 100, byItem: {}, byMat: {} }, support: { byMonth: {} }, closeMonth: '', updatedAt: null, updatedBy: null };
  const g0 = (m.groups && m.groups.value) || {};
  GROUP_KEYS_.forEach(k => { if (g0[k]) cfg.groups[k] = { ratios: g0[k].ratios || [], ratiosByMonth: g0[k].ratiosByMonth || {}, manualMargin: g0[k].manualMargin != null ? g0[k].manualMargin : null }; });
  if (m.items && m.items.value) { cfg.items = Object.assign(cfg.items, m.items.value); if (!cfg.items.byItem) cfg.items.byItem = {}; if (!cfg.items.byMat) cfg.items.byMat = {}; if (cfg.items.defaultPctSyn == null) cfg.items.defaultPctSyn = 100; }
  if (m.support && m.support.value && m.support.value.byMonth) cfg.support = m.support.value;
  if (m.closeMonth && typeof m.closeMonth.value === 'string') cfg.closeMonth = m.closeMonth.value;
  const latest = (data || []).sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1))[0];
  if (latest) { cfg.updatedAt = latest.updated_at; cfg.updatedBy = latest.updated_by; }
  return cfg;
}

// 기존 saveAllocation 의 검증·정리 로직을 그대로 옮김 (부분 저장: 보낸 섹션만 갱신)
export async function saveAllocation(_token, config) {
  var prev = await getAllocation();
  // ★ 배분 비율 설정(부서) — 팀(부서) 기준 9개 그룹
  var GROUP_KEYS = ['ops', 'matops', 'salessup', 'matsalessup', 'globalpur', 'scm', 'synth', 'matprod', 'sales', 'matsales'];
  var GROUP_LABELS = {
    ops: '운영지원팀', salessup: '영업지원팀', matops: '소재운영지원팀', matsalessup: '소재영업지원팀',
    globalpur: '글로벌구매팀', scm: 'SCM팀', synth: '합성팀', matprod: '소재생산팀',
    sales: '영업팀+영업지원팀', matsales: '소재영업팀+소재영업지원팀'
  };
  // ★ 부분 저장 지원 — 각 탭은 자기 섹션만 보냅니다.
  //   보내지 않은 섹션(groups / items.byItem / items.byMat)은 기존 저장값을 그대로 유지합니다.
  //   (탭마다 다른 섹션을 비워 보내 설정이 지워지던 문제 방지)
  var prevGroups = prev.groups || {};
  var prevItems = prev.items || {};
  var hasGroupsIn = false;
  if (config && config.groups) { for (var gchk in config.groups) { hasGroupsIn = true; break; } }
  // ★ 지원 내역 설정(support) — 전달되지 않으면 기존값 유지
  var support = prev.support || { byMonth: {} };
  if (config && config.support && config.support.byMonth) {
    var sbm = {};
    for (var sym in config.support.byMonth) {
      if (!/^[0-9]{6}$/.test(String(sym))) continue;
      sbm[sym] = (config.support.byMonth[sym] || []).map(function (g) {
        var dtlClean = function (o) {
          var out = {}; var src = o || {};
          for (var k in src) { var v = Number(src[k]); if (String(k).trim() && isFinite(v)) out[String(k).trim()] = Math.round(v * 100) / 100; }
          return out;
        };
        return {
          dept: String(g.dept || '').trim(),
          tasks: (g.tasks || []).map(function (t) {
            var arr = function (a) { return (a || []).map(function (x) { return String(x || '').trim(); }).filter(function (x) { return x; }); };
            return {
              task: String(t.task || '').trim(),
              desc: String(t.desc || '').trim(),
              scope: (t.scope === 'bu' || t.scope === 'dept') ? t.scope : 'all',
              buNames: arr(t.buNames), deptNames: arr(t.deptNames), excludes: arr(t.excludes),
              split: (t.split === 'head' || t.split === 'dept' || t.split === 'direct') ? t.split : 'unit',
              amount: Math.round((Number(t.amount) || 0) * 100) / 100,
              detail: dtlClean(t.detail)
            };
          }).filter(function (t) { return t.task; })
        };
      }).filter(function (g) { return g.dept; });
    }
    support = { byMonth: sbm };
  }

  var groups = {};
  GROUP_KEYS.forEach(function (gk) {
    // 보내지 않았으면 기존값 유지
    var g = hasGroupsIn ? ((config.groups && config.groups[gk]) || {}) : (prevGroups[gk] || {});
    var ratios = (g.ratios || [])
      .map(function (r) { return { dept: String(r.dept || '').trim(), pct: Math.round((Number(r.pct) || 0) * 100) / 100 }; })
      .filter(function (r) { return r.dept; });
    var sum = 0;
    ratios.forEach(function (r) { sum += r.pct; });
    if (ratios.length && Math.abs(sum - 100) > 0.01) {
      throw new Error('[' + GROUP_LABELS[gk] + '] 비율 합계가 100%가 아닙니다 (현재 ' + (Math.round(sum * 100) / 100) + '%).');
    }
    // ★ 기준월별 비율 (ratiosByMonth) — 월별로 다른 배분율을 저장
    var byM = {};
    var srcM = g.ratiosByMonth || {};
    for (var ym in srcM) {
      if (!/^[0-9]{6}$/.test(String(ym))) continue;
      var arr = (srcM[ym] || [])
        .map(function (r) { return { dept: String(r.dept || '').trim(), pct: Math.round((Number(r.pct) || 0) * 100) / 100 }; })
        .filter(function (r) { return r.dept; });
      if (!arr.length) continue;
      var s2 = 0;
      arr.forEach(function (r) { s2 += r.pct; });
      if (Math.abs(s2 - 100) > 0.01) {
        throw new Error('[' + GROUP_LABELS[gk] + '] ' + String(ym).slice(0, 4) + '-' + String(ym).slice(4) +
          ' 비율 합계가 100%가 아닙니다 (현재 ' + (Math.round(s2 * 100) / 100) + '%).');
      }
      byM[ym] = arr;
    }
    var mm = (g.manualMargin != null && g.manualMargin !== '') ? Number(g.manualMargin) : null;
    groups[gk] = { ratios: ratios, ratiosByMonth: byM, manualMargin: (mm != null && isFinite(mm)) ? mm : null };
  });

  // ★ 품목 배분 설정(items) 검증 및 정리 — 배분 비율 설정(품목) 탭
  //    형식: { defaultPct: 100, defaultPctSyn: 100,
  //            byItem: { "품목코드": { price: 1200|null, pct: 50|null, pctSyn: 30|null } } }
  //    pct = 구매 비율, pctSyn = 합성 비율 (별도 관리)
  var items = { defaultPct: 100, defaultPctSyn: 100, byItem: {} };
  // 보내지 않은 항목은 기존값 승계
  if (prevItems.defaultPct != null) items.defaultPct = prevItems.defaultPct;
  if (prevItems.defaultPctSyn != null) items.defaultPctSyn = prevItems.defaultPctSyn;
  if (prevItems.defaultPctMat != null) items.defaultPctMat = prevItems.defaultPctMat;
  var hasItemIn = !!(config && config.items && config.items.byItem);  // 품목 섹션 전달 여부
  var hasMatIn = !!(config && config.items && config.items.byMat);    // 원자재 섹션 전달 여부
  if (!hasItemIn) items.byItem = prevItems.byItem || {};              // 미전달 → 기존 유지
  if (config && config.items) {
    var dp = Number(config.items.defaultPct);
    items.defaultPct = (isFinite(dp) && dp >= 0) ? Math.round(dp * 100) / 100 : 100;
    var dpS = Number(config.items.defaultPctSyn);
    items.defaultPctSyn = (isFinite(dpS) && dpS >= 0) ? Math.round(dpS * 100) / 100 : 100;
    var src = hasItemIn ? config.items.byItem : {};
    if (hasItemIn) items.byItem = {};
    for (var code in src) {
      var c = String(code || '').trim().toUpperCase();
      if (!c) continue;
      var v = src[code] || {};
      var price = (v.price != null && v.price !== '') ? Number(v.price) : null;
      var pct = (v.pct != null && v.pct !== '') ? Number(v.pct) : null;
      var pctSyn = (v.pctSyn != null && v.pctSyn !== '') ? Number(v.pctSyn) : null;
      price = (price != null && isFinite(price) && price >= 0) ? price : null;
      pct = (pct != null && isFinite(pct) && pct >= 0) ? pct : null;
      pctSyn = (pctSyn != null && isFinite(pctSyn) && pctSyn >= 0) ? pctSyn : null;
      // ★ 월별 판매가(priceByMonth): { 'YYYYMM': 숫자 } — 입고월 기준
      var pbm = {};
      var srcPbm = v.priceByMonth || {};
      for (var ym in srcPbm) {
        if (!/^[0-9]{6}$/.test(String(ym))) continue;
        var pv = Number(srcPbm[ym]);
        if (isFinite(pv) && pv >= 0) pbm[ym] = pv;
      }
      // ★ 월별 판매가(구매)/(합성) — 금액(원), 기준월(YYYYMM)별
      var sbm = cleanMonthMap_(v.sellBuyByMonth);
      var ssm = cleanMonthMap_(v.sellSynByMonth);
      var hasPbm = false; for (var k1 in pbm) { hasPbm = true; break; }
      var hasSbm = false; for (var k2 in sbm) { hasSbm = true; break; }
      var hasSsm = false; for (var k3 in ssm) { hasSsm = true; break; }
      if (price == null && pct == null && pctSyn == null && !hasPbm && !hasSbm && !hasSsm) continue; // 빈 항목은 저장하지 않음
      items.byItem[c] = { price: price, pct: pct, pctSyn: pctSyn, priceByMonth: pbm, sellBuyByMonth: sbm, sellSynByMonth: ssm };
    }
  }

  // ★ 원자재(byMat) 설정 — 배분 비율 설정(원자재) 탭
  items.byMat = hasMatIn ? {} : (prevItems.byMat || {}); // 미전달 → 기존 유지
  var srcMat = hasMatIn ? config.items.byMat : {};
  for (var mc in srcMat) {
    var mkey = String(mc).trim().toUpperCase();
    if (!mkey) continue;
    var msm = cleanMonthMap_((srcMat[mc] || {}).sellBuyByMonth);
    var hasM = false; for (var mk in msm) { hasM = true; break; }
    if (hasM) items.byMat[mkey] = { sellBuyByMonth: msm };
  }
  if (config && config.items && config.items.defaultPctMat != null) items.defaultPctMat = Number(config.items.defaultPctMat) || 0;

  // ★ 마감월 (YYYYMM) — 전달되지 않으면 기존값 유지
  var closeMonth = prev.closeMonth || '';
  if (config && config.closeMonth != null) {
    var cm = String(config.closeMonth).replace(/[^0-9]/g, '').slice(0, 6);
    closeMonth = /^[0-9]{6}$/.test(cm) ? cm : '';
  }
  var info = summarizeConfig_(config);
  var writes = [];
  if (hasGroupsIn) writes.push(['groups', groups]);
  if (config && config.items) writes.push(['items', items]);
  if (config && config.support && config.support.byMonth) writes.push(['support', dedupeSupport_(support)]);
  if (config && config.closeMonth != null) writes.push(['closeMonth', closeMonth]);
  for (const [k, v] of writes) {
    const { error } = await supabase.rpc('save_config', { p_key: k, p_value: v, p_summary: info.screen + ' · ' + info.summary });
    if (error) throw new Error(error.message);
  }
  const payload = { groups: groups, items: items, support: support, closeMonth: closeMonth, updatedAt: new Date().toISOString(), updatedBy: null };
  try { window.dispatchEvent(new CustomEvent('kjhub:allocsaved', { detail: payload })); } catch (e) {}
  return payload;
}

const KEY_LABEL = { groups: '배분 비율 설정(부서)', items: '배분 비율 설정(품목/원자재)', support: '지원 내역 설정', closeMonth: '마감월' };
export async function listConfigHistory() {
  const { data, error } = await supabase.from('config_history').select('id,key,summary,changed_by,created_at').order('created_at', { ascending: false }).limit(200);
  if (error) throw new Error(error.message);
  return { enabled: true, rows: (data || []).map(r => ({ row: r.id, ts: new Date(r.created_at).toLocaleString('ko-KR', { hour12: false }), user: r.changed_by || '', screen: KEY_LABEL[r.key] || r.key, month: '', summary: r.summary || '', ok: true })) };
}
export async function restoreConfigHistory(_token, id) {
  const { error } = await supabase.rpc('restore_config', { p_history_id: Number(id) });
  if (error) throw new Error(error.message);
  return getAllocation();
}

// google.script.run 체인 API 흉내: withSuccessHandler(fn).withFailureHandler(fn).method(args)
const API = { getAllocation, saveAllocation, listConfigHistory, restoreConfigHistory, logout: async () => {}, getScreenData: async () => ({}) };
function makeRunner() {
  let ok = () => {}, fail = e => console.error(e);
  const r = {};
  r.withSuccessHandler = fn => { ok = fn || ok; return r; };
  r.withFailureHandler = fn => { fail = fn || fail; return r; };
  r.withUserObject = () => r;
  for (const name of Object.keys(API)) r[name] = (...args) => { API[name](...args).then(v => ok(v)).catch(e => fail(e instanceof Error ? e : new Error(String(e)))); };
  return r;
}
export function installGsShim() {
  const run = new Proxy({}, { get: (_t, p) => makeRunner()[p] });
  window.google = window.google || {};
  window.google.script = window.google.script || {};
  window.google.script.run = run;
}
