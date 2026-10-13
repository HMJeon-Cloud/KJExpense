// 도움말 — 표·그래프 제목 옆의 작은 (?) 를 누르면 "무엇을 · 어디서 · 어떻게 계산" 창이 뜹니다.
//   <HelpDot id="trade.verdict" />   ·   기존 화면(legacy)에서는 window.KJHub.openHelp('id')
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { HELP } from '../lib/helpDocs';
import { useAuth } from '../lib/auth';

const EVT = 'kjhub:help';
export function openHelp(id: string) { window.dispatchEvent(new CustomEvent(EVT, { detail: { id } })); }

export function HelpDot({ id, style }: { id: string; style?: React.CSSProperties }) {
  if (!HELP[id]) return null;
  return (
    <button type="button" className="helpdot" aria-label={'도움말: ' + HELP[id].title} title="이 값은 어떻게 계산되나요?"
      onClick={e => { e.stopPropagation(); openHelp(id); }} style={style}>?</button>
  );
}

/** 앱에 한 번만 두는 도움말 창 */
export function HelpHost() {
  const [id, setId] = useState<string | null>(null);
  const nav = useNavigate();
  const { employee } = useAuth();
  const isAdmin = employee?.role === 'admin';
  useEffect(() => {
    const h = (e: Event) => setId((e as CustomEvent).detail?.id ?? null);
    window.addEventListener(EVT, h);
    const w = window as unknown as { KJHub?: Record<string, unknown> };
    w.KJHub = w.KJHub || {}; w.KJHub.openHelp = openHelp; // 기존 화면(구매/판매 LOT 상세)에서 사용
    return () => window.removeEventListener(EVT, h);
  }, []);
  useEffect(() => {
    if (!id) return;
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') setId(null); };
    document.addEventListener('keydown', k); return () => document.removeEventListener('keydown', k);
  }, [id]);
  const d = id ? HELP[id] : null;
  return (
    <>
      <style>{`
        .helpdot{display:inline-flex;align-items:center;justify-content:center;width:17px;height:17px;border-radius:999px;border:1px solid var(--line-2);background:var(--surface);color:var(--fg-3);font:700 11px/1 var(--font-num);cursor:pointer;padding:0;margin-left:6px;vertical-align:middle;flex:none;transition:all .12s}
        .helpdot:hover{border-color:var(--brand);color:var(--brand);background:var(--brand-soft)}
        .hlp-ov{position:fixed;inset:0;z-index:200;background:rgba(15,23,42,.38);display:flex;align-items:flex-start;justify-content:center;padding:6vh 16px;overflow:auto}
        .hlp{width:100%;max-width:680px;background:var(--surface);border-radius:14px;box-shadow:0 20px 50px rgba(0,0,0,.2);overflow:hidden}
        .hlp-hd{display:flex;gap:10px;align-items:center;padding:16px 20px;border-bottom:1px solid var(--line);background:var(--surface-2)}
        .hlp-hd h3{margin:0;font-size:16px;font-weight:700}
        .hlp-hd .x{margin-left:auto;border:0;background:transparent;font-size:20px;line-height:1;color:var(--fg-3);cursor:pointer;padding:2px 6px;border-radius:6px}
        .hlp-hd .x:hover{background:var(--line)}
        .hlp-bd{padding:16px 20px 20px;display:grid;gap:16px;font-size:13.5px;line-height:1.6}
        .hlp-sec h4{margin:0 0 6px;font-size:12px;font-weight:700;color:var(--brand);letter-spacing:.02em}
        .hlp-src{width:100%;border-collapse:collapse;font-size:12.5px}
        .hlp-src td{padding:6px 8px;border-bottom:1px solid var(--line);vertical-align:top}
        .hlp-src td:first-child{white-space:nowrap;font-weight:600;width:1%}
        .hlp-src td:last-child{color:var(--fg-2)}
        .hlp-calc{margin:0;padding:10px 12px;background:var(--surface-2);border-radius:8px;display:grid;gap:4px;font-size:12.5px}
        .hlp-calc div{white-space:pre-wrap}
        .hlp-notes{margin:0;padding-left:18px;list-style:disc;color:var(--fg-2);font-size:12.5px;display:grid;gap:3px}
        .hlp-rel{display:flex;gap:6px;flex-wrap:wrap}
      `}</style>
      {d && (
        <div className="hlp-ov" onMouseDown={e => { if (e.target === e.currentTarget) setId(null); }}>
          <div className="hlp" role="dialog" aria-modal="true" aria-label={d.title}>
            <div className="hlp-hd"><span className="helpdot" style={{ margin: 0, cursor: 'default' }}>?</span><h3>{d.title}</h3><button className="x" onClick={() => setId(null)} aria-label="닫기">×</button></div>
            <div className="hlp-bd">
              <div className="hlp-sec"><h4>무엇을 보여주나</h4><div>{d.what}</div></div>
              <div className="hlp-sec"><h4>데이터 출처</h4>
                <table className="hlp-src"><tbody>{d.sources.map((s, i) => <tr key={i}><td>{s.ds}</td><td>{s.cols}</td></tr>)}</tbody></table>
              </div>
              <div className="hlp-sec"><h4>계산식</h4><div className="hlp-calc">{d.calc.map((c, i) => <div key={i}>{c.startsWith('  ') ? c : '• ' + c}</div>)}</div></div>
              {d.notes && d.notes.length > 0 && <div className="hlp-sec"><h4>기준 · 주의</h4><ul className="hlp-notes">{d.notes.map((n, i) => <li key={i}>{n}</li>)}</ul></div>}
              {d.related && d.related.length > 0 && (isAdmin || d.related.some(r => !r.path.startsWith('/settings'))) && <div className="hlp-sec"><h4>관련 화면</h4><div className="hlp-rel">{d.related.filter(r => isAdmin || !r.path.startsWith('/settings')).map(r => <button key={r.path} className="btn sm" onClick={() => { setId(null); nav(r.path); }}>{r.label} →</button>)}</div></div>}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
