// 관리자 페이지
const $ = id => document.getElementById(id);
let site = null;          // 사이트 설정 (서버 사본)
let currentSlug = null;   // 편집 중인 프로젝트
let dirty = false;
let pickerCallback = null;

// ---------- 세션 ----------
const getSession = () => { try { const s = JSON.parse(localStorage.getItem(SESSION_KEY)); return s && s.exp > Date.now() ? s : null; } catch { return null; } };
const setSession = s => { try { s ? localStorage.setItem(SESSION_KEY, JSON.stringify(s)) : localStorage.removeItem(SESSION_KEY); } catch {} };

async function api(path, opts = {}) {
  const s = getSession();
  const res = await fetch(API + path, { ...opts, headers: { ...(s ? { Authorization: 'Bearer ' + s.token } : {}), ...(opts.headers || {}) } });
  if (res.status === 401 && path !== '/api/login') { setSession(null); showLogin('로그인이 만료되었습니다. 다시 로그인하세요.'); throw new Error('로그인 필요'); }
  const ct = res.headers.get('Content-Type') || '';
  const data = ct.includes('json') ? await res.json() : await res.text();
  if (!res.ok) throw new Error((data && data.error) || `오류 ${res.status}`);
  return data;
}

function msg(text, kind = '') { const el = $('msg'); el.textContent = text; el.className = 'ed-msg ad-status ' + kind; if (kind === 'ok') setTimeout(() => { if (el.textContent === text) el.textContent = ''; }, 4000); }

function showLogin(text = '') { $('appView').hidden = true; $('loginView').hidden = false; $('loginMsg').textContent = text; $('password').focus(); }

$('loginForm').onsubmit = async e => {
  e.preventDefault();
  $('loginMsg').textContent = '확인 중…';
  try {
    const r = await api('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: $('password').value }) });
    setSession({ token: r.token, exp: Date.now() + r.expiresInHours * 3600 * 1000 - 60000 });
    $('password').value = '';
    await startApp();
  } catch (err) { $('loginMsg').textContent = err.message; }
};
$('logoutBtn').onclick = () => { if (confirmLeave()) { setSession(null); location.href = './'; } };

// ---------- 공통 ----------
const confirmLeave = () => !dirty || confirm('저장하지 않은 변경 내용이 있습니다. 버릴까요?');
window.onbeforeunload = e => { if (dirty) { e.preventDefault(); e.returnValue = ''; } };

function showView(name) {
  document.querySelectorAll('.ad-view').forEach(v => v.hidden = v.id !== 'view-' + name);
  document.querySelectorAll('.ad-nav').forEach(b => b.classList.toggle('active', b.dataset.view === name));
  if (name !== 'project') { currentSlug = null; renderProjectList(); }
}

async function saveSiteObj(note) {
  await api('/api/site', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(site) });
  if (note) msg(note, 'ok');
}

// ---------- 사진 압축·업로드 ----------
async function compressImage(file) {
  if (file.type === 'image/gif' || file.type === 'image/svg+xml') return { blob: file, ext: file.type === 'image/gif' ? 'gif' : 'svg', type: file.type };
  const bmp = await createImageBitmap(file).catch(() => null);
  if (!bmp) return { blob: file, ext: (file.name.split('.').pop() || 'jpg').toLowerCase(), type: file.type };
  const MAX = 2000;
  const scale = Math.min(1, MAX / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * scale), h = Math.round(bmp.height * scale);
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d');
  const keepPng = file.type === 'image/png' && file.size < 600 * 1024;
  if (!keepPng) { g.fillStyle = '#fff'; g.fillRect(0, 0, w, h); }
  g.drawImage(bmp, 0, 0, w, h);
  const type = keepPng ? 'image/png' : 'image/jpeg';
  const blob = await new Promise(r => c.toBlob(r, type, 0.85));
  return { blob, ext: keepPng ? 'png' : 'jpg', type };
}

