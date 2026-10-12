// ============================================================
// 기존 Apps Script 프로젝트에 이 함수를 추가하고 편집기에서 1회 실행하세요.
// 실행 로그(Ctrl+Enter 후 '실행 로그')에 JSON 이 찍힙니다 → 전체 복사 →
// 새 화면 '데이터 업로드 > 3. 기존 설정 가져오기' 에 붙여넣기.
// (로그가 잘리면 Drive 에 kjhub_config.json 파일로도 저장되므로 그 파일을 열어 복사)
// ============================================================
function exportAllConfig() {
  var props = PropertiesService.getScriptProperties();
  var raw = props.getProperty('ALLOC_CONFIG');
  var cfg = raw ? JSON.parse(raw) : {};
  var out = {
    groups: cfg.groups || {},
    items: cfg.items || { defaultPct: 100, defaultPctSyn: 100, byItem: {}, byMat: {} },
    support: { byMonth: {} },
    closeMonth: cfg.closeMonth || ''
  };
  var chunked = readItemChunks_();
  if (chunked) {
    if (chunked.byItem || chunked.byMat) { out.items.byItem = chunked.byItem || {}; out.items.byMat = chunked.byMat || {}; }
    else out.items.byItem = chunked;
  }
  if (!out.items.byMat) out.items.byMat = {};
  var sp = readSupportChunks_();
  if (sp) out.support = sp;
  var json = JSON.stringify(out);
  DriveApp.createFile('kjhub_config.json', json, 'application/json');
  Logger.log(json);
  return json;
}

// 사용자 시트 → 사원 등록용 CSV (이름/ID/부서/권한/화면별 부서). 새 화면의 '사원 관리'에서 수동 등록 시 참고.
function exportUsers() {
  var ss = SpreadsheetApp.openById(USERS_SHEET.id);
  var sh = getSheetByGid_(ss, USERS_SHEET.gid);
  var v = sh.getDataRange().getValues();
  var lines = v.map(function (r) { return r.map(function (c) { return String(c).replace(/[\r\n,]/g, ' '); }).join(','); });
  Logger.log(lines.join('\n'));
  return lines.join('\n');
}
