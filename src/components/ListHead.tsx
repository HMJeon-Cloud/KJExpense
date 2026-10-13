// 목록형(막대·순위) 표의 머리글 한 줄 — 각 칸이 무엇인지 표시
//   <ListHead cls="toprow" cols={['', '부서', '', '>비용', '>전월비']} />
//   '>' 로 시작하면 오른쪽 정렬
export function ListHead({ cls, cols, style }: { cls: string; cols: string[]; style?: React.CSSProperties }) {
  return (
    <div className={cls + ' lh'} style={style} aria-hidden="false">
      {cols.map((c, i) => <span key={i} style={c.startsWith('>') ? { textAlign: 'right' } : undefined}>{c.replace(/^>/, '')}</span>)}
    </div>
  );
}
