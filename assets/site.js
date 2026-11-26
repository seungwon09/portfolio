// 사이트 동작 스크립트 — 내용과 디자인은 관리자 페이지(admin.html)에서 수정합니다.
const API = (() => {
  // 로컬 테스트용: localhost에서 localStorage 'api-override'가 있으면 그 주소 사용
  try { if (location.hostname === 'localhost' && localStorage.getItem('api-override')) return localStorage.getItem('api-override'); } catch {}
  return 'https://portfolio-api.seungwon.workers.dev';
})();
const SESSION_KEY = 'portfolio-admin-session';

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// 'media/...' 처럼 저장된 경로를 실제 주소로 변환
const mediaUrl = src => (src && /^(media|video)\//.test(src) ? `${API}/${src}` : src);

// 디자인 설정 기본값 (관리자 페이지에서 바꾼 값이 우선)
const DESIGN_DEFAULTS = {
  fontSize: '17px', lineHeight: '1.8', contentWidth: '760px', radius: '12px',
  bg: '#f7f7f5', surface: '#ffffff', text: '#1d1d1f', muted: '#6b6b70', line: '#e3e3e0', accent: '#2456d6', accentSoft: '#eaf0fd',
  darkMode: true,
};
const DARK = { bg: '#121214', surface: '#1c1c1f', text: '#ececef', muted: '#9a9aa2', line: '#2e2e33', accent: '#7ea2ff', accentSoft: '#1e2740' };
const VAR = {
  fontSize: '--font-size', lineHeight: '--line-height', contentWidth: '--content-width', radius: '--radius',
  bg: '--bg', surface: '--surface', text: '--text', muted: '--muted', line: '--line', accent: '--accent', accentSoft: '--accent-soft',
};

function designCss(design) {
  const d = { ...DESIGN_DEFAULTS, ...(design || {}) };
  const decl = obj => Object.entries(obj).filter(([k]) => VAR[k]).map(([k, v]) => `${VAR[k]}:${v};`).join('');
  let css = `:root{${decl(d)}}`;
  if (d.darkMode) css += `@media (prefers-color-scheme: dark){:root{${decl(DARK)}}}`;
  return css;
}

function applyDesign(design) {
  let el = document.getElementById('design-vars');
  if (!el) { el = document.createElement('style'); el.id = 'design-vars'; document.head.appendChild(el); }
  el.textContent = designCss(design);
}

async function loadSite() {
  const res = await fetch(`${API}/api/site`, { cache: 'no-cache' });
  if (!res.ok) throw new Error('사이트 정보를 불러오지 못했습니다.');
  const site = await res.json();
  applyDesign(site.design);
  return site;
}

function renderTopbar(site, current) {
  const links = site.projects.map(p =>
    `<a href="project.html?p=${encodeURIComponent(p.slug)}"${p.slug === current ? ' class="active"' : ''}>${esc(p.title)}</a>`).join('');
  document.querySelector('.topbar-inner').innerHTML =
    `<a class="brand" href="./">${esc(site.title)}</a><nav class="nav">${links}</nav>`;
}

// 관리자 로그인 상태인 브라우저에서만 수정 버튼 표시
function ownerButton(target) {
  let s = null; try { s = JSON.parse(localStorage.getItem(SESSION_KEY)); } catch {}
  if (!s || !s.exp || s.exp < Date.now()) return;
  const a = document.createElement('a');
  a.className = 'ed-fab'; a.href = 'admin.html' + (target ? '?page=' + encodeURIComponent(target) : ''); a.textContent = '이 페이지 수정';
  document.body.appendChild(a);
}

function showError(el, e) { el.innerHTML = `<p style="padding:48px 0;color:var(--muted)">${esc(e.message || e)}</p>`; }

async function home() {
  const cards = document.getElementById('cards');
  let site;
  try { site = await loadSite(); } catch (e) { showError(cards, e); return; }
  document.title = site.title;
  renderTopbar(site, null);
  ownerButton('');
  document.getElementById('hero').innerHTML =
    `<h1>${esc(site.title)}</h1>${site.description ? `<p>${esc(site.description)}</p>` : ''}`;
  cards.innerHTML = site.projects.filter(p => !p.hidden).map(p => `
    <a class="card" href="project.html?p=${encodeURIComponent(p.slug)}">
      <div class="card-cover">${p.cover ? `<img src="${esc(mediaUrl(p.cover))}" alt="" loading="lazy">` : ''}</div>
      <div class="card-body"><h2>${esc(p.title)}</h2>${p.summary ? `<p>${esc(p.summary)}</p>` : ''}</div>
    </a>`).join('');
}

function makeFigure(img) {
  const fig = document.createElement('figure');
  const a = document.createElement('a');
  a.href = img.getAttribute('src'); a.target = '_blank'; a.rel = 'noopener';
  img.loading = 'lazy';
  a.appendChild(img.cloneNode());
  fig.appendChild(a);
  const label = img.getAttribute('title'), cap = img.getAttribute('alt');
  if (label || cap) {
    const fc = document.createElement('figcaption');
    fc.innerHTML = (label ? `<strong>${esc(label)}</strong>` : '') + esc(cap || '');
    fig.appendChild(fc);
  }
  return fig;
}

function enhance(root) {
  // 저장 경로 → 실제 주소
  root.querySelectorAll('img[src], video[src], source[src]').forEach(el => el.setAttribute('src', mediaUrl(el.getAttribute('src'))));
  root.querySelectorAll('video').forEach(v => { v.controls = true; v.preload = 'metadata'; v.setAttribute('playsinline', ''); });
  // 갤러리: 안의 이미지를 그림 카드로
  root.querySelectorAll('.gallery').forEach(g => {
    const imgs = [...g.querySelectorAll('img')];
    g.innerHTML = '';
    imgs.forEach(img => g.appendChild(makeFigure(img)));
  });
  // 단독 이미지 문단
  root.querySelectorAll('p').forEach(p => {
    const imgs = p.querySelectorAll('img');
    if (imgs.length && !p.closest('.gallery') && p.textContent.trim() === '') {
      if (imgs.length === 1) p.replaceWith(makeFigure(imgs[0]));
      else { const g = document.createElement('div'); g.className = 'gallery'; imgs.forEach(i => g.appendChild(makeFigure(i))); p.replaceWith(g); }
    }
  });
  // 표 가로 스크롤
  root.querySelectorAll('table').forEach(t => {
    if (t.parentElement.classList.contains('table-wrap')) return;
    const w = document.createElement('div'); w.className = 'table-wrap';
    t.replaceWith(w); w.appendChild(t);
  });
}

function buildToc(root) {
  const hs = [...root.querySelectorAll('h2')];
  const toc = document.getElementById('toc');
  if (!hs.length) { toc.remove(); return; }
  hs.forEach((h, i) => { h.id = 's' + (i + 1); });
  const items = [...root.querySelectorAll('h2, .part')].map(el => el.matches('.part')
    ? `<li class="toc-part">${esc(el.textContent)}</li>`
    : `<li><a href="#${el.id}">${esc(el.textContent)}</a></li>`);
  toc.innerHTML = `<div class="toc-title">목차</div><ol>${items.join('')}</ol>`;
  const links = [...toc.querySelectorAll('a')];
  const obs = new IntersectionObserver(entries => {
    entries.forEach(e => {
      if (e.isIntersecting) links.forEach(a => a.classList.toggle('active', a.getAttribute('href') === '#' + e.target.id));
    });
  }, { rootMargin: '-80px 0px -70% 0px' });
  hs.forEach(h => obs.observe(h));
}

async function project() {
  const el = document.getElementById('content');
  let site;
  try { site = await loadSite(); } catch (e) { showError(el, e); return; }
  const visible = site.projects.filter(p => !p.hidden);
  const slug = new URLSearchParams(location.search).get('p') || (visible[0] && visible[0].slug);
  const idx = visible.findIndex(p => p.slug === slug);
  const meta = visible[idx];
  renderTopbar(site, slug);
  if (!meta) { showError(el, '페이지를 찾을 수 없습니다.'); return; }
  document.title = `${meta.title} · ${site.title}`;
  ownerButton(slug);
  const res = await fetch(`${API}/api/page/${encodeURIComponent(slug)}`, { cache: 'no-cache' });
  el.innerHTML = marked.parse(res.ok ? await res.text() : '');
  enhance(el);
  buildToc(el);
  const prev = visible[idx - 1], next = visible[idx + 1];
  document.getElementById('pager').innerHTML =
    `<span>${prev ? `<a href="project.html?p=${prev.slug}">← ${esc(prev.title)}</a>` : ''}</span>` +
    `<span>${next ? `<a href="project.html?p=${next.slug}">${esc(next.title)} →</a>` : ''}</span>`;
  if (location.hash) document.querySelector(location.hash)?.scrollIntoView();
}
