# 포트폴리오 사이트 수정 방법

GitHub Pages로 공개되는 정적 사이트입니다. 방문자는 보기만 가능하고, 이 저장소에 쓰기 권한이 있는 계정(본인)만 수정할 수 있습니다. 수정 사항을 `main` 브랜치에 커밋하면 1~2분 뒤 사이트에 반영됩니다.

## 사이트 안에서 수정 (편집 모드)

1. GitHub → Settings → Developer settings → Personal access tokens → **Fine-grained tokens** → Generate new token
   - Repository access: **Only select repositories** → `portfolio`
   - Permissions → Repository permissions → **Contents: Read and write**
2. 사이트 주소 뒤에 `/edit.html` 을 붙여 접속 (예: `https://seungwon09.github.io/portfolio/edit.html`)
3. 토큰 입력 → 로그인. 토큰은 그 브라우저에만 저장됩니다.
4. 로그인한 브라우저에서는 각 페이지 오른쪽 아래에 **이 페이지 수정** 버튼이 나타납니다.
5. 편집 화면: 파일 선택 → 수정 → **저장**(또는 Ctrl+S). 미리보기, 이미지 업로드, 새 파일 만들기 지원.
6. 공용 PC에서는 사용 후 **로그아웃**.

토큰이 없는 방문자는 편집 버튼이 보이지 않고, `edit.html` 에 들어와도 저장할 수 없습니다.

## 파일 구조

| 파일 | 역할 |
|---|---|
| `content/site.json` | 사이트 제목, 소개 문구, 프로젝트 목록(순서·제목·요약·대표 이미지) |
| `content/humanoid.md` 등 | 각 프로젝트 본문 (Markdown) |
| `assets/style.css` | 디자인. 맨 위 `:root` 블록의 색상·글꼴·크기 값만 바꾸면 전체에 적용 |
| `images/<프로젝트>/` | 본문 이미지 |
| `assets/site.js` | 동작 스크립트 (수정 불필요) |

## 본문 작성 규칙

- `## 제목` : 대단원 (왼쪽 목차에 자동 표시)
- `### 제목` / `#### 제목` : 소단원
- `> 문장` : 제목 아래 강조 문구
- `**굵게**`
- 표: `| 머리1 | 머리2 |` 다음 줄 `|---|---|`, 이후 행
- 이미지: `![캡션](images/폴더/파일.jpg)` — 캡션이 그림 아래에 표시됨
- 이미지 + 굵은 제목: `![설명](경로 "제목")`
- 여러 이미지를 나란히: 아래처럼 감싸기 (위아래 빈 줄 필수)

```
<div class="gallery">

![캡션1](images/...)
![캡션2](images/...)

</div>
```

  `class="gallery contain"` 으로 쓰면 이미지를 자르지 않고 전체를 표시합니다.
- 가운데 작은 회색 문구: `<p class="caption">문구</p>`
- 강조 박스: `<p class="formula">문구</p>`

## 프로젝트 추가

1. `content/새이름.md` 작성
2. `images/새이름/` 에 이미지 업로드
3. `content/site.json` 의 `projects` 배열에 항목 추가 (`slug` 는 md 파일 이름과 동일)

## 로컬 미리보기 (선택)

```
python -m http.server 8000
```

이후 브라우저에서 `http://localhost:8000` 접속. (파일을 더블클릭해 열면 본문이 로드되지 않습니다.)
