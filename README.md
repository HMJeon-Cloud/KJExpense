# 국전 비용 현황 — GitHub + Supabase 버전

기존 Apps Script 대시보드를 **GitHub Pages(화면) + Supabase 무료 플랜(DB·로그인)** 구조로 옮긴 프로젝트입니다.

```
kjhub/
├─ src/                 React + TypeScript 화면 (Vite)
│  ├─ lib/supabase.ts   Supabase 클라이언트, 데이터셋 정의
│  ├─ lib/auth.tsx      사원 ID 로그인 · 최초 비밀번호 변경
│  ├─ components/       레이아웃(탭·드롭다운), 토스트·확인창
│  ├─ pages/            로그인 / 데이터 업로드 / 사원 관리 / 변경 이력·복구
│  └─ legacy/           기존 조회·설정 화면 (Apps Script 판 그대로) + Supabase 연결 셸(hub.js)·서버 함수 셈(gsShim.js)
├─ supabase/
│  ├─ migrations/0001_schema.sql        테이블·RLS·함수 (SQL Editor 에서 실행)
│  └─ migrations/0002_login.sql         최초 관리자·첫 로그인 계정 생성·초기화·삭제 함수
├─ .github/workflows/   Pages 배포, Supabase 일시정지 방지(keep-alive)
├─ backup-repo/         ★ 별도 비공개 저장소에 올릴 주간 백업 워크플로
└─ legacy/exportAllConfig.gs  기존 Apps Script 설정 내보내기
```

## 0. 준비물
- GitHub 계정, Supabase 계정 (둘 다 무료)
- (선택) PC 에 Node.js 20+ — 로컬에서 띄워볼 때만 필요. 배포는 GitHub 이 대신 빌드합니다.

## 1. Supabase 프로젝트 만들기 (DB 서버, 한 번만)
1. https://supabase.com → New project → 이름 `kjhub`, Region **Northeast Asia (Seoul)**, DB 비밀번호는 따로 보관(백업용)
2. **SQL Editor** → `supabase/migrations/0001_schema.sql` 붙여넣기 → Run → 이어서 `0002_login.sql` 도 Run
   - 최초 관리자 이메일은 `0002_login.sql` 맨 위 `bootstrap_admin_email()` 에 `hmjeon@kukjeon.co.kr` 로 들어 있음
3. **Authentication > Providers > Email**: *Allow new users to sign up* 켜기, *Confirm email* 끄기
4. **Project Settings > API** 에서 `Project URL`, `anon public` 키 복사 → 3단계 secrets 에 사용

## 2. 로그인 흐름 (설정할 것 없음)
- 사원정보 입력(사원 관리 화면 또는 엑셀 일괄 등록) → 로그인 ID = 사원 ID, 초기 비밀번호 = 사원 ID
- 사원이 처음 로그인하면 그때 계정이 자동 생성되고, 비밀번호 변경 화면으로 이동
- 사원정보가 하나도 없을 때 사이트에 접속하면 **최초 설정** 화면이 나오고, 지정된 이메일(`hmjeon@kukjeon.co.kr`)로 본인을 등록하면 관리자로 시작
- 관리자 권한은 사원 관리 화면에서 부여/해제 (최초 관리자 이메일은 항상 관리자)

## 3. GitHub 저장소 + 배포
1. 새 저장소 `kjhub` 생성 (**Public** — GitHub Pages 무료 플랜 조건. 코드에 비밀값은 없고 anon 키는 원래 공개용이며 데이터는 RLS 로 보호됨)
   - 코드까지 비공개로 두고 싶으면: Private 저장소 + **Cloudflare Pages** 연결(무료, 빌드 명령 `npm run build`, 출력 `dist`, 환경변수 동일, `VITE_BASE=/`)
2. 이 폴더를 push
   ```bash
   git init && git add -A && git commit -m "init" && git branch -M main
   git remote add origin https://github.com/<계정>/kjhub.git && git push -u origin main
   ```
3. Settings > **Secrets and variables > Actions** → `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` 등록
4. Settings > **Pages** → Source: *GitHub Actions*
5. Actions 탭에서 *Deploy to GitHub Pages* 가 성공하면 `https://<계정>.github.io/kjhub/` 접속 → **최초 설정** 화면에서 본인 등록

## 4. 백업 (비공개 저장소)
`backup-repo/README.md` 대로 **별도 Private 저장소**를 만들어 주간 pg_dump 백업을 돌립니다.

## 5. 데이터 이관 (최초 1회)
1. 기존 Apps Script 편집기에 `legacy/exportAllConfig.gs` 내용을 추가 → `exportAllConfig` 실행 → Drive 의 `kjhub_config.json` 열어 내용 복사
2. 새 화면 로그인 → 설정 > **데이터 업로드** > *3. 기존 설정 가져오기* 에 붙여넣기 → 가져오기
3. 구글 시트 11개를 각각 **파일 > 다운로드 > Excel(.xlsx)** 로 받아 *1. 파일 선택* 에서 데이터 종류를 고르고 **전체 교체** 로 업로드
   - 부서·생산계획·LOT별 재고는 "전체 스냅샷"이라 항상 전체 교체
   - 나머지는 날짜 열에서 월을 자동으로 읽어 행마다 저장됨
4. 설정 > **사원 관리** 에서 사원 등록 — 엑셀(이름/이메일/사번/ID/부서/직책/직위) 일괄 등록 가능. 기존 권한(화면별 부서)은 `exportUsers` 로그를 보고 옮김

## 6. 매월 운영
- 설정 > 데이터 업로드 → 데이터 종류 · 대상 월 선택 → 엑셀 올리기 → **월 교체**
- 마감월은 설정 화면(3단계 이전 후)에서 변경

## 로컬 실행
```bash
cp .env.example .env   # 값 채우기
npm install
npm run dev            # http://localhost:5173/kjhub/
```

## 권한 모델
| role  | 의미 |
|-------|------|
| admin | 모든 화면 + 설정·업로드·사원 관리 |
| all   | 모든 조회 화면 (국전 수익/비용 포함), 설정 불가 |
| user  | 화면별 허용 부서(`screen_depts`) 만 조회 |

무료 플랜 한도: DB 500MB, 월 egress 5GB, 7일 미사용 시 일시정지(keep-alive 워크플로로 방지).
