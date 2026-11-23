// 관리 › 사원 · 권한 — 사원 등록, 권한 그룹, 화면마다 볼 수 있는 부서
//   실제 권한 = 개인 권한 ∪ 속한 권한 그룹 (lib/permGroups.ts). 역할(관리자 · 전체 보기 · 일반)은 사원마다 정합니다.
import { useEffect, useMemo, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import { supabase, type Employee } from '../lib/supabase';
import { useUI, kst } from '../components/ui';
import { SCREENS } from '../components/Layout';
import { loadPermGroups, savePermGroups, groupsOf, mergeScreenDepts, newGroupId, type PermGroup, type ScreenDepts } from '../lib/permGroups';

type Form = Partial<Employee> & { login_id: string; name: string };
type Tree = { hq: string; depts: string[] }[];
type Scr = { path: string; title: string };
const empty: Form = { login_id: '', name: '', email: '', emp_no: '', dept: '', title: '', grade: '', role: 'user', screen_depts: {}, active: true };
const emptyGroup = (): PermGroup => ({ id: '', name: '', note: '', screen_depts: {}, members: [] });
const ROLE_LABEL: Record<string, string> = { admin: '관리자', all: '전체 보기', user: '일반' };
const HQ_ORDER = ['API사업본부', 'API합성본부', '소재사업본부', '경영전략본부'];
const nrm = (s: unknown) => String(s ?? '').replace(/\s+/g, '').toLowerCase();
const lc = (s: unknown) => String(s ?? '').trim().toLowerCase();
const sig = (l: string[] | undefined) => (l || []).map(nrm).sort().join('|');

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

/** 부서 고르기 — 본부별로 묶어 보여 줌. "본부 전체"를 고르면 본부 이름으로 저장되어 나중에 생기는 부서도 자동으로 포함됩니다. */
function DeptPick({ list, onChange, tree }: { list: string[]; onChange: (l: string[]) => void; tree: Tree }) {
  const has = (x: string) => list.some(v => nrm(v) === nrm(x));
  const deptSet = useMemo(() => new Set(tree.flatMap(h => h.depts.map(nrm))), [tree]);
  const known = useMemo(() => new Set([...tree.map(h => nrm(h.hq)), ...deptSet]), [tree, deptSet]);
  const without = (xs: string[]) => { const rm = new Set(xs.map(nrm)); return list.filter(v => !rm.has(nrm(v))); };
  const unknown = list.filter(v => !known.has(nrm(v)));
  if (!tree.length) return <span className="help">[데이터 올리기]에서 부서 데이터를 먼저 올려 주세요.</span>;
  return (
    <div className="dp">
      {tree.map(h => {
        const tokOk = !deptSet.has(nrm(h.hq));           // 본부 이름과 같은 부서가 있으면 본부 이름으로는 저장하지 않음
        const hqOn = tokOk && has(h.hq);
        const allOn = hqOn || (h.depts.length > 0 && h.depts.every(has));
        const toggleHq = () => {
          if (tokOk) onChange(hqOn ? without([h.hq]) : [...without([h.hq, ...h.depts]), h.hq]);
          else onChange(allOn ? without(h.depts) : [...without(h.depts), ...h.depts]);
        };
        const toggleDept = (d: string) => {
          if (hqOn) onChange([...without([h.hq]), ...h.depts.filter(x => nrm(x) !== nrm(d))]);   // 본부 전체에서 한 부서만 빼기
          else onChange(has(d) ? without([d]) : [...list, d]);
        };
        return (
          <div className="dp-hq" key={h.hq}>
            <button type="button" className={'chip hq' + (allOn ? ' on' : '')} onClick={toggleHq} title={tokOk ? '본부 전체 — 나중에 이 본부에 생기는 부서도 자동으로 포함됩니다' : '이 본부의 부서를 모두 고릅니다'}>{h.hq} 전체</button>
            {h.depts.map(d => <button type="button" key={d} className={'chip' + (hqOn || has(d) ? ' on' : '') + (hqOn ? ' dim' : '')} onClick={() => toggleDept(d)}>{d}</button>)}
          </div>
        );
      })}
      {unknown.length > 0 && <div className="dp-hq"><span className="help" style={{ alignSelf: 'center' }}>부서 목록에 없는 이름</span>{unknown.map(u => <button type="button" key={u} className="chip on" onClick={() => onChange(without([u]))} title="누르면 뺍니다">{u} ×</button>)}</div>}
    </div>
  );
}

/** 화면마다 볼 수 있는 부서 — 보통은 모든 화면에 같은 부서를 주고, 필요할 때만 화면마다 다르게 */
function ScreenDeptPicker({ value, onChange, screens, tree }: { value: ScreenDepts; onChange: (v: ScreenDepts) => void; screens: Scr[]; tree: Tree }) {
  const same = screens.every(s => sig(value[s.path]) === sig(value[screens[0].path]));
  const [per, setPer] = useState(!same);
  const [cur, setCur] = useState(screens[0].path);
  useEffect(() => { if (!same) setPer(true); }, [same]);
  const setAll = (l: string[]) => onChange({ ...value, ...Object.fromEntries(screens.map(s => [s.path, l.slice()])) });
  return (
    <div className="sdp">
      <label className="row" style={{ fontSize: 12.5, gap: 6, color: 'var(--fg-2)' }}>
        <input type="checkbox" checked={per} onChange={e => { if (e.target.checked) setPer(true); else { setAll(value[screens[0].path] || []); setPer(false); } }} />
        화면마다 다르게 정하기 {per && !same && <span className="help">· 끄면 모든 화면이 첫 화면({screens[0].title})과 같아집니다</span>}
      </label>
      {per ? <>
        <div className="seg" style={{ flexWrap: 'wrap' }}>{screens.map(s => <button type="button" key={s.path} className={cur === s.path ? 'on' : ''} onClick={() => setCur(s.path)}>{s.title} <b style={{ fontWeight: 700, color: (value[s.path] || []).length ? 'var(--blue-2)' : 'var(--fg-4)' }}>{(value[s.path] || []).length}</b></button>)}</div>
        <DeptPick list={value[cur] || []} onChange={l => onChange({ ...value, [cur]: l })} tree={tree} />
      </> : <DeptPick list={value[screens[0].path] || []} onChange={setAll} tree={tree} />}
    </div>
  );
}

/** 화면별 부서 요약 (짧게) */
const sdSummary = (sd: ScreenDepts, screens: Scr[]) => {
  const same = screens.every(s => sig(sd[s.path]) === sig(sd[screens[0].path]));
  const first = sd[screens[0].path] || [];
  if (same) return first.length ? first.join(', ') : '없음';
  return screens.filter(s => (sd[s.path] || []).length).map(s => `${s.title}: ${(sd[s.path] || []).join(', ')}`).join(' / ') || '없음';
};

export default function Employees() {
  const { toast, confirm } = useUI();
  const [tab, setTab] = useState<'emp' | 'grp'>('emp');
  const [list, setList] = useState<Employee[]>([]);
  const [groups, setGroups] = useState<PermGroup[]>([]);
  const [tree, setTree] = useState<Tree>([]);
  const [q, setQ] = useState('');
  const [form, setForm] = useState<Form>(empty);
  const [formGroups, setFormGroups] = useState<string[]>([]);   // 편집 중인 사원이 속한 그룹 id
  const [isNew, setIsNew] = useState(true);
  const [gform, setGform] = useState<PermGroup>(emptyGroup());
  const [gq, setGq] = useState('');
  const [poolTick, setPoolTick] = useState(0);   // 구성원 목록을 다시 정렬할 때 (그룹을 고르거나 채울 때만 — 체크하는 동안에는 줄이 움직이지 않게)
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const depts = useMemo(() => tree.flatMap(h => h.depts).sort((a, b) => a.localeCompare(b, 'ko')), [tree]);
  // 부서를 정해 줘야 보이는 화면 (부서 손익을 맨 앞에 — "모든 화면 같게"의 기준)
  const screensUser: Scr[] = useMemo(() => SCREENS.flatMap(g => g.items).filter(i => i.perm).map(i => ({ path: i.path, title: i.title })).sort((a, b) => Number(b.path === '/dept') - Number(a.path === '/dept')), []);

  async function load() {
    const { data } = await supabase.from('employees').select('*').order('dept').order('name');
    setList((data as Employee[]) ?? []);
    const { data: d } = await supabase.from('rows').select('dept_name,data').eq('dataset', 'dept').limit(1000);
    const by: Record<string, Set<string>> = {};
    (d ?? []).forEach(r => { const dn = String(r.dept_name || '').trim(); if (!dn) return; const hq = String((r.data as Record<string, unknown> | null)?.BizUnitName ?? '').trim() || '기타'; (by[hq] = by[hq] || new Set()).add(dn); });
    const rank = (h: string) => { const i = HQ_ORDER.indexOf(h); return i < 0 ? (h === '기타' ? 999 : 99) : i; };
    setTree(Object.keys(by).sort((a, b) => rank(a) - rank(b) || a.localeCompare(b, 'ko')).map(hq => ({ hq, depts: Array.from(by[hq]).sort((a, b) => a.localeCompare(b, 'ko')) })));
    try { setGroups(await loadPermGroups()); } catch { /* 그룹을 못 읽어도 사원 관리는 계속 */ }
  }
  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => list.filter(e => !q || [e.login_id, e.name, e.dept, e.emp_no, e.email].some(v => (v ?? '').toLowerCase().includes(q.toLowerCase()))), [list, q]);
  const nameOf = (id: string) => list.find(e => lc(e.login_id) === lc(id));

  // ── 사원 ──
  // 좁은 화면(목록 아래에 편집 칸)에서는 고른 뒤 편집 칸으로 내려 줌
  const toEditor = () => { if (window.innerWidth <= 1180) setTimeout(() => document.querySelector('.emp .dside')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60); };
  function pick(e: Employee) { setForm({ ...e, screen_depts: e.screen_depts ?? {} }); setFormGroups(groupsOf(groups, e.login_id).map(g => g.id)); setIsNew(false); toEditor(); }
  function reset() { setForm(empty); setFormGroups([]); setIsNew(true); }
  const set = (k: keyof Form, v: unknown) => setForm(f => ({ ...f, [k]: v }));
  /** 사원 한 명의 그룹 소속을 바꾼 새 그룹 목록 (바뀐 게 없으면 null) */
  function withMembership(loginId: string, ids: string[] | null) {
    let changed = false;
    const next = groups.map(g => {
      const inG = g.members.some(m => lc(m) === lc(loginId)); const want = !!ids && ids.includes(g.id);
      if (inG === want) return g;
      changed = true;
      return { ...g, members: want ? [...g.members, loginId] : g.members.filter(m => lc(m) !== lc(loginId)) };
    });
    return changed ? next : null;
  }
  async function save() {
    if (!form.login_id.trim() || !form.name.trim()) return toast('사원 ID와 이름을 넣어 주세요.', 'err');
    setBusy(true);
    try {
      await callAdmin({ action: isNew ? 'create' : 'update', employee: form });
      const next = withMembership(form.login_id, formGroups);
      if (next) { await savePermGroups(next, `${form.name}(${form.login_id}) 권한 그룹 변경`); setGroups(next); }
      toast(isNew ? `${form.name} 님을 등록했습니다. 사원 ID(${form.login_id})로 처음 로그인하면 계정이 만들어집니다.` : `${form.name} 님 정보를 저장했습니다. 바뀐 권한은 그 사원이 다시 들어올 때 적용됩니다.`);
      await load(); if (isNew) reset();
    } catch (e) { toast((e as Error).message, 'err'); } finally { setBusy(false); }
  }
  async function resetPw() {
    if (!(await confirm('비밀번호를 처음 상태로 돌릴까요?', `${form.name} 님의 비밀번호가 사원 ID(${form.login_id})로 돌아가고, 다음 로그인 때 새 비밀번호를 정하게 됩니다.`, { okText: '돌리기' }))) return;
    try { await callAdmin({ action: 'reset_password', login_id: form.login_id }); toast('비밀번호를 처음 상태로 돌렸습니다.'); } catch (e) { toast((e as Error).message, 'err'); }
  }
  async function remove() {
    if (!(await confirm('사원을 지울까요?', `${form.name}(${form.login_id}) 님의 계정과 권한이 지워집니다. 퇴사자는 지우지 말고 '사용 중지'로 두는 것을 권합니다.`, { danger: true }))) return;
    try {
      await callAdmin({ action: 'delete', login_id: form.login_id });
      const next = withMembership(form.login_id, null);
      if (next) { await savePermGroups(next, `${form.name}(${form.login_id}) 삭제 — 권한 그룹에서 뺌`); setGroups(next); }
      toast('지웠습니다.'); reset(); await load();
    } catch (e) { toast((e as Error).message, 'err'); }
  }
  /** 엑셀 일괄 등록: 열 이름 이름 / 이메일 / 사번 / ID / 부서 / 직책 / 직위 (영문 name/email/emp_no/login_id/dept/title/grade 도 인식) */
  async function importExcel(f: File) {
    const wb = XLSX.read(await f.arrayBuffer(), { type: 'array' });
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]], { defval: '' });
    const col = (r: Record<string, unknown>, ...names: string[]) => { for (const k of Object.keys(r)) if (names.some(n => n.toLowerCase() === String(k).trim().toLowerCase())) return String(r[k] ?? '').trim(); return ''; };
    const items = rows.map(r => ({ login_id: col(r, 'ID', '아이디', 'login_id', '사원ID'), name: col(r, '이름', '성명', 'name'), email: col(r, '이메일', 'email'), emp_no: col(r, '사번', 'emp_no'), dept: col(r, '부서', '부서명', 'dept'), title: col(r, '직책', 'title'), grade: col(r, '직위', 'grade'), role: 'user', screen_depts: {}, active: true }))
      .filter(x => x.login_id && x.name);
    if (!items.length) return toast('이름과 ID 열이 있는 줄을 찾지 못했습니다.', 'err');
    const dup = items.filter(x => list.some(e => e.login_id.toLowerCase() === x.login_id.toLowerCase()));
    if (!(await confirm('엑셀로 한꺼번에 등록할까요?', `${items.length}명을 등록합니다.${dup.length ? ` 이미 있는 ${dup.length}명은 이름 · 부서 같은 정보만 새로 바뀌고 권한은 그대로 둡니다.` : ''}`, { okText: '등록' }))) return;
    setBusy(true); let ok = 0;
    try {
      for (const it of items) {
        const prev = list.find(e => e.login_id.toLowerCase() === it.login_id.toLowerCase());
        const { error } = await supabase.rpc('admin_upsert_employee', { p: prev ? { ...it, role: prev.role, screen_depts: prev.screen_depts, active: prev.active } : it });
        if (error) { toast(`${it.name}(${it.login_id}) 실패: ${error.message}`, 'err'); } else ok++;
      }
      toast(`${ok}명을 등록했습니다.`); await load();
    } finally { setBusy(false); if (fileRef.current) fileRef.current.value = ''; }
  }

  // ── 권한 그룹 ──
  const gIsNew = !gform.id;
  function pickGroup(g: PermGroup) { setGform({ ...g, screen_depts: { ...g.screen_depts }, members: g.members.slice() }); setGq(''); setPoolTick(t => t + 1); toEditor(); }
  function resetGroup() { setGform(emptyGroup()); setGq(''); setPoolTick(t => t + 1); }
  /** 부서 이름으로 바로 만들기: 이름 = 부서, 모든 화면에서 그 부서, 구성원 = 그 부서 사원 */
  function prefillDept(d: string) {
    if (!d) return;
    setGform({ id: '', name: d, note: '', screen_depts: Object.fromEntries(screensUser.map(s => [s.path, [d]])), members: list.filter(e => e.active && nrm(e.dept) === nrm(d)).map(e => e.login_id) });
    setPoolTick(t => t + 1);
  }
  async function saveGroup() {
    const name = gform.name.trim();
    if (!name) return toast('그룹 이름을 넣어 주세요.', 'err');
    if (groups.some(g => g.id !== gform.id && nrm(g.name) === nrm(name))) return toast('같은 이름의 그룹이 이미 있습니다.', 'err');
    const sd: ScreenDepts = {}; screensUser.forEach(s => { const l = gform.screen_depts[s.path] || []; if (l.length) sd[s.path] = l; });
    if (!Object.keys(sd).length && !(await confirm('볼 수 있는 부서가 없습니다', '이 그룹에는 볼 수 있는 부서가 하나도 없습니다. 그래도 저장할까요?', { okText: '저장' }))) return;
    const g: PermGroup = { id: gform.id || newGroupId(), name, note: (gform.note || '').trim(), screen_depts: sd, members: Array.from(new Set(gform.members)) };
    const next = gIsNew ? [...groups, g] : groups.map(x => (x.id === g.id ? g : x));
    setBusy(true);
    try { await savePermGroups(next, `권한 그룹 "${name}" ${gIsNew ? '추가' : '수정'} · 구성원 ${g.members.length}명`); setGroups(next); setGform(g); toast(`"${name}" 그룹을 저장했습니다. 구성원이 다시 들어올 때 적용됩니다.`); }
    catch (e) { toast((e as Error).message, 'err'); } finally { setBusy(false); }
  }
  async function removeGroup() {
    if (!(await confirm('그룹을 지울까요?', `"${gform.name}" 그룹을 지웁니다. 구성원 ${gform.members.length}명은 이 그룹으로 받던 권한이 없어지고, 개인 권한은 그대로 남습니다. [변경 이력]에서 되돌릴 수 있습니다.`, { danger: true, okText: '지우기' }))) return;
    const next = groups.filter(x => x.id !== gform.id);
    setBusy(true);
    try { await savePermGroups(next, `권한 그룹 "${gform.name}" 삭제`); setGroups(next); resetGroup(); toast('지웠습니다.'); }
    catch (e) { toast((e as Error).message, 'err'); } finally { setBusy(false); }
  }
  const toggleMember = (id: string) => setGform(g => ({ ...g, members: g.members.some(m => lc(m) === lc(id)) ? g.members.filter(m => lc(m) !== lc(id)) : [...g.members, id] }));
  const memberPool = useMemo(() => list.filter(e => !gq || [e.login_id, e.name, e.dept].some(v => (v ?? '').toLowerCase().includes(gq.toLowerCase())))
    .sort((a, b) => Number(gform.members.some(m => lc(m) === lc(b.login_id))) - Number(gform.members.some(m => lc(m) === lc(a.login_id))) || (a.dept || '').localeCompare(b.dept || '', 'ko') || a.name.localeCompare(b.name, 'ko')), [list, gq, poolTick]); // eslint-disable-line react-hooks/exhaustive-deps
  const staleMembers = gform.members.filter(m => !nameOf(m));

  // 편집 중인 사원의 실제 권한 (그룹 + 개인)
  const selGroups = groups.filter(g => formGroups.includes(g.id));
  const effective = useMemo(() => mergeScreenDepts(form.screen_depts, selGroups), [form.screen_depts, selGroups.map(g => g.id).join('|'), groups]); // eslint-disable-line react-hooks/exhaustive-deps
  const srcOf = (path: string, d: string) => { const own = (form.screen_depts?.[path] || []).some(x => nrm(x) === nrm(d)); const gs = selGroups.filter(g => (g.screen_depts[path] || []).some(x => nrm(x) === nrm(d))).map(g => g.name); return { own, gs }; };

  return (
    <div className="page emp">
      <style>{`
        .emp .dp{display:grid;gap:8px;border:1px solid var(--line);border-radius:10px;padding:10px;max-height:300px;overflow:auto;background:var(--surface)}
        .emp .dp-hq{display:flex;flex-wrap:wrap;gap:4px}
        .emp .dp .chip{cursor:pointer;font-family:inherit}
        .emp .dp .chip:hover{border-color:var(--blue)}
        .emp .dp .chip.hq{font-weight:700;color:var(--fg);background:var(--surface-2)}
        .emp .dp .chip.hq.on{background:var(--blue);border-color:var(--blue);color:#fff}
        .emp .dp .chip.dim{opacity:.6}
        .emp .sdp{display:grid;gap:8px}
        .emp .gsel{display:flex;flex-wrap:wrap;gap:5px}
        .emp .gsel .chip{cursor:pointer;font-family:inherit}
        .emp .eff{display:grid;gap:6px;background:var(--surface-2);border-radius:10px;padding:10px 12px;font-size:12.5px}
        .emp .eff>div{display:grid;grid-template-columns:78px minmax(0,1fr);gap:8px;align-items:start}
        .emp .eff b{font-weight:600;color:var(--fg-2);padding-top:2px}
        .emp .eff span.ts{display:flex;flex-wrap:wrap;gap:4px}
        .emp .mem{border:1px solid var(--line);border-radius:10px;max-height:260px;overflow:auto}
        .emp .mem label{display:grid;grid-template-columns:18px minmax(0,1fr) auto;gap:8px;align-items:center;padding:6px 10px;font-size:13px;border-bottom:1px solid var(--line);cursor:pointer}
        .emp .mem label:last-child{border-bottom:0}
        .emp .mem label:hover{background:var(--surface-2)}
        .emp .mem label.on{background:var(--blue-soft)}
        .emp .mem small{color:var(--fg-3);margin-left:6px}
        .emp .drawer{grid-template-columns:minmax(0,1fr) 460px}
        .emp .gcell{max-width:340px;white-space:normal;color:var(--fg-2);font-size:12.5px;line-height:1.5}
        .emp .dside{scroll-margin-top:calc(var(--top-h) + 10px)}
        .emp .dside .acts{position:sticky;bottom:0;background:var(--surface);margin:0 -16px -16px;padding:12px 16px;border-top:1px solid var(--line);z-index:2;border-radius:0 0 var(--r,14px) var(--r,14px)}
        @media(max-width:1180px){.emp .drawer{grid-template-columns:1fr}.emp .drawer>.dside{position:static;max-height:none;overflow:visible}}
      `}</style>
      <div className="page-head">
        <div><h1>사원 · 권한</h1><div className="help">사원을 등록하고, 누가 어떤 화면에서 어느 부서를 볼지 정합니다. 실제 권한 = 권한 그룹 + 개인 권한.</div></div>
        <span className="sp" />
        {tab === 'emp' ? <><button className="btn" onClick={() => fileRef.current?.click()} disabled={busy}>엑셀로 한꺼번에 등록</button><input ref={fileRef} id="emp-file" type="file" accept=".xlsx,.xls,.csv" hidden onChange={e => { const f = e.target.files?.[0]; if (f) importExcel(f); }} /><button className="btn pri" onClick={() => { reset(); toEditor(); }}>+ 사원 추가</button></>
          : <button className="btn pri" onClick={() => { resetGroup(); toEditor(); }}>+ 그룹 추가</button>}
      </div>
      <div className="filters">
        <span className="seg"><button className={tab === 'emp' ? 'on' : ''} onClick={() => setTab('emp')}>사원 {list.length}</button><button className={tab === 'grp' ? 'on' : ''} onClick={() => setTab('grp')}>권한 그룹 {groups.length}</button></span>
        {tab === 'emp' ? <><input id="emp-q" className="inp grow" style={{ maxWidth: 320 }} placeholder="이름 · ID · 부서 · 사번 찾기" value={q} onChange={e => setQ(e.target.value)} /><span className="help">사용 중 {list.filter(e => e.active).length}명</span></>
          : <span className="help">같은 권한을 여러 사람에게 줄 때 씁니다. 그룹을 고치면 구성원 모두에게 한 번에 적용됩니다.</span>}
      </div>

      {tab === 'emp' && (
        <div className="drawer">
          <div className="card"><div className="tbl-wrap"><table className="tbl"><thead><tr><th>이름</th><th>사원 ID</th><th>부서</th><th>직책</th><th>역할</th><th>권한 그룹</th><th>상태</th></tr></thead>
            <tbody>{filtered.map(e => { const gs = groupsOf(groups, e.login_id); return <tr key={e.id} className={form.id === e.id ? 'sel' : ''} onClick={() => pick(e)} style={{ cursor: 'pointer' }}>
              <td><b>{e.name}</b></td><td>{e.login_id}</td><td>{e.dept}</td><td>{e.title}</td>
              <td><span className={'tag ' + (e.role === 'admin' ? 'o' : e.role === 'all' ? 'b' : 'gr')}>{ROLE_LABEL[e.role]}</span></td>
              <td>{e.role !== 'user' ? <span className="mut">-</span> : gs.length ? <span className="row" style={{ gap: 4 }}>{gs.map(g => <span key={g.id} className="tag b">{g.name}</span>)}</span> : Object.values(e.screen_depts || {}).some(l => (l || []).length) ? <span className="help">개인 권한만</span> : <span className="tag y">권한 없음</span>}</td>
              <td>{!e.active ? <span className="tag n">사용 중지</span> : !e.auth_uid ? <span className="tag gr">아직 로그인 안 함</span> : e.must_change_pw ? <span className="tag y">첫 비밀번호</span> : <span className="tag g">사용 중</span>}</td></tr>; })}
              {filtered.length === 0 && <tr><td colSpan={7} className="empty">사원이 없습니다. 오른쪽에서 추가해 주세요.</td></tr>}</tbody></table></div></div>

          <div className="card dside"><div className="hd">{isNew ? '사원 추가' : '사원 정보'}<span className="sp" />{!isNew && <span className="help">등록 {form.created_at ? kst(form.created_at).slice(0, 12) : ''}</span>}</div>
            <div className="bd">
              <div className="two" style={{ gap: 10 }}>
                <div className="field"><label htmlFor="e-name">이름 *</label><input id="e-name" className="inp" value={form.name} onChange={e => set('name', e.target.value)} /></div>
                <div className="field"><label htmlFor="e-id">사원 ID * {isNew && <span className="help">(첫 비밀번호로도 씀)</span>}</label><input id="e-id" className="inp" value={form.login_id} disabled={!isNew} onChange={e => set('login_id', e.target.value.trim())} /></div>
                <div className="field"><label htmlFor="e-no">사번</label><input id="e-no" className="inp" value={form.emp_no ?? ''} onChange={e => set('emp_no', e.target.value)} /></div>
                <div className="field"><label htmlFor="e-mail">이메일</label><input id="e-mail" className="inp" value={form.email ?? ''} onChange={e => set('email', e.target.value)} /></div>
                <div className="field"><label htmlFor="e-dept">부서</label><input id="e-dept" className="inp" list="dept-list" value={form.dept ?? ''} onChange={e => set('dept', e.target.value)} /><datalist id="dept-list">{depts.map(d => <option key={d} value={d} />)}</datalist></div>
                <div className="field"><label htmlFor="e-title">직책</label><input id="e-title" className="inp" value={form.title ?? ''} onChange={e => set('title', e.target.value)} /></div>
                <div className="field"><label htmlFor="e-grade">직위</label><input id="e-grade" className="inp" value={form.grade ?? ''} onChange={e => set('grade', e.target.value)} /></div>
                <div className="field"><label htmlFor="e-role">역할</label><select id="e-role" className="inp" value={form.role} onChange={e => set('role', e.target.value)}><option value="user">일반 — 정해 준 부서만 봄</option><option value="all">전체 보기 — 경영 화면과 모든 부서</option><option value="admin">관리자 — 모두 보고 설정도 바꿈</option></select></div>
              </div>
              {form.role === 'user' ? <>
                <div className="field"><label>권한 그룹 <span className="help">고른 그룹이 볼 수 있는 부서를 함께 봅니다</span></label>
                  {groups.length ? <div className="gsel">{groups.map(g => <button type="button" key={g.id} className={'chip' + (formGroups.includes(g.id) ? ' on' : '')} title={sdSummary(g.screen_depts, screensUser)} onClick={() => setFormGroups(ids => (ids.includes(g.id) ? ids.filter(x => x !== g.id) : [...ids, g.id]))}>{g.name}</button>)}</div>
                    : <span className="help">아직 그룹이 없습니다. <button type="button" className="btn sm ghost" onClick={() => setTab('grp')}>권한 그룹 만들기 →</button></span>}
                </div>
                <div className="field"><label>개인 권한 <span className="help">이 사람에게만 더 줄 부서 (그룹 권한에 더해집니다)</span></label>
                  <ScreenDeptPicker key={form.id ?? 'new'} value={form.screen_depts ?? {}} onChange={v => set('screen_depts', v)} screens={screensUser} tree={tree} />
                </div>
                <div className="field"><label>실제로 볼 수 있는 부서 <span className="help"><span className="tag b">파랑</span> 그룹 · <span className="tag gr">회색</span> 개인</span></label>
                  <div className="eff">{screensUser.map(s => { const l = effective[s.path] || []; return (
                    <div key={s.path}><b>{s.title}</b><span className="ts">{l.length ? l.map(d => { const src = srcOf(s.path, d); return <span key={d} className={'tag ' + (src.gs.length ? 'b' : 'gr')} title={[src.gs.length ? '그룹: ' + src.gs.join(', ') : '', src.own ? '개인 권한' : ''].filter(Boolean).join(' · ')}>{d}</span>; }) : <span className="help">볼 수 없음 · 메뉴에 나오지 않습니다</span>}</span></div>); })}
                  </div>
                </div>
              </> : <div className="help">{form.role === 'admin' ? '관리자는 모든 화면과 부서를 보고 설정을 바꿀 수 있습니다.' : '전체 보기는 경영 화면을 포함해 모든 부서를 볼 수 있습니다. 설정은 바꿀 수 없습니다.'}</div>}
              {!isNew && <label className="row" style={{ fontSize: 13 }}><input type="checkbox" id="e-active" checked={form.active ?? true} onChange={e => set('active', e.target.checked)} /> 사용 중 (끄면 로그인할 수 없음)</label>}
              <div className="row acts" style={{ justifyContent: 'space-between' }}>
                <span className="row">{!isNew && <><button className="btn sm" onClick={resetPw}>비밀번호 처음으로</button><button className="btn sm danger" onClick={remove}>지우기</button></>}</span>
                <span className="row"><button className="btn ghost" onClick={reset}>취소</button><button className="btn pri" disabled={busy} onClick={save}>{busy ? <span className="spinner" /> : isNew ? '등록' : '저장'}</button></span>
              </div>
            </div></div>
        </div>
      )}

      {tab === 'grp' && (
        <div className="drawer">
          <div className="card"><div className="tbl-wrap"><table className="tbl"><thead><tr><th>그룹</th><th>구성원</th><th>볼 수 있는 부서</th></tr></thead>
            <tbody>{groups.map(g => <tr key={g.id} className={gform.id === g.id ? 'sel' : ''} onClick={() => pickGroup(g)} style={{ cursor: 'pointer' }}>
              <td><b>{g.name}</b>{g.note && <div className="help">{g.note}</div>}</td>
              <td style={{ whiteSpace: 'nowrap' }}>{g.members.length}명</td>
              <td className="gcell">{sdSummary(g.screen_depts, screensUser)}</td></tr>)}
              {groups.length === 0 && <tr><td colSpan={3} className="empty">아직 그룹이 없습니다. 오른쪽에서 만들어 주세요. 부서를 고르면 이름 · 부서 · 구성원이 한 번에 채워집니다.</td></tr>}</tbody></table></div></div>

          <div className="card dside"><div className="hd">{gIsNew ? '그룹 추가' : '그룹 정보'}</div>
            <div className="bd">
              {gIsNew && <div className="field"><label htmlFor="g-pre">부서로 바로 만들기 <span className="help">이름 · 볼 수 있는 부서 · 구성원을 채워 줍니다</span></label>
                <select id="g-pre" className="inp" value="" onChange={e => prefillDept(e.target.value)}><option value="">부서 고르기</option>{tree.map(h => <optgroup key={h.hq} label={h.hq}>{h.depts.map(d => <option key={d} value={d}>{d}</option>)}</optgroup>)}</select></div>}
              <div className="two" style={{ gap: 10 }}>
                <div className="field"><label htmlFor="g-name">그룹 이름 *</label><input id="g-name" className="inp" value={gform.name} onChange={e => setGform(g => ({ ...g, name: e.target.value }))} placeholder="예: 글로벌구매팀" /></div>
                <div className="field"><label htmlFor="g-note">설명</label><input id="g-note" className="inp" value={gform.note ?? ''} onChange={e => setGform(g => ({ ...g, note: e.target.value }))} placeholder="안 써도 됩니다" /></div>
              </div>
              <div className="field"><label>볼 수 있는 부서</label>
                <ScreenDeptPicker key={gform.id || 'new:' + gform.name} value={gform.screen_depts} onChange={v => setGform(g => ({ ...g, screen_depts: v }))} screens={screensUser} tree={tree} />
              </div>
              <div className="field"><label>구성원 <b style={{ color: 'var(--blue-2)' }}>{gform.members.length}명</b> <span className="help">역할이 "일반"인 사원에게만 의미가 있습니다</span></label>
                <input className="inp" placeholder="이름 · ID · 부서 찾기" value={gq} onChange={e => setGq(e.target.value)} />
                <div className="mem">
                  {memberPool.map(e => { const on = gform.members.some(m => lc(m) === lc(e.login_id)); return (
                    <label key={e.id} className={on ? 'on' : ''}><input type="checkbox" checked={on} onChange={() => toggleMember(e.login_id)} /><span><b>{e.name}</b><small>{e.dept} · {e.login_id}</small></span>{e.role !== 'user' ? <span className="tag gr">{ROLE_LABEL[e.role]}</span> : !e.active ? <span className="tag n">사용 중지</span> : <span />}</label>); })}
                  {!memberPool.length && <div className="empty" style={{ padding: 14 }}>맞는 사원이 없습니다.</div>}
                </div>
                {staleMembers.length > 0 && <div className="help">지금은 없는 사원 ID: {staleMembers.map(m => <button type="button" key={m} className="chip" style={{ marginLeft: 4, cursor: 'pointer' }} onClick={() => toggleMember(m)} title="누르면 그룹에서 뺍니다">{m} ×</button>)}</div>}
              </div>
              <div className="row acts" style={{ justifyContent: 'space-between' }}>
                <span className="row">{!gIsNew && <><button className="btn sm" onClick={() => setGform(g => ({ ...g, id: '', name: g.name + ' 복사', members: [] }))} title="같은 부서 설정으로 새 그룹을 만듭니다">복사해서 새로</button><button className="btn sm danger" onClick={removeGroup} disabled={busy}>지우기</button></>}</span>
                <span className="row"><button className="btn ghost" onClick={resetGroup}>취소</button><button className="btn pri" disabled={busy} onClick={saveGroup}>{busy ? <span className="spinner" /> : gIsNew ? '그룹 만들기' : '저장'}</button></span>
              </div>
            </div></div>
        </div>
      )}
    </div>
  );
}
