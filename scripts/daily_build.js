/* scripts/daily_build.js — '오늘 한 장' 카드에 들어갈 보조 지표를 매일 새벽에 모은다 (v9.19)
   GitHub Actions 가 macro_build.js 다음에 돌려 daily_data.json 을 커밋한다. 앱의 '오늘 한 장' 카드가 읽는다. 없는 항목은 카드에서 그 줄만 빠진다.

   ① 미분양      — 통계청 KOSIS Open API (KOSIS_KEY) · 국토부 '미분양주택현황보고' 월별 (전국·수도권·서울 + 준공 후 미분양)
   ② 가격지수    — KOSIS 에 올라오는 한국부동산원 '전국주택가격동향조사' 아파트 매매·전세가격지수 월별 (전국·수도권·서울)
                   주간 지수는 부동산원 R-ONE Open API 키(RONE_KEY, 선택)가 있을 때만 (data/daily_codes.json 의 roneWeekly 표 ID 사용)
   ③ 청약        — 공공데이터포털 청약홈 분양정보 API (DATA_GO_KEY, 선택). 접수 중·예정 단지와 최근 경쟁률.
                   국토부 실거래 키와 같은 data.go.kr 계정이면 '한국부동산원_청약홈 분양정보 조회 서비스' 활용신청 후 같은 키를 GitHub Secret 으로 넣으면 된다.
   통계표 코드는 기본값을 먼저 쓰고, 안 맞으면 이름으로 찾아 data/daily_codes.json 에 기억한다. 무엇을 받았고 어디서 막혔는지는 data/daily_debug.json.
   node 18+ */
var fs = require("fs"), path = require("path");
var ROOT = path.join(__dirname, "..");
var KOSIS = process.env.KOSIS_KEY || "", RONE = process.env.RONE_KEY || "", DATAGO = process.env.DATA_GO_KEY || "";
var KOSIS_BASE = process.env.KOSIS_BASE || "https://kosis.kr/openapi/", RONE_BASE = process.env.RONE_BASE || "https://www.reb.or.kr/r-one/openapi/", ODC_BASE = process.env.ODC_BASE || "https://api.odcloud.kr/api/";
var CODES_P = path.join(ROOT, "data", "daily_codes.json"), DEBUG_P = path.join(ROOT, "data", "daily_debug.json"), OUT_P = path.join(ROOT, "daily_data.json");
var DBG = { builtAt: new Date().toISOString(), steps: [] }, CALLS = 0;
function log(s) { console.log(s); DBG.steps.push(String(s)); }
function readJson(p, d) { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch (e) { return d; } }
function num(v) { var n = Number(String(v == null ? "" : v).replace(/,/g, "")); return isFinite(n) ? n : null; }
function kst() { var d = new Date(Date.now() + 9 * 3600000); return d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate(); }
function ymd(n) { return String(n).replace(/(\d{4})(\d\d)(\d\d)/, "$1-$2-$3"); }
var CODES = readJson(CODES_P, {});
var DEF = {
  unsold: { orgId: "116", tblId: "DT_MLTM_2080", nm: "미분양주택현황보고" },
  unsoldDone: { orgId: "116", tblId: "DT_MLTM_2082", nm: "공사완료후 미분양현황" },
  idxSale: { orgId: "408", tblId: "DT_30404_N0010", nm: "아파트 매매가격지수" },
  idxRent: { orgId: "408", tblId: "DT_30404_N0012", nm: "아파트 전세가격지수" },
  roneWeekly: { sale: "A_2024_00901", nm: "주간아파트 매매가격지수" }
};
async function getText(url) {
  CALLS++;
  var ac = new AbortController(), t = setTimeout(function () { ac.abort(); }, 25000);
  try { var r = await fetch(url, { signal: ac.signal, headers: { "user-agent": "Mozilla/5.0 (TrackApt-daily-build)" } }); return await r.text(); }
  finally { clearTimeout(t); }
}
async function getJson(url) { var t = await getText(url); try { return JSON.parse(t); } catch (e) { return { _raw: t.slice(0, 300) }; } }

