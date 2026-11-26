# 포트폴리오 사이트

- 공개 사이트: https://seungwon09.github.io/portfolio/
- 관리자 페이지: https://seungwon09.github.io/portfolio/admin.html

## 구조

| 구성 | 역할 |
|---|---|
| GitHub Pages (이 저장소) | 사이트 화면(HTML·CSS·JS)만 제공 |
| Cloudflare Worker `portfolio-api` (`worker/`) | 데이터 API. 읽기는 누구나, 쓰기는 관리자 로그인 세션만 |
| Cloudflare KV `CONTENT` | 사이트 설정·디자인·본문·사진 저장 |

글·사진·디자인은 이 저장소가 아니라 KV에 있습니다. 관리자 페이지에서 저장하면 즉시 공개 사이트에 반영됩니다.

## 관리자 페이지에서 하는 일

- 사이트 정보: 제목, 소개 문구
- 디자인: 색상, 글자 크기, 줄 간격, 본문 폭, 모서리, 다크 모드
- 프로젝트: 추가·삭제·순서 변경·숨기기, 제목·요약·대표 사진, 본문 편집(미리보기)
- 사진: 업로드 시 자동 압축(최대 2000px). 본문에 붙여넣기·끌어놓기도 가능. 사진 보관함에서 관리

## 본문 작성 규칙 (Markdown)

- `## 제목` 대단원(왼쪽 목차에 표시), `### 제목` 소단원
- `> 문장` 제목 아래 강조 문구, `**굵게**`
- 표: `| 머리1 | 머리2 |` / `|---|---|` / 행
- 사진: `![캡션](media/폴더/파일.jpg)`, 굵은 제목 추가: `![설명](경로 "제목")`
- 사진 나란히: `<div class="gallery">` … `</div>` (위아래 빈 줄 필수), 자르지 않으려면 `class="gallery contain"`
- 작은 회색 문구 `<p class="caption">…</p>`, 강조 박스 `<p class="formula">…</p>`

## 서버 관리 (wrangler)

```
cd worker
wrangler deploy                                   # Worker 코드 배포
wrangler secret put ADMIN_PASSWORD                # 관리자 비밀번호 변경
wrangler kv key get site --binding CONTENT --remote   # 사이트 설정 백업 확인
```
