import { useEffect, useMemo, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import { supabase, type Employee } from '../lib/supabase';
import { useUI, kst } from '../components/ui';
import { SCREENS } from '../components/Layout';

type Form = Partial<Employee> & { login_id: string; name: string };
const empty: Form = { login_id: '', name: '', email: '', emp_no: '', dept: '', title: '', grade: '', role: 'user', screen_depts: {}, active: true };
const ROLE_LABEL: Record<string, string> = { admin: '관리자', all: '전체 조회', user: '일반' };

async function callAdmin(body: { action: string; employee?: Form; login_id?: string }) {
  if (body.action === 'create' || body.action === 'update') {
    const e = body.employee!;
    const { error } = await supabase.rpc('admin_upsert_employee', { p: e });
    if (error) throw new Error(error.message);
    return;
  }
  if (body.action === 'reset_password') { const { error } = await supabase.rpc('admin_reset_password', { p_login_id: body.login_id }); if (error) throw new Error(error.message); return; }
  if (body.action === 'delete') { const { error } = await supabase.rpc('admin_delete_employee', { p_login_id: body.login_id }); if (error) throw new Error(error.message); return; }
}

export default function Employees() {
  const { toast, confirm } = useUI();
  const [list, setList] = useState<Employee[]>([]);
  const [q, setQ] = useState('');
  const [form, setForm] = useState<Form>(empty);
  const [isNew, setIsNew] = useState(true);
  const [busy, setBusy] = useState(false);
  const [depts, setDepts] = useState<string[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  async function load() {
    const { data } = await supabase.from('employees').select('*').order('dept').order('name');
    setList((data as Employee[]) ?? []);
    const { data: d } = await supabase.from('rows').select('dept_name').eq('dataset', 'dept').limit(500);
    setDepts(Array.from(new Set((d ?? []).map(r => r.dept_name).filter(Boolean))).sort() as string[]);
  }
  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => list.filter(e => !q || [e.login_id, e.name, e.dept, e.emp_no, e.email].some(v => (v ?? '').toLowerCase().includes(q.toLowerCase()))), [list, q]);
  const screensUser = SCREENS.flatMap(g => g.items).filter(i => !i.admin);

  function pick(e: Employee) { setForm({ ...e, screen_depts: e.screen_depts ?? {} }); setIsNew(false); }
  function reset() { setForm(empty); setIsNew(true); }
  const set = (k: keyof Form, v: unknown) => setForm(f => ({ ...f, [k]: v }));

  async function save() {
    if (!form.login_id.trim() || !form.name.trim()) return toast('사원 ID와 이름은 필수입니다.', 'err');
    setBusy(true);
    try {
      await callAdmin({ action: isNew ? 'create' : 'update', employee: form });
      toast(isNew ? `${form.name} 등록 완료 · 사원 ID(${form.login_id})로 처음 로그인하면 계정이 만들어집니다` : `${form.name} 저장됨`);
      await load(); if (isNew) reset();
    } catch (e) { toast((e as Error).message, 'err'); } finally { setBusy(false); }
  }
  async function resetPw() {
    if (!(await confirm('비밀번호를 초기화할까요?', `${form.name}의 비밀번호가 사원 ID(${form.login_id})로 돌아가고, 다음 로그인 때 변경을 요구합니다.`, { okText: '초기화' }))) return;
    try { await callAdmin({ action: 'reset_password', login_id: form.login_id }); toast('초기화했습니다.'); } catch (e) { toast((e as Error).message, 'err'); }
  }
  async function remove() {
    if (!(await confirm('사원을 삭제할까요?', `${form.name}(${form.login_id}) 계정과 권한이 삭제됩니다. 퇴사자는 삭제 대신 '비활성'을 권합니다.`, { danger: true }))) return;
    try { await callAdmin({ action: 'delete', login_id: form.login_id }); toast('삭제했습니다.'); reset(); await load(); } catch (e) { toast((e as Error).message, 'err'); }
  }
  /** 엑셀 일괄 등록: 열 이름 이름 / 이메일 / 사번 / ID / 부서 / 직책 / 직위 (영문 name/email/emp_no/login_id/dept/title/grade 도 인식) */
  async function importExcel(f: File) {
    const wb = XLSX.read(await f.arrayBuffer(), { type: 'array' });
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]], { defval: '' });
    const col = (r: Record<string, unknown>, ...names: string[]) => { for (const k of Object.keys(r)) if (names.some(n => n.toLowerCase() === String(k).trim().toLowerCase())) return String(r[k] ?? '').trim(); return ''; };
    const items = rows.map(r => ({ login_id: col(r, 'ID', '아이디', 'login_id', '사원ID'), name: col(r, '이름', '성명', 'name'), email: col(r, '이메일', 'email'), emp_no: col(r, '사번', 'emp_no'), dept: col(r, '부서', '부서명', 'dept'), title: col(r, '직책', 'title'), grade: col(r, '직위', 'grade'), role: 'user', screen_depts: {}, active: true }))
      .filter(x => x.login_id && x.name);
    if (!items.length) return toast('이름과 ID 열이 있는 행을 찾지 못했습니다.', 'err');
    const dup = items.filter(x => list.some(e => e.login_id.toLowerCase() === x.login_id.toLowerCase()));
    if (!(await confirm('사원을 일괄 등록할까요?', `${items.length}명을 등록합니다.${dup.length ? ` 이미 있는 ${dup.length}명은 이름·부서 등 정보만 갱신되고 권한은 유지되지 않으니 확인하세요.` : ''}`, { okText: '등록' }))) return;
    setBusy(true); let ok = 0;
    try {
      for (const it of items) {
        const prev = list.find(e => e.login_id.toLowerCase() === it.login_id.toLowerCase());
        const { error } = await supabase.rpc('admin_upsert_employee', { p: prev ? { ...it, role: prev.role, screen_depts: prev.screen_depts, active: prev.active } : it });
        if (error) { toast(`${it.name}(${it.login_id}) 실패: ${error.message}`, 'err'); } else ok++;
      }
      toast(`${ok}명 등록/갱신 완료`); await load();
    } finally { setBusy(false); if (fileRef.current) fileRef.current.value = ''; }
  }
  function toggleDept(screen: string, dept: string) {
    const sd = { ...(form.screen_depts ?? {}) }; const cur = new Set(sd[screen] ?? []);
    cur.has(dept) ? cur.delete(dept) : cur.add(dept); sd[screen] = Array.from(cur); set('screen_depts', sd);
  }

  return (
    <div className="page">
      <div className="page-head"><h1>사원 관리</h1><span className="meta">{list.length}명 · 활성 {list.filter(e => e.active).length}명</span><span className="sp" /><button className="btn" onClick={() => fileRef.current?.click()} disabled={busy}>엑셀 일괄 등록</button><input ref={fileRef} id="emp-file" type="file" accept=".xlsx,.xls,.csv" hidden onChange={e => { const f = e.target.files?.[0]; if (f) importExcel(f); }} /><button className="btn pri" onClick={reset}>+ 사원 추가</button></div>
      <div className="filters"><input id="emp-q" className="inp grow" style={{ maxWidth: 320 }} placeholder="이름 · ID · 부서 · 사번 검색" value={q} onChange={e => setQ(e.target.value)} /></div>
      <div className="drawer">
        <div className="card"><div className="tbl-wrap"><table className="tbl"><thead><tr><th>이름</th><th>사원 ID</th><th>사번</th><th>부서</th><th>직책</th><th>직위</th><th>권한</th><th>상태</th></tr></thead>
          <tbody>{filtered.map(e => <tr key={e.id} className={form.id === e.id ? 'sel' : ''} onClick={() => pick(e)} style={{ cursor: 'pointer' }}>
            <td><b>{e.name}</b></td><td>{e.login_id}</td><td>{e.emp_no}</td><td>{e.dept}</td><td>{e.title}</td><td>{e.grade}</td>
            <td><span className={'tag ' + (e.role === 'admin' ? 'o' : e.role === 'all' ? 'b' : 'gr')}>{ROLE_LABEL[e.role]}</span></td>
            <td>{!e.active ? <span className="tag n">비활성</span> : !e.auth_uid ? <span className="tag gr">미접속</span> : e.must_change_pw ? <span className="tag y">초기 비번</span> : <span className="tag g">정상</span>}</td></tr>)}
            {filtered.length === 0 && <tr><td colSpan={8} className="empty">사원이 없습니다. 오른쪽에서 추가하세요.</td></tr>}</tbody></table></div></div>

        <div className="card side"><div className="hd">{isNew ? '사원 추가' : '사원 편집'}<span className="sp" />{!isNew && <span className="help">등록 {form.created_at ? kst(form.created_at).slice(0, 12) : ''}</span>}</div>
          <div className="bd">
            <div className="two" style={{ gap: 10 }}>
              <div className="field"><label htmlFor="e-name">이름 *</label><input id="e-name" className="inp" value={form.name} onChange={e => set('name', e.target.value)} /></div>
              <div className="field"><label htmlFor="e-id">사원 ID * {isNew && <span className="help">(초기 비밀번호)</span>}</label><input id="e-id" className="inp" value={form.login_id} disabled={!isNew} onChange={e => set('login_id', e.target.value.trim())} /></div>
              <div className="field"><label htmlFor="e-no">사번</label><input id="e-no" className="inp" value={form.emp_no ?? ''} onChange={e => set('emp_no', e.target.value)} /></div>
              <div className="field"><label htmlFor="e-mail">이메일</label><input id="e-mail" className="inp" value={form.email ?? ''} onChange={e => set('email', e.target.value)} /></div>
              <div className="field"><label htmlFor="e-dept">부서</label><input id="e-dept" className="inp" list="dept-list" value={form.dept ?? ''} onChange={e => set('dept', e.target.value)} /><datalist id="dept-list">{depts.map(d => <option key={d} value={d} />)}</datalist></div>
              <div className="field"><label htmlFor="e-title">직책</label><input id="e-title" className="inp" value={form.title ?? ''} onChange={e => set('title', e.target.value)} /></div>
              <div className="field"><label htmlFor="e-grade">직위</label><input id="e-grade" className="inp" value={form.grade ?? ''} onChange={e => set('grade', e.target.value)} /></div>
              <div className="field"><label htmlFor="e-role">권한</label><select id="e-role" className="inp" value={form.role} onChange={e => set('role', e.target.value)}><option value="user">일반 (허용 부서만)</option><option value="all">전체 조회</option><option value="admin">관리자</option></select></div>
            </div>
            {form.role === 'user' && (
              <div className="field"><label>화면별 허용 부서</label>
                <div style={{ display: 'grid', gap: 8, maxHeight: 260, overflow: 'auto', border: '1px solid var(--line)', borderRadius: 8, padding: 10 }}>
                  {screensUser.map(s => (
                    <div key={s.path}><div style={{ fontSize: 12, fontWeight: 500, marginBottom: 4 }}>{s.title} <span className="help">{(form.screen_depts?.[s.path] ?? []).length ? `${form.screen_depts![s.path].length}개` : '없음'}</span></div>
                      <div className="row" style={{ gap: 4 }}>{depts.length ? depts.map(d => <span key={d} className={'chip' + ((form.screen_depts?.[s.path] ?? []).includes(d) ? ' on' : '')} style={{ cursor: 'pointer' }} onClick={() => toggleDept(s.path, d)}>{d}</span>) : <span className="help">부서 데이터를 먼저 업로드하세요.</span>}</div></div>
                  ))}
                </div></div>
            )}
            {!isNew && <label className="row" style={{ fontSize: 13 }}><input type="checkbox" id="e-active" checked={form.active ?? true} onChange={e => set('active', e.target.checked)} /> 활성 (해제하면 로그인 불가)</label>}
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <span className="row">{!isNew && <><button className="btn sm" onClick={resetPw}>비밀번호 초기화</button><button className="btn sm danger" onClick={remove}>삭제</button></>}</span>
              <span className="row"><button className="btn ghost" onClick={reset}>취소</button><button className="btn pri" disabled={busy} onClick={save}>{busy ? <span className="spinner" /> : isNew ? '등록' : '저장'}</button></span>
            </div>
          </div></div>
      </div>
    </div>
  );
}
