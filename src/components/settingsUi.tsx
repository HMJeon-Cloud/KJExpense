// 설정 화면 공통 조각 — 기준월 선택, 저장 막대(미저장 표시·메시지), 작은 도우미
import { useEffect, useState, type ReactNode } from 'react';
import { ymLabel } from '../lib/legacyData';
import { onMeta } from '../legacy/hub';

export type Msg = { text: string; cls: string };
/** 기존 설정 모듈의 상태 변화(kjhub:cfg)와 데이터 갱신에 맞춰 다시 그리기 */
export function useCfgTick(part: string) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const h = (e: Event) => { const d = (e as CustomEvent).detail; if (!d || !d.part || d.part === part) setTick(t => t + 1); };
    const any = () => setTick(t => t + 1);
    window.addEventListener('kjhub:cfg', h); window.addEventListener('kjhub:data', any); window.addEventListener('kjhub:results', any); window.addEventListener('kjhub:itemalloc', any); window.addEventListener('kjsupport:ready', any); window.addEventListener('kjhub:closemonth', any);
    const offMeta = onMeta(any);   // 데이터가 도착하면 다시 그림 (kjhub:data 는 계산 모듈용이라 안 올 수 있음)
    return () => { offMeta(); window.removeEventListener('kjhub:cfg', h); window.removeEventListener('kjhub:data', any); window.removeEventListener('kjhub:results', any); window.removeEventListener('kjhub:itemalloc', any); window.removeEventListener('kjsupport:ready', any); window.removeEventListener('kjhub:closemonth', any); };
  }, [part]);
  return tick;
}

export function MonthPick({ value, options, onChange, label = '기준월' }: { value: string; options: string[]; onChange: (m: string) => void; label?: string }) {
  const i = options.indexOf(value);
  return (
    <span className="row" style={{ gap: 6 }}>
      <span className="help">{label}</span>
      <span className="monthnav">
        <button onClick={() => i >= 0 && i < options.length - 1 && onChange(options[i + 1])} disabled={i < 0 || i >= options.length - 1} aria-label="이전 달">‹</button>
        <select value={value} onChange={e => onChange(e.target.value)} aria-label={label}>{(i < 0 && value ? [value, ...options] : options).map(m => <option key={m} value={m}>{ymLabel(m)}</option>)}</select>
        <button onClick={() => i > 0 && onChange(options[i - 1])} disabled={i <= 0} aria-label="다음 달">›</button>
      </span>
    </span>
  );
}

export function SaveBar({ dirty, saving, msg, onSave, onRevert, saveLabel = '저장', note, children }: { dirty: boolean; saving?: boolean; msg?: Msg; onSave: () => void; onRevert: () => void; saveLabel?: string; note?: ReactNode; children?: ReactNode }) {
  return (
    <div className="savebar" style={{ position: 'sticky', bottom: 0, zIndex: 5, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', padding: '10px 16px', background: dirty ? '#fffaeb' : 'var(--surface)', border: '1px solid ' + (dirty ? 'var(--amber)' : 'var(--line)'), borderRadius: 14, boxShadow: '0 -6px 20px rgba(15,23,42,.06)' }}>
      {dirty ? <span className="tag y" style={{ fontWeight: 700 }}>아직 저장 전</span> : <span className="tag gr">저장됨</span>}
      {note && <span className="help">{note}</span>}
      {msg?.text && <span className="help" style={{ color: msg.cls === 'neg' ? 'var(--neg)' : msg.cls === 'pos' ? '#167a3a' : undefined }}>{msg.text}</span>}
      <span className="sp" />
      {children}
      <button className="btn" onClick={onRevert} disabled={!dirty || saving}>되돌리기</button>
      <button className="btn pri" onClick={onSave} disabled={saving}>{saving ? '저장하는 중' : saveLabel}</button>
    </div>
  );
}

/** 숫자 입력: 쉼표 표시, Enter 로 다음 칸 이동, 빈값 = null */
export function NumCell({ value, onCommit, placeholder, title, width = 110, disabled, hint }: { value: number | null; onCommit: (v: number | null) => void; placeholder?: string; title?: string; width?: number; disabled?: boolean; hint?: string }) {
  const fmtV = (v: number | null) => (v == null ? '' : v.toLocaleString('ko-KR', { maximumFractionDigits: 4 }));
  const [txt, setTxt] = useState(fmtV(value));
  const [focus, setFocus] = useState(false);
  useEffect(() => { if (!focus) setTxt(fmtV(value)); }, [value, focus]);
  const commit = () => { const n = txt.trim() === '' ? null : Number(txt.replace(/,/g, '')); if (n !== null && !isFinite(n)) { setTxt(fmtV(value)); return; } if (n !== value) onCommit(n); else setTxt(fmtV(value)); };
  return (
    <input className="inp num" inputMode="decimal" disabled={disabled} title={title} placeholder={placeholder} value={txt} style={{ width, textAlign: 'right', fontFamily: 'var(--font-num)', background: disabled ? 'var(--surface-2)' : value == null ? '#fffdf5' : undefined }}
      onFocus={e => { setFocus(true); setTxt(value == null ? '' : String(value)); setTimeout(() => e.target.select(), 0); }}
      onChange={e => setTxt(e.target.value.replace(/[^0-9.\-]/g, ''))} onBlur={() => { setFocus(false); commit(); }}
      onKeyDown={e => { if (e.key === 'Enter') { const all = Array.from(document.querySelectorAll<HTMLInputElement>('input.inp.num:not([disabled])')); const i = all.indexOf(e.currentTarget); if (i >= 0 && all[i + 1]) all[i + 1].focus(); else e.currentTarget.blur(); } }}
      data-hint={hint} />
  );
}