/* ── KOSIS ──────────────────────────────────────────────────────────── */
function kosisUrl(svc, q) { var s = KOSIS_BASE + svc + "?method=" + q.method + "&apiKey=" + encodeURIComponent(KOSIS) + "&format=json&jsonVD=Y"; Object.keys(q).forEach(function (k) { if (k !== "method") s += "&" + k + "=" + encodeURIComponent(q[k]); }); return s; }
function kArr(j) { return Array.isArray(j) ? j : (j && Array.isArray(j.list) ? j.list : null); }
function kErr(j) { return j ? (j.errMsg || j.err || (j._raw ? j._raw.slice(0, 120) : JSON.stringify(j).slice(0, 120))) : "빈 응답"; }
function kNames(r) { return [r.C1_NM, r.C2_NM, r.C3_NM, r.C4_NM].filter(Boolean).join(" "); }
async function kosisProbe(c, months) {
  function q(n, over) { var o = { method: "getList", orgId: c.orgId, tblId: c.tblId, itmId: "ALL", prdSe: "M", newEstPrdCnt: String(months || 1) }; for (var k = 1; k <= n; k++) o["objL" + k] = "ALL"; Object.keys(over || {}).forEach(function (k) { o[k] = over[k]; }); return o; }
  for (var n = 1; n <= 5; n++) { var j = await getJson(kosisUrl("Param/statisticsParameterData.do", q(n))); var a = kArr(j); if (a && a.length) return { rows: a, nLev: n, q: q }; if (!/objL/.test(kErr(j))) log("KOSIS " + c.nm + " 탐색 " + n + "단계: " + kErr(j)); }   /* objL 누락은 분류 단수를 더듬는 정상 과정 */
  return null;
}
/* 표 찾기: 기억한 코드 → 기본 코드 → 이름 검색 후보 순으로 1개월치를 받아 보고, validate 를 통과하는 첫 표를 쓴다 */
var DEF_SEARCH = { unsold: ["미분양주택현황", /미분양주택현황/], unsoldDone: ["공사완료후 미분양", /공사완료후.*미분양|준공.*미분양/], idxSale: ["아파트 매매가격지수", /매매가격지수/], idxRent: ["아파트 전세가격지수", /전세가격지수/] };
async function kosisFind(key, validate) {
  var cands = []; if (CODES[key]) cands.push(CODES[key]); cands.push(DEF[key]);
  var tried = {};
  for (var pass = 0; pass < 2; pass++) {
    if (pass === 1) {
      var sr = DEF_SEARCH[key], found = await getJson(kosisUrl("statisticsSearch.do", { method: "getList", searchNm: sr[0] }));
      var list = (kArr(found) || []).filter(function (x) { return sr[1].test(x.TBL_NM || ""); });
      var score = function (x) { var nm = x.TBL_NM || ""; return (String(x.ORG_ID) === String(DEF[key].orgId) ? 4 : 0) + (/아파트/.test(nm) ? 2 : 0) + (/시도|시·도|지역별/.test(nm) ? 1 : 0) - (/주간|연령|규모|변동률|증감률|월세|전환율|통합|평균가격|중위/.test(nm) ? 8 : 0); };
      list.sort(function (a, b) { return score(b) - score(a); });
      DBG[key + "Search"] = list.slice(0, 10).map(function (x) { return x.ORG_ID + "/" + x.TBL_ID + " " + x.TBL_NM; });
      if (!list.length) log("KOSIS 검색 결과 없음 " + sr[0] + ": " + kErr(found));
      cands = list.slice(0, 8).map(function (x) { return { orgId: x.ORG_ID, tblId: x.TBL_ID, nm: x.TBL_NM }; });
    }
    for (var i = 0; i < cands.length; i++) {
      var c = cands[i], id = c.orgId + "/" + c.tblId; if (tried[id]) continue; tried[id] = 1;
      var p = await kosisProbe(c, 1); if (!p) continue;
      if (validate && !validate(p.rows)) { log("KOSIS " + key + " 표 " + id + " 는 모양이 다름 — " + p.rows.slice(0, 4).map(function (r) { return r.ITM_NM + "/" + kNames(r); }).join(", ")); continue; }
      if (!CODES[key] || CODES[key].tblId !== c.tblId) log("KOSIS 표 선택 " + key + ": " + id + " " + c.nm);
      CODES[key] = c; return { c: c, p: p };
    }
  }
  return null;
}
function seriesOf(rows, filt) {
  var m = {}; rows.filter(filt).forEach(function (r) { var t = Number(r.PRD_DE), v = num(r.DT); if (t && v != null) m[t] = v; });
  return Object.keys(m).map(Number).sort().map(function (t) { return [t, m[t]]; });
}
async function kosisSeries(key, validate, months, narrow) {
  var f = await kosisFind(key, validate); if (!f) { log("KOSIS " + key + " 쓸 수 있는 표를 못 찾음"); return null; }
  var over = { newEstPrdCnt: String(months) }, nr = narrow ? narrow(f.p.rows) : null; if (nr) Object.keys(nr).forEach(function (k) { over[k] = nr[k]; });
  var rows = null, tries = [months, 12, 6];
  for (var ti = 0; ti < tries.length && !rows; ti++) {
    over.newEstPrdCnt = String(tries[ti]);
    var j = await getJson(kosisUrl("Param/statisticsParameterData.do", f.p.q(f.p.nLev, over)));
    rows = kArr(j); if (!rows) { log("KOSIS " + key + " 2차(" + tries[ti] + "개월) 실패: " + kErr(j)); if (!/40,000|셀/.test(kErr(j))) break; }
  }
  if (!rows) return null;
  DBG[key + "Sample"] = rows.slice(0, 3);
  return { rows: rows, nm: f.c.nm };
}
/* 행 고르기: C1 = 지역, 나머지 분류(부문·규모·주택유형 등)는 '총합·계·소계·종합·아파트' 같은 전체 행만 */
function c1(r) { return String(r.C1_NM || "").trim(); }
function restAll(r) { return [r.C2_NM, r.C3_NM, r.C4_NM].filter(Boolean).every(function (x) { return /^(총합|계|합계|소계|전체|종합|아파트)$/.test(String(x).trim()); }); }
function isTotalRow(r) { return /^(전국|계|합계|총계)$/.test(c1(r)) && restAll(r); }
function levelRow(r, nm) { return c1(r) === nm && restAll(r); }
function sumSeries(list) { var m = {}, cnt = {}; list.forEach(function (s) { (s || []).forEach(function (p) { m[p[0]] = (m[p[0]] || 0) + p[1]; cnt[p[0]] = (cnt[p[0]] || 0) + 1; }); }); return Object.keys(m).filter(function (t) { return cnt[t] === list.length; }).map(Number).sort().map(function (t) { return [t, m[t]]; }); }