async function uploadImage(file, folder) {
  const { blob, ext, type } = await compressImage(file);
  const base = file.name.replace(/\.[^.]+$/, '').replace(/[^\w\-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'img';
  const path = `${folder || 'misc'}/${Date.now().toString(36)}-${base}.${ext}`;
  await api('/api/media/' + encodeURI(path), { method: 'PUT', headers: { 'Content-Type': type }, body: blob });
  return 'media/' + path;
}

async function uploadMany(files, folder) {
  const out = [];
  let i = 0;
  for (const f of files) { msg(`사진 업로드 중… (${++i}/${files.length})`); out.push(await uploadImage(f, folder)); }
  return out;
}

const pickFiles = (multiple) => new Promise(resolve => {
  const inp = multiple ? $('multiInput') : $('fileInput');
  inp.value = '';
  inp.onchange = () => resolve([...inp.files]);
  inp.click();
});

// ---------- 사이트 정보 ----------
function loadSiteView() {
  $('siteTitle').value = site.title || '';
  $('siteDesc').value = site.description || '';
}
$('saveSite').onclick = async () => {
  site.title = $('siteTitle').value.trim() || '포트폴리오';
  site.description = $('siteDesc').value.trim();
  try { await saveSiteObj('사이트 정보를 저장했습니다.'); } catch (e) { msg(e.message, 'err'); }
};

// ---------- 디자인 ----------
const DESIGN_FIELDS = [
  ['bg', '페이지 배경', 'color'], ['surface', '카드·표 배경', 'color'], ['text', '본문 글자', 'color'], ['muted', '보조 글자(캡션)', 'color'],
  ['line', '구분선', 'color'], ['accent', '강조색', 'color'], ['accentSoft', '강조색 옅은 배경', 'color'],
  ['fontSize', '본문 글자 크기 (예: 17px)', 'text'], ['lineHeight', '줄 간격 (예: 1.8)', 'text'], ['contentWidth', '본문 최대 폭 (예: 760px)', 'text'], ['radius', '모서리 둥글기 (예: 12px)', 'text'],
];
function loadDesignView() {
  const d = { ...DESIGN_DEFAULTS, ...(site.design || {}) };
  $('designFields').innerHTML = DESIGN_FIELDS.map(([k, label, t]) => t === 'color'
    ? `<label>${label}<span class="ad-color"><input type="color" data-k="${k}" value="${esc(d[k])}"><input data-k="${k}" value="${esc(d[k])}"></span></label>`
    : `<label>${label}<input data-k="${k}" value="${esc(d[k])}"></label>`).join('');
  $('darkMode').checked = !!d.darkMode;
  $('designFields').querySelectorAll('input').forEach(inp => inp.oninput = () => {
    $('designFields').querySelectorAll(`input[data-k="${inp.dataset.k}"]`).forEach(o => { if (o !== inp) o.value = inp.value; });
    applyDesign(readDesign());
  });
  $('darkMode').onchange = () => applyDesign(readDesign());
}
function readDesign() {
  const d = { darkMode: $('darkMode').checked };
  $('designFields').querySelectorAll('input:not([type=color])').forEach(i => d[i.dataset.k] = i.value.trim());
  return d;
}
$('saveDesign').onclick = async () => { site.design = readDesign(); try { await saveSiteObj('디자인을 저장했습니다.'); } catch (e) { msg(e.message, 'err'); } };
$('resetDesign').onclick = () => { site.design = { ...DESIGN_DEFAULTS }; loadDesignView(); applyDesign(site.design); msg('기본값을 불러왔습니다. 저장을 눌러야 적용됩니다.'); };

// ---------- 사진 보관함 ----------
async function renderMediaGrid(grid, onPick, withDelete) {
  grid.innerHTML = '<p class="ad-hint">불러오는 중…</p>';
  const { items } = await api('/api/media');
  items.sort().reverse();
  grid.innerHTML = items.length ? '' : '<p class="ad-hint">업로드한 사진이 없습니다.</p>';
  for (const p of items) {
    const fig = document.createElement('figure');
    fig.innerHTML = `<img src="${API}/media/${encodeURI(p)}" loading="lazy" alt=""><figcaption>${esc(p)}</figcaption>${withDelete ? '<button class="del">삭제</button>' : ''}`;
    fig.onclick = () => onPick('media/' + p);
    if (withDelete) fig.querySelector('.del').onclick = async ev => {
      ev.stopPropagation();
      if (!confirm('이 사진을 삭제할까요? 본문에서 쓰고 있다면 그 자리에 사진이 보이지 않게 됩니다.')) return;
      try { await api('/api/media/' + encodeURI(p), { method: 'DELETE' }); fig.remove(); msg('삭제했습니다.', 'ok'); } catch (e) { msg(e.message, 'err'); }
    };
    grid.appendChild(fig);
  }
}
function loadMediaView() {
  renderMediaGrid($('mediaGrid'), async path => {
    try { await navigator.clipboard.writeText(`![](${path})`); msg('본문용 코드를 복사했습니다: ' + `![](${path})`, 'ok'); } catch { prompt('복사해서 사용하세요', `![](${path})`); }
  }, true).catch(e => msg(e.message, 'err'));
}

function openPicker(cb) {
  pickerCallback = cb;
  $('picker').showModal();
  renderMediaGrid($('pickerGrid'), p => { $('picker').close(); pickerCallback && pickerCallback(p); }, false).catch(e => msg(e.message, 'err'));
}
$('pickerClose').onclick = () => $('picker').close();
$('pickerUpload').onclick = async () => {
  const files = await pickFiles(false);
  if (!files.length) return;
  try { const [p] = await uploadMany(files, currentSlug); msg('업로드했습니다.', 'ok'); $('picker').close(); pickerCallback && pickerCallback(p); } catch (e) { msg(e.message, 'err'); }
};

// ---------- 프로젝트 목록 ----------
function renderProjectList() {
  const ul = $('projectList');
  ul.innerHTML = '';
  site.projects.forEach((p, i) => {
    const li = document.createElement('li');
    li.className = (p.slug === currentSlug ? 'active ' : '') + (p.hidden ? 'hidden-p' : '');
    li.innerHTML = `<button class="name" title="${esc(p.title)}">${esc(p.title)}</button><button class="mv" title="위로">▲</button><button class="mv" title="아래로">▼</button>`;
    const [nameBtn, up, down] = li.querySelectorAll('button');
    nameBtn.onclick = () => { if (p.slug !== currentSlug && confirmLeave()) openProject(p.slug); };
    up.onclick = () => move(i, -1);
    down.onclick = () => move(i, 1);
    ul.appendChild(li);
  });
}
async function move(i, d) {
  const j = i + d;
  if (j < 0 || j >= site.projects.length) return;
  [site.projects[i], site.projects[j]] = [site.projects[j], site.projects[i]];
  renderProjectList();
  try { await saveSiteObj('순서를 저장했습니다.'); } catch (e) { msg(e.message, 'err'); }
}

$('addProject').onclick = async () => {
  if (!confirmLeave()) return;
  const title = prompt('새 프로젝트 제목');
  if (!title) return;
  let slug = prompt('주소에 쓸 영문 이름 (소문자·숫자·하이픈, 예: drone-project)', '');
  if (!slug) return;
  slug = slug.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{0,60}$/.test(slug)) { alert('영문 소문자, 숫자, 하이픈(-)만 쓸 수 있습니다.'); return; }
  if (site.projects.some(p => p.slug === slug)) { alert('이미 있는 이름입니다.'); return; }
  site.projects.push({ slug, title: title.trim(), summary: '', cover: '' });
  try {
    await api('/api/page/' + slug, { method: 'PUT', headers: { 'Content-Type': 'text/markdown; charset=utf-8' }, body: `# ${title.trim()}\n\n` });
    await saveSiteObj('새 프로젝트를 만들었습니다.');
    openProject(slug);
  } catch (e) { site.projects.pop(); msg(e.message, 'err'); }
};

// ---------- 프로젝트 편집 ----------
let coverPath = '';
function setCover(p) { coverPath = p || ''; $('pCoverImg').src = coverPath ? mediaUrl(coverPath) : ''; }

async function openProject(slug) {
  const p = site.projects.find(x => x.slug === slug);
  if (!p) return;
  currentSlug = slug;
  showView('project'); currentSlug = slug; renderProjectList();
  $('projHeading').textContent = p.title;
  $('pTitle').value = p.title; $('pSlug').value = p.slug; $('pSummary').value = p.summary || ''; $('pHidden').checked = !!p.hidden;
  setCover(p.cover);
  $('viewLink').href = 'project.html?p=' + slug;
  $('body').value = '불러오는 중…';
  try { $('body').value = await api('/api/page/' + slug); } catch { $('body').value = ''; }
  dirty = false;
  history.replaceState(null, '', '?page=' + slug);
  renderPreview();
}

['pTitle', 'pSummary', 'pHidden'].forEach(id => $(id).addEventListener('input', () => dirty = true));
$('pHidden').addEventListener('change', () => dirty = true);
$('pCoverBtn').onclick = e => { e.preventDefault(); openPicker(p => { setCover(p); dirty = true; }); };

async function saveProject() {
  if (!currentSlug) return;
  const p = site.projects.find(x => x.slug === currentSlug);
  $('saveProject').disabled = true; msg('저장 중…');
  try {
    await api('/api/page/' + currentSlug, { method: 'PUT', headers: { 'Content-Type': 'text/markdown; charset=utf-8' }, body: $('body').value });
    Object.assign(p, { title: $('pTitle').value.trim() || p.title, summary: $('pSummary').value.trim(), cover: coverPath, hidden: $('pHidden').checked });
    await saveSiteObj();
    dirty = false; $('projHeading').textContent = p.title; renderProjectList();
    msg('저장했습니다. 사이트에 바로 반영됩니다.', 'ok');
  } catch (e) { msg('저장 실패: ' + e.message, 'err'); }
  finally { $('saveProject').disabled = false; }
}
$('saveProject').onclick = saveProject;
document.addEventListener('keydown', e => { if ((e.ctrlKey || e.metaKey) && e.key === 's' && currentSlug) { e.preventDefault(); saveProject(); } });

$('deleteProject').onclick = async () => {
  const p = site.projects.find(x => x.slug === currentSlug);
  if (!p || !confirm(`'${p.title}' 프로젝트를 삭제할까요? 본문이 지워지며 되돌릴 수 없습니다. (사진은 사진 보관함에 남습니다)\n\n숨기기만 하려면 '사이트에서 숨기기'를 쓰세요.`)) return;
  try {
    site.projects = site.projects.filter(x => x.slug !== p.slug);
    await saveSiteObj();
    await api('/api/page/' + p.slug, { method: 'DELETE' });
    dirty = false; history.replaceState(null, '', 'admin.html');
    msg('삭제했습니다.', 'ok'); showView('site'); loadSiteView();
  } catch (e) { msg(e.message, 'err'); }
};

// 본문 편집 도구
function insertAtCursor(text, selectInner) {
  const ta = $('body'), s = ta.selectionStart, e = ta.selectionEnd;
  ta.value = ta.value.slice(0, s) + text + ta.value.slice(e);
  ta.focus();
  if (selectInner) { const i = text.indexOf(selectInner); ta.selectionStart = s + i; ta.selectionEnd = s + i + selectInner.length; }
  else ta.selectionStart = ta.selectionEnd = s + text.length;
  dirty = true; renderPreview();
}
function wrapSelection(before, after, placeholder) {
  const ta = $('body'), sel = ta.value.slice(ta.selectionStart, ta.selectionEnd) || placeholder;
  insertAtCursor(before + sel + after, sel);
}
const INS = {
  h2: () => insertAtCursor('\n\n## 대단원 제목\n\n', '대단원 제목'),
  h3: () => insertAtCursor('\n\n### 소단원 제목\n\n', '소단원 제목'),
  bold: () => wrapSelection('**', '**', '굵은 글자'),
  quote: () => insertAtCursor('\n\n> 강조 문구\n\n', '강조 문구'),
  table: () => insertAtCursor('\n\n| 항목 | 내용 |\n|---|---|\n| 항목1 | 내용1 |\n| 항목2 | 내용2 |\n\n', '항목'),
  caption: () => insertAtCursor('\n\n<p class="caption">작은 설명</p>\n\n', '작은 설명'),
};
document.querySelectorAll('[data-ins]').forEach(b => b.onclick = () => INS[b.dataset.ins]());

$('insImage').onclick = () => openPicker(p => insertAtCursor(`\n\n![사진 설명](${p})\n\n`, '사진 설명'));
$('insGallery').onclick = async () => {
  const files = await pickFiles(true);
  if (!files.length) return;
  try {
    const paths = await uploadMany(files, currentSlug);
    insertAtCursor(`\n\n<div class="gallery">\n\n${paths.map(p => `![](${p})`).join('\n')}\n\n</div>\n\n`);
    msg(`${paths.length}장을 올리고 본문에 넣었습니다. 각 사진의 설명은 ![ ] 안에 쓰세요.`, 'ok');
  } catch (e) { msg(e.message, 'err'); }
};

// 붙여넣기·끌어놓기로 사진 넣기
async function handleDroppedFiles(files) {
  const imgs = [...files].filter(f => f.type.startsWith('image/'));
  if (!imgs.length) return false;
  try {
    const paths = await uploadMany(imgs, currentSlug);
    insertAtCursor(paths.length === 1 ? `\n\n![사진 설명](${paths[0]})\n\n` : `\n\n<div class="gallery">\n\n${paths.map(p => `![](${p})`).join('\n')}\n\n</div>\n\n`);
    msg('사진을 올리고 본문에 넣었습니다.', 'ok');
  } catch (e) { msg(e.message, 'err'); }
  return true;
}
$('body').addEventListener('paste', e => { if (e.clipboardData.files.length) { e.preventDefault(); handleDroppedFiles(e.clipboardData.files); } });
$('body').addEventListener('dragover', e => e.preventDefault());
$('body').addEventListener('drop', e => { if (e.dataTransfer.files.length) { e.preventDefault(); handleDroppedFiles(e.dataTransfer.files); } });

// 미리보기
let previewTimer;
function renderPreview() {
  if ($('preview').hidden) return;
  clearTimeout(previewTimer);
  previewTimer = setTimeout(() => { const p = $('preview'); p.innerHTML = marked.parse($('body').value); enhance(p); }, 200);
}
$('body').addEventListener('input', () => { dirty = true; renderPreview(); });
$('togglePreview').onclick = () => {
  const p = $('preview'); p.hidden = !p.hidden;
  $('editorPanes').classList.toggle('split', !p.hidden);
  $('togglePreview').classList.toggle('primary', !p.hidden);
  renderPreview();
};

// ---------- 시작 ----------
document.querySelectorAll('.ad-nav').forEach(b => b.onclick = () => {
  if (!confirmLeave()) return;
  dirty = false;
  history.replaceState(null, '', 'admin.html');
  showView(b.dataset.view);
  ({ site: loadSiteView, design: loadDesignView, media: loadMediaView })[b.dataset.view]();
});

async function startApp() {
  await api('/api/session');
  site = await loadSite();
  site.projects = site.projects || [];
  $('loginView').hidden = true; $('appView').hidden = false;
  const want = new URLSearchParams(location.search).get('page');
  if (want && site.projects.some(p => p.slug === want)) openProject(want);
  else { showView('site'); loadSiteView(); }
  renderProjectList();
}

(async () => {
  if (getSession()) { try { await startApp(); return; } catch {} }
  showLogin();
})();
