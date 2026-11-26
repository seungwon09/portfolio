// 편집 모드: GitHub API로 저장소 파일을 읽고 커밋합니다.
const TOKEN_KEY = 'portfolio-gh-token';
const BRANCH = 'main';
let REPO = '', current = { path: '', sha: null }, dirty = false;

const $ = id => document.getElementById(id);
const getToken = () => { try { return localStorage.getItem(TOKEN_KEY) || ''; } catch { return ''; } };
const setToken = t => { try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); } catch {} };

const b64encode = bytes => { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(s); };
const b64decodeText = b64 => new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/\n/g, '')), c => c.charCodeAt(0)));

async function gh(path, opts = {}) {
  const res = await fetch(`https://api.github.com/repos/${REPO}${path}`, {
    ...opts,
    headers: { Accept: 'application/vnd.github+json', ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}), ...(opts.headers || {}) },
  });
  if (!res.ok) {
    let m = ''; try { m = (await res.json()).message; } catch {}
    throw new Error(`${res.status} ${m}`);
  }
  return res.status === 204 ? null : res.json();
}

function msg(text, kind = '') { const el = $('msg'); el.textContent = text; el.className = 'ed-msg ' + kind; }

async function checkToken() {
  const repo = await gh('');
  if (!repo.permissions || !repo.permissions.push) throw new Error('이 토큰에는 저장소 쓰기 권한이 없습니다.');
}

async function listFiles() {
  const content = await gh(`/contents/content?ref=${BRANCH}`);
  const files = content.filter(f => f.type === 'file').map(f => f.path);
  files.push('assets/style.css');
  return files;
}

async function openFile(path) {
  if (dirty && !confirm('저장하지 않은 변경 내용이 있습니다. 버리고 이동할까요?')) { $('file').value = current.path; return; }
  msg('불러오는 중…');
  try {
    const f = await gh(`/contents/${encodeURI(path)}?ref=${BRANCH}`);
    current = { path, sha: f.sha };
    $('src').value = b64decodeText(f.content);
  } catch (e) {
    if (!e.message.startsWith('404')) { msg('불러오기 실패: ' + e.message, 'err'); return; }
    current = { path, sha: null };
    $('src').value = '';
  }
  dirty = false;
  history.replaceState(null, '', '?file=' + encodeURIComponent(path));
  $('previewToggle').hidden = !path.endsWith('.md');
  renderPreview();
  msg(current.sha ? `${path} 편집 중` : `${path} (새 파일)`);
}

function renderPreview() {
  const p = $('preview');
  if (p.hidden || !current.path.endsWith('.md')) return;
  p.innerHTML = marked.parse($('src').value);
  enhance(p);
}

async function putFile(path, base64, sha, message) {
  return gh(`/contents/${encodeURI(path)}`, {
    method: 'PUT',
    body: JSON.stringify({ message, content: base64, branch: BRANCH, ...(sha ? { sha } : {}) }),
  });
}

async function save() {
  const text = $('src').value;
  if (current.path.endsWith('.json')) {
    try { JSON.parse(text); } catch (e) { msg('JSON 형식 오류로 저장하지 않았습니다: ' + e.message, 'err'); return; }
  }
  $('save').disabled = true; msg('저장 중…');
  try {
    const r = await putFile(current.path, b64encode(new TextEncoder().encode(text)), current.sha, `Update ${current.path}`);
    current.sha = r.content.sha; dirty = false;
    msg('저장했습니다. 1~2분 뒤 사이트에 반영됩니다.', 'ok');
  } catch (e) {
    msg(e.message.startsWith('409') ? '다른 곳에서 먼저 수정되어 저장하지 못했습니다. 파일을 다시 불러와 주세요.' : '저장 실패: ' + e.message, 'err');
  } finally { $('save').disabled = false; }
}

async function uploadImage(file) {
  const folder = (current.path.match(/^content\/(.+)\.md$/) || [])[1] || 'misc';
  const name = file.name.replace(/[^\w.\-가-힣]/g, '_');
  const path = `images/${folder}/${Date.now()}-${name}`;
  msg('이미지 업로드 중…');
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    await putFile(path, b64encode(bytes), null, `Add ${path}`);
    const ta = $('src'), pos = ta.selectionStart, ins = `\n![](${path})\n`;
    ta.value = ta.value.slice(0, pos) + ins + ta.value.slice(ta.selectionEnd);
    ta.selectionStart = ta.selectionEnd = pos + ins.length;
    dirty = true; renderPreview();
    msg('이미지를 올리고 본문에 넣었습니다. 캡션은 ![ ] 안에 쓰고, 마지막에 저장을 눌러 주세요.', 'ok');
  } catch (e) { msg('이미지 업로드 실패: ' + e.message, 'err'); }
}

async function startEditor() {
  $('login').hidden = true; $('editor').hidden = false;
  const files = await listFiles();
  const want = new URLSearchParams(location.search).get('file');
  if (want && !files.includes(want)) files.push(want);
  $('file').innerHTML = files.map(f => `<option>${esc(f)}</option>`).join('');
  const first = want || files[0];
  $('file').value = first;
  await openFile(first);
}

async function init() {
  const site = await loadSite();
  REPO = site.repo;
  renderTopbar(site, null);

  $('loginBtn').onclick = async () => {
    setToken($('token').value.trim());
    $('loginMsg').textContent = '확인 중…';
    try { await checkToken(); await startEditor(); }
    catch (e) { setToken(''); $('loginMsg').textContent = '로그인 실패: ' + e.message; }
  };
  $('token').onkeydown = e => { if (e.key === 'Enter') $('loginBtn').click(); };
  $('logout').onclick = () => { setToken(''); location.href = './'; };
  $('file').onchange = e => openFile(e.target.value);
  $('newFile').onclick = () => {
    const p = prompt('새 파일 경로 (예: content/new-project.md)', 'content/');
    if (!p) return;
    if (![...$('file').options].some(o => o.value === p)) $('file').insertAdjacentHTML('beforeend', `<option>${esc(p)}</option>`);
    $('file').value = p; openFile(p);
  };
  $('src').oninput = () => { dirty = true; renderPreview(); };
  $('src').onkeydown = e => { if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); save(); } };
  $('save').onclick = save;
  $('previewToggle').onclick = () => { $('preview').hidden = !$('preview').hidden; $('editor').classList.toggle('split', !$('preview').hidden); renderPreview(); };
  $('imgInput').onchange = e => { if (e.target.files[0]) uploadImage(e.target.files[0]); e.target.value = ''; };
  window.onbeforeunload = e => { if (dirty) { e.preventDefault(); e.returnValue = ''; } };

  if (getToken()) {
    try { await checkToken(); await startEditor(); return; } catch { setToken(''); }
  }
  $('login').hidden = false;
}
init();