async function unsold() {
  if (!KOSIS) { log("KOSIS_KEY 없음 → 미분양 건너뜀"); return null; }
  var out = {};
  var tot = await kosisSeries("unsold", function (rows) { return rows.some(isTotalRow) && !rows.some(function (r) { return /준공|완료/.test(r.ITM_NM || ""); }); }, 25);
  if (tot) {
    var R = tot.rows, g = function (f) { var s = seriesOf(R, f); return s.length ? s : null; };
    out.all = g(isTotalRow); out.seoul = g(function (r) { return levelRow(r, "서울") || levelRow(r, "서울특별시"); }); out.gg = g(function (r) { return levelRow(r, "경기") || levelRow(r, "경기도"); });
    var ic = g(function (r) { return levelRow(r, "인천") || levelRow(r, "인천광역시"); });
    out.cap = g(function (r) { return levelRow(r, "수도권"); }) || (out.seoul && out.gg && ic ? sumSeries([out.seoul, out.gg, ic]) : null);
    out.src = tot.nm;
  }
  var SIDO = /^(서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충북|충남|전북|전남|경북|경남|제주)/;
  var sidoTot = function (r) { return SIDO.test(c1(r)) && !/\s(계|합계|소계)$/.test(c1(r)) ? (r.C2_NM != null && restAll(r)) : (SIDO.test(c1(r)) && /\s(계|합계|소계)$/.test(c1(r)) && restAll(r)); };
  var done = await kosisSeries("unsoldDone", function (rows) { return rows.some(isTotalRow) || rows.some(sidoTot); }, 25, function (rows) {
    var r = rows.filter(function (x) { return x.C2 && /^(계|합계|소계|총합)$/.test(String(x.C2_NM || "").trim()); })[0];
    return r ? { objL2: r.C2 } : null;   /* 시군구 표: 2단은 '계' 코드만 받아 40,000셀 제한을 피한다 */
  });
  if (done) {
    var ds = seriesOf(done.rows, isTotalRow);
    if (!ds.length) { var by = {}; done.rows.filter(sidoTot).forEach(function (r) { by[c1(r)] = 1; }); ds = sumSeries(Object.keys(by).map(function (nm) { return seriesOf(done.rows, function (r) { return c1(r) === nm && restAll(r); }); })); log("준공 후 미분양: 시도 " + Object.keys(by).length + "곳 합산"); }
    if (ds.length) out.done = ds;
    var sd = seriesOf(done.rows, function (r) { return /^서울/.test(c1(r)) && (isTotalRow(r) || sidoTot(r)); }); if (sd.length) out.doneSeoul = sd;
  }
  return Object.keys(out).length ? out : null;
}
async function priceIndex() {
  if (!KOSIS) return null;
  var out = {};
  for (var kk = 0; kk < 2; kk++) {
    var key = kk ? "idxRent" : "idxSale", re = kk ? /전세가격지수/ : /매매가격지수/;
    var s = await kosisSeries(key, function (rows) { return String(rows[0].PRD_DE || "").length === 6 && rows.some(function (r) { return /^(전국|수도권)$/.test(c1(r)) && re.test(r.ITM_NM || "") && !/증감|변동|평균|중위/.test(r.ITM_NM || "") && restAll(r); }); }, 26);
    if (!s) continue;
    var R = s.rows, idxRow = function (nm) { return function (r) { return c1(r) === nm && restAll(r) && re.test(r.ITM_NM || "") && !/증감|변동/.test(r.ITM_NM || ""); }; };
    var g = function (nm) { var a = seriesOf(R, idxRow(nm)); return a.length ? a : null; };
    out[kk ? "rent" : "sale"] = { all: g("전국"), cap: g("수도권"), seoul: g("서울"), gg: g("경기"), src: s.nm };
  }
  return Object.keys(out).length ? out : null;
}
/* R-ONE 주간 지수 (선택) */
async function weekly() {
  if (!RONE) return null;
  var c = CODES.roneWeekly || DEF.roneWeekly;
  try {
    var j = await getJson(RONE_BASE + "SttsApiTblData.do?KEY=" + encodeURIComponent(RONE) + "&Type=json&pIndex=1&pSize=1000&STATBL_ID=" + c.sale + "&DTACYCLE_CD=WK");
    var rows = (j.SttsApiTblData && j.SttsApiTblData[1] && j.SttsApiTblData[1].row) || [];
    if (!rows.length) { log("R-ONE 주간: " + JSON.stringify(j).slice(0, 160)); DBG.rone = j; return null; }
    DBG.roneSample = rows.slice(0, 3);
    var out = { src: "한국부동산원 R-ONE " + c.nm }, pick = function (re) { var m = {}; rows.filter(function (r) { return re.test(r.CLS_NM || "") && /매매|지수|변동/.test((r.ITM_NM || "") + "지수"); }).forEach(function (r) { var t = Number(String(r.WRTTIME_IDTFR_ID || "").slice(0, 8)), v = num(r.DTA_VAL); if (t && v != null) m[t] = v; }); var a = Object.keys(m).map(Number).sort().map(function (t) { return [t, m[t]]; }); return a.length ? a.slice(-30) : null; };
    out.all = pick(/^전국$/); out.cap = pick(/^수도권$/); out.seoul = pick(/^서울$/); out.gg = pick(/^경기$/);
    return out;
  } catch (e) { log("R-ONE 실패: " + e.message); return null; }
}
/* 청약홈 (선택) — APT 분양 + 무순위·잔여세대 + 주택형별 분양가 + 경쟁률. 일정은 '미리' 알아야 하므로 공고일 기준 과거 45일 ~ 앞으로의 것을 모두 담는다 */
function dn(v) { var n = num(String(v || "").replace(/-/g, "").slice(0, 8)); return n && n > 19000000 ? n : null; }
function dateIn(s) { var m = String(s || "").match(/(\d{4})-?(\d{2})-?(\d{2})/); return m ? Number(m[1] + m[2] + m[3]) : null; }
async function odc(path, q) {
  var all = [], page = 1;
  while (page <= 4) {
    var j = await getJson(ODC_BASE + path + "?page=" + page + "&perPage=500&serviceKey=" + encodeURIComponent(DATAGO) + "&returnType=JSON" + (q || ""));
    var d = j.data || []; if (!d.length) { if (page === 1) { log("청약 " + path.split("/").pop() + ": " + JSON.stringify(j).slice(0, 160)); DBG["odc_" + path.split("/").pop()] = j; } break; }
    all = all.concat(d); if (d.length < 500) break; page++;
  }
  return all;
}
async function subs() {
  if (!DATAGO) { log("DATA_GO_KEY 없음 → 청약 건너뜀"); return null; }
  var today = kst(), from = today - 0; var fromD = new Date(Date.UTC(Math.floor(today / 10000), Math.floor(today / 100) % 100 - 1, today % 100) - 45 * 86400000); var since = fromD.getUTCFullYear() * 10000 + (fromD.getUTCMonth() + 1) * 100 + fromD.getUTCDate();
  var out = { asOf: today, items: [], results: [], src: "청약홈(공공데이터포털)" };
  try {
    /* 1 APT 분양 공고 */
    var apt = await odc("ApplyhomeInfoDetailSvc/v1/getAPTLttotPblancDetail");
    DBG.subsSample = apt.slice(0, 1);
    apt.forEach(function (r) {
      var it = { kind: "apt", no: r.HOUSE_MANAGE_NO, pno: r.PBLANC_NO, nm: r.HOUSE_NM, type: r.HOUSE_SECD_NM || r.HOUSE_DTL_SECD_NM, rent: r.RENT_SECD_NM, area: r.SUBSCRPT_AREA_CODE_NM, addr: r.HSSPLY_ADRES, zip: r.HSSPLY_ZIP, n: num(r.TOT_SUPLY_HSHLDCO),
        notice: dn(r.RCRIT_PBLANC_DE), spB: dn(r.SPSPLY_RCEPT_BGNDE), spE: dn(r.SPSPLY_RCEPT_ENDDE), r1: dateIn(r.GNRL_RNK1_CRSPAREA_RCEPT_PD), r1x: dateIn(r.GNRL_RNK1_ETC_AREA_RCPTDE), r1g: dateIn(r.GNRL_RNK1_ETC_GG_RCPTDE), r2g: dateIn(r.GNRL_RNK2_ETC_GG_RCPTDE), r2: dateIn(r.GNRL_RNK2_CRSPAREA_RCEPT_PD), r2x: dateIn(r.GNRL_RNK2_ETC_AREA_RCPTDE),
        b: dn(r.RCEPT_BGNDE), e: dn(r.RCEPT_ENDDE), win: dn(r.PRZWNER_PRESNATN_DE), cB: dn(r.CNTRCT_CNCLS_BGNDE), cE: dn(r.CNTRCT_CNCLS_ENDDE), move: r.MVN_PREARNGE_YM,
        cap: r.PARCPRC_ULS_AT === "Y", hot: r.SPECLT_RDN_EARTH_AT === "Y", adj: r.MDAT_TRGET_AREA_SECD === "Y", pub: r.PUBLIC_HOUSE_EARTH_AT === "Y", big: r.LRSCL_BLDLND_AT === "Y", redev: r.IMPRMN_BSNS_AT === "Y", pubLaw: r.PUBLIC_HOUSE_SPCLW_APPLC_AT === "Y", npln: r.NPLN_PRVOPR_PUBLIC_HOUSE_AT === "Y", dtl: r.HOUSE_DTL_SECD_NM, builder: r.CNSTRCT_ENTRPS_NM, owner: r.BSNS_MBY_NM, tel: r.MDHS_TELNO, url: r.PBLANC_URL, home: r.HMPG_ADRES };
      var last = Math.max(it.win || 0, it.e || 0, it.cE || 0, it.notice || 0);
      if (last >= since) out.items.push(it);
    });
    /* 2 무순위·잔여세대 */
    try {
      var rem = await odc("ApplyhomeInfoDetailSvc/v1/getRemndrLttotPblancDetail");
      DBG.remSample = rem.slice(0, 1);
      rem.forEach(function (r) {
        var it = { kind: "rem", no: r.HOUSE_MANAGE_NO, pno: r.PBLANC_NO, nm: r.HOUSE_NM, type: r.HOUSE_SECD_NM || "무순위", sub: r.HOUSE_DTL_SECD_NM, area: r.SUBSCRPT_AREA_CODE_NM, addr: r.HSSPLY_ADRES, n: num(r.TOT_SUPLY_HSHLDCO), notice: dn(r.RCRIT_PBLANC_DE), b: dn(r.SUBSCRPT_RCEPT_BGNDE || r.RCEPT_BGNDE), e: dn(r.SUBSCRPT_RCEPT_ENDDE || r.RCEPT_ENDDE), win: dn(r.PRZWNER_PRESNATN_DE), cB: dn(r.CNTRCT_CNCLS_BGNDE), cE: dn(r.CNTRCT_CNCLS_ENDDE), url: r.PBLANC_URL, home: r.HMPG_ADRES, tel: r.MDHS_TELNO };
        var last = Math.max(it.win || 0, it.e || 0, it.notice || 0);
        if (last >= since) out.items.push(it);
      });
    } catch (e) { log("무순위 실패: " + e.message); }
    /* 3 주택형별 분양가·공급 수 (APT) — 담은 단지만 */
    try {
      var mdl = await odc("ApplyhomeInfoDetailSvc/v1/getAPTLttotPblancMdl");
      DBG.mdlSample = mdl.slice(0, 1);
      var byNo = {}; mdl.forEach(function (m) { var k = String(m.HOUSE_MANAGE_NO); (byNo[k] = byNo[k] || []).push(m); });
      out.items.forEach(function (it) {
        if (it.kind !== "apt") return;
        var L = byNo[String(it.no)] || []; if (!L.length) return;
        it.types = L.map(function (m) { return { ty: m.HOUSE_TY, n: num(m.SUPLY_HSHLDCO), sp: num(m.SPSPLY_HSHLDCO), top: num(m.LTTOT_TOP_AMOUNT), area: num(m.SUPLY_AR),
          spd: { 다자녀: num(m.MNYCH_SPSPLY_HSHLDCO), 신혼부부: num(m.NWWDS_SPSPLY_HSHLDCO), 생애최초: num(m.LFE_FRST_SPSPLY_HSHLDCO), 노부모: num(m.OLD_PARNTS_SUPORT_SPSPLY_HSHLDCO), 기관추천: num(m.INSTT_RECOMEND_SPSPLY_HSHLDCO), 청년: num(m.YGMN_SPSPLY_HSHLDCO), 신생아: num(m.NWBB_SPSPLY_HSHLDCO), 이전기관: num(m.TRANSR_INSTT_ENFSN_SPSPLY_HSHLDCO), 기타: num(m.ETC_SPSPLY_HSHLDCO) } }; }).filter(function (t) { return t.ty; }).sort(function (a, b) { return (a.area || 0) - (b.area || 0); }).slice(0, 12);
        var tops = it.types.filter(function (t) { return t.top; });
        if (tops.length) { it.pMin = Math.min.apply(null, tops.map(function (t) { return t.top; })); it.pMax = Math.max.apply(null, tops.map(function (t) { return t.top; })); var t84 = tops.filter(function (t) { return t.area && t.area >= 80 && t.area <= 86; })[0]; if (t84) it.p84 = t84.top; }
      });
    } catch (e) { log("주택형별 분양가 실패: " + e.message); }
    /* 4 경쟁률 (최근 공고 기준) */
    try {
      var cr = await odc("ApplyhomeInfoCmpetRtSvc/v1/getAPTLttotPblancCmpet");
      DBG.cmpetSample = cr.slice(0, 1);
      var byHouse = {};
      cr.forEach(function (r) { var k = String(r.HOUSE_MANAGE_NO || r.HOUSE_NM); var rate = num(r.CMPET_RATE), req = num(r.REQ_CNT), sup = num(r.SUPLY_HSHLDCO); var o = byHouse[k] || (byHouse[k] = { no: r.HOUSE_MANAGE_NO, nm: r.HOUSE_NM, req: 0, sup: 0, max: null, ty: [] }); o.req += req || 0; o.sup += sup || 0; if (rate != null && (o.max == null || rate > o.max)) { o.max = rate; o.maxTy = r.HOUSE_TY; } });
      var known = {}; out.items.forEach(function (it) { known[String(it.no)] = it; });
      out.results = Object.keys(byHouse).map(function (k) { var o = byHouse[k], it = known[k]; o.rate = o.sup ? Math.round(o.req / o.sup * 10) / 10 : o.max; if (it) { o.area = it.area; o.win = it.win; o.notice = it.notice; } return o; }).filter(function (o) { return o.rate != null && o.sup > 0; }).sort(function (a, b) { return (b.notice || 0) - (a.notice || 0) || b.rate - a.rate; }).slice(0, 60);
      out.items.forEach(function (it) { var o = byHouse[String(it.no)]; if (o && o.sup) { it.rate = o.rate; it.req = o.req; it.maxRate = o.max; it.maxTy = o.maxTy; } });
    } catch (e) { log("경쟁률 실패: " + e.message); }
    out.items.sort(function (a, b) { return (a.b || a.notice || 0) - (b.b || b.notice || 0); });
    /* 요약(카드용) */
    var openN = out.items.filter(function (i) { return i.b && i.e && i.b <= today && today <= i.e; }).length, soonN = out.items.filter(function (i) { return i.b && i.b > today; }).length;
    out.open = out.items.filter(function (i) { return i.kind === "apt" && i.b && i.e && i.b <= today && today <= i.e; }).slice(0, 10);
    out.soon = out.items.filter(function (i) { return i.kind === "apt" && i.b && i.b > today; }).slice(0, 10);
    log("청약 공고 " + out.items.length + "건(접수 중 " + openN + " · 예정 " + soonN + ") · 경쟁률 " + out.results.length + " · 분양가 있는 단지 " + out.items.filter(function (i) { return i.pMax; }).length);
  } catch (e) { log("청약 실패: " + e.message); }
  return out;
}

(async function () {
  var out = { v: 1, builtAt: new Date().toISOString(), asOf: kst(), errors: [] };
  async function step(nm, fn) { try { var r = await fn(); if (r) out[nm] = r; log(nm + (r ? " OK" : " 없음")); } catch (e) { out.errors.push(nm + ": " + e.message); log(nm + " 실패: " + e.message); } }
  await step("unsold", unsold);
  await step("index", priceIndex);
  await step("weekly", weekly);
  await step("subs", subs);
  out.calls = CALLS;
  fs.writeFileSync(OUT_P, JSON.stringify(out));
  fs.mkdirSync(path.join(ROOT, "data"), { recursive: true });
  fs.writeFileSync(CODES_P, JSON.stringify(CODES, null, 1));
  DBG.errors = out.errors; fs.writeFileSync(DEBUG_P, JSON.stringify(DBG, null, 1));
  log("완료 — 호출 " + CALLS + "회 · 오류 " + out.errors.length + "건");
})().catch(function (e) { console.error(e); process.exit(1); });
