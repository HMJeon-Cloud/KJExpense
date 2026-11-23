import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useUI, kst } from '../components/ui';

const KEY_LABEL: Record<string, string> = { groups: '배분 비율', items: '품목 · 자재 판매가', support: '지원 내역 설정', closeMonth: '마감월', costAlloc: '본부 비용 배분', fixedCost: '고정비 기준', fxBase: '회사 기준 환율', plStmt: '손익계산서', permGroups: '권한 그룹' };
type H = { id: number; key: string; summary: string | null; changed_by: string | null; created_at: string };
type L = { id: number; kind: string; actor: string | null; action: string | null; target: string | null; ok: boolean; created_at: string; detail: unknown };

export default function History() {
  const { toast, confirm } = useUI();
  const [hist, setHist] = useState<H[]>([]);
  const [logs, setLogs] = useState<L[]>([]);
  const [kind, setKind] = useState('all');
  async function load() {
    const [{ data: h }, { data: l }] = await Promise.all([
      supabase.from('config_history').select('id,key,summary,changed_by,created_at').order('created_at', { ascending: false }).limit(100),
      supabase.from('logs').select('*').order('created_at', { ascending: false }).limit(300),
    ]);
    setHist((h as H[]) ?? []); setLogs((l as L[]) ?? []);
  }
  useEffect(() => { load(); }, []);
  async function restore(h: H) {
    if (!(await confirm('이때로 되돌릴까요?', `${KEY_LABEL[h.key] ?? h.key}을(를) ${kst(h.created_at)}에 저장하기 직전 값으로 되돌립니다. 지금 값도 이력에 남습니다.`, { okText: '되돌리기' }))) return;
    const { error } = await supabase.rpc('restore_config', { p_history_id: h.id });
    if (error) toast(error.message, 'err'); else { toast('되돌렸습니다.'); load(); }
  }
  const shown = logs.filter(l => kind === 'all' || l.kind === kind);
  return (
    <div className="page">
      <div className="page-head"><div><h1>변경 이력</h1><div className="help">설정을 누가 언제 바꿨는지 보고, 필요하면 그때 값으로 되돌립니다.</div></div><span className="sp" /><button className="btn sm ghost" onClick={load}>다시 불러오기</button></div>
      <div className="two">
        <div className="card"><div className="hd">설정을 바꾼 기록 <span className="help" style={{ fontWeight: 400 }}>최근 100건</span></div>
          <div className="tbl-wrap" style={{ maxHeight: 520 }}><table className="tbl"><thead><tr><th>때</th><th>설정</th><th>내용</th><th>바꾼 사람</th><th></th></tr></thead>
            <tbody>{hist.map(h => <tr key={h.id}><td className="help">{kst(h.created_at)}</td><td><span className="tag b">{KEY_LABEL[h.key] ?? h.key}</span></td><td style={{ whiteSpace: 'normal' }}>{h.summary}</td><td>{h.changed_by}</td><td><button className="btn sm" onClick={() => restore(h)}>되돌리기</button></td></tr>)}
              {hist.length === 0 && <tr><td colSpan={5} className="empty">아직 기록이 없습니다.</td></tr>}</tbody></table></div></div>
        <div className="card"><div className="hd">사용 기록 <span className="sp" /><span className="seg">{['all', 'access', 'config', 'upload', 'employee'].map(k => <button key={k} className={kind === k ? 'on' : ''} onClick={() => setKind(k)}>{{ all: '전체', access: '로그인', config: '설정', upload: '데이터 올리기', employee: '사원' }[k]}</button>)}</span></div>
          <div className="tbl-wrap" style={{ maxHeight: 520 }}><table className="tbl"><thead><tr><th>때</th><th>구분</th><th>사용자</th><th>한 일</th><th>대상</th><th>결과</th></tr></thead>
            <tbody>{shown.map(l => <tr key={l.id}><td className="help">{kst(l.created_at)}</td><td><span className="tag gr">{l.kind}</span></td><td>{l.actor}</td><td>{l.action}</td><td className="help">{l.target ?? (l.detail ? JSON.stringify(l.detail).slice(0, 60) : '')}</td><td>{l.ok ? <span className="tag g">성공</span> : <span className="tag n">실패</span>}</td></tr>)}</tbody></table></div></div>
      </div>
    </div>
  );
}
