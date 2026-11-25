// 사이트 동작 스크립트 — 내용·디자인 수정에는 이 파일을 건드릴 필요가 없습니다.
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

async function loadSite() {
  const res = await fetch('content/site.json', { cache: 'no-cache' });
  return res.json();
}

function renderTopbar(site, current) {
  const links = site.projects.map(p =>
    `<a href="project.html?p=${encodeURIComponent(p.slug)}"${p.slug === current ? ' class="active"' : ''}>${esc(p.title)}</a>`).join('');
  document.querySelector('.topbar-inner').innerHTML =
    `<a class="brand" href="./">${esc(site.title)}</a><nav class="nav">${links}</nav>`;
}

async function home() {
  const site = await loadSite();
  document.title = site.title;
  renderTopbar(site, null);
  document.getElementById('hero').innerHTML =
    `<h1>${esc(site.title)}</h1>${site.description ? `<p>${esc(site.description)}</p>` : ''}`;
  document.getElementById('cards').innerHTML = site.projects.map(p => `
    <a class="card" href="project.html?p=${encodeURIComponent(p.slug)}">
      <div class="card-cover">${p.cover ? `<img src="${esc(p.cover)}" alt="" loading="lazy">` : ''}</div>
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
  const site = await loadSite();
  const slug = new URLSearchParams(location.search).get('p') || site.projects[0].slug;
  const idx = site.projects.findIndex(p => p.slug === slug);
  const meta = site.projects[idx];
  renderTopbar(site, slug);
  const el = document.getElementById('content');
  if (!meta) { el.innerHTML = '<p>페이지를 찾을 수 없습니다.</p>'; return; }
  document.title = `${meta.title} · ${site.title}`;
  const md = await (await fetch(`content/${slug}.md`, { cache: 'no-cache' })).text();
  el.innerHTML = marked.parse(md);
  enhance(el);
  buildToc(el);
  const prev = site.projects[idx - 1], next = site.projects[idx + 1];
  document.getElementById('pager').innerHTML =
    `<span>${prev ? `<a href="project.html?p=${prev.slug}">← ${esc(prev.title)}</a>` : ''}</span>` +
    `<span>${next ? `<a href="project.html?p=${next.slug}">${esc(next.title)} →</a>` : ''}</span>`;
  if (location.hash) document.querySelector(location.hash)?.scrollIntoView();
}
