// 포트폴리오 API (Cloudflare Worker)
// 읽기: 누구나 / 쓰기: 관리자 로그인 세션만
//
// KV 키 구조
//   site            사이트 설정 JSON (제목, 프로젝트 목록, 디자인 값)
//   page:<slug>     프로젝트 본문 (Markdown)
//   media:<path>    사진 (바이너리, metadata.type = MIME)
//   rl:<ip>         로그인 실패 횟수 (자동 만료)
//
// 비밀값 (wrangler secret)
//   ADMIN_PASSWORD  관리자 비밀번호
//   SESSION_SECRET  세션 서명 키

const SESSION_HOURS = 12;
const MAX_FAILS = 5;
const LOCK_SECONDS = 15 * 60;
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

const enc = new TextEncoder();

function cors(req, env) {
  const origin = req.headers.get('Origin') || '';
  const allowed = (env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim());
  return {
    'Access-Control-Allow-Origin': allowed.includes(origin) ? origin : allowed[0] || '*',
    'Access-Control-Allow-Methods': 'GET, PUT, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

const json = (data, status = 200, extra = {}) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...extra } });

const b64url = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function hmac(secret, data) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64url(await crypto.subtle.sign('HMAC', key, enc.encode(data)));
}

async function safeEqual(a, b) {
  // 길이·내용을 해시로 비교해 타이밍 차이를 줄임
  const [ha, hb] = await Promise.all([crypto.subtle.digest('SHA-256', enc.encode(a)), crypto.subtle.digest('SHA-256', enc.encode(b))]);
  const x = new Uint8Array(ha), y = new Uint8Array(hb);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

async function makeSession(env) {
  const exp = Date.now() + SESSION_HOURS * 3600 * 1000;
  const payload = `admin.${exp}`;
  return `${payload}.${await hmac(env.SESSION_SECRET, payload)}`;
}

async function isAdmin(req, env) {
  const h = req.headers.get('Authorization') || '';
  const tok = h.startsWith('Bearer ') ? h.slice(7) : '';
  const parts = tok.split('.');
  if (parts.length !== 3 || parts[0] !== 'admin') return false;
  const exp = Number(parts[1]);
  if (!exp || exp < Date.now()) return false;
  return safeEqual(parts[2], await hmac(env.SESSION_SECRET, `${parts[0]}.${parts[1]}`));
}

const validSlug = s => /^[a-z0-9][a-z0-9-]{0,60}$/.test(s);
const validMediaPath = p => /^[a-z0-9-]{1,60}\/[\w.\-]{1,120}$/i.test(p) && !p.includes('..');

async function login(req, env) {
  if (!env.ADMIN_PASSWORD || !env.SESSION_SECRET) return json({ error: '서버 비밀값이 설정되지 않았습니다.' }, 500);
  const ip = req.headers.get('CF-Connecting-IP') || 'unknown';
  const rlKey = `rl:${ip}`;
  const fails = Number(await env.CONTENT.get(rlKey)) || 0;
  if (fails >= MAX_FAILS) return json({ error: '로그인 시도가 너무 많습니다. 15분 뒤 다시 시도하세요.' }, 429);
  let body = {};
  try { body = await req.json(); } catch {}
  if (typeof body.password === 'string' && await safeEqual(body.password, env.ADMIN_PASSWORD)) {
    if (fails) await env.CONTENT.delete(rlKey);
    return json({ token: await makeSession(env), expiresInHours: SESSION_HOURS });
  }
  await env.CONTENT.put(rlKey, String(fails + 1), { expirationTtl: LOCK_SECONDS });
  return json({ error: '비밀번호가 올바르지 않습니다.' }, 401);
}

async function handle(req, env) {
  const url = new URL(req.url);
  const path = url.pathname;
  const m = req.method;

  // ---------- 공개 읽기 ----------
  if (m === 'GET' && path === '/api/site') {
    const site = await env.CONTENT.get('site');
    return site ? new Response(site, { headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache' } }) : json({ error: 'not found' }, 404);
  }
  let mm;
  if (m === 'GET' && (mm = path.match(/^\/api\/page\/([^/]+)$/))) {
    const md = await env.CONTENT.get(`page:${mm[1]}`);
    return md === null ? json({ error: 'not found' }, 404) : new Response(md, { headers: { 'Content-Type': 'text/markdown; charset=utf-8', 'Cache-Control': 'no-cache' } });
  }
  if (m === 'GET' && (mm = path.match(/^\/media\/(.+)$/))) {
    const p = decodeURIComponent(mm[1]);
    const { value, metadata } = await env.CONTENT.getWithMetadata(`media:${p}`, 'arrayBuffer');
    if (!value) return new Response('not found', { status: 404 });
    return new Response(value, { headers: { 'Content-Type': (metadata && metadata.type) || 'application/octet-stream', 'Cache-Control': 'public, max-age=31536000, immutable' } });
  }

  // ---------- 로그인 ----------
  if (m === 'POST' && path === '/api/login') return login(req, env);

  // ---------- 관리자 전용 ----------
  if (!path.startsWith('/api/')) return json({ error: 'not found' }, 404);
  if (!(await isAdmin(req, env))) return json({ error: '관리자 로그인이 필요합니다.' }, 401);

  if (m === 'GET' && path === '/api/session') return json({ ok: true });

  if (m === 'PUT' && path === '/api/site') {
    const text = await req.text();
    let site;
    try { site = JSON.parse(text); } catch { return json({ error: 'JSON 형식 오류' }, 400); }
    if (!site || !Array.isArray(site.projects)) return json({ error: 'projects 배열이 필요합니다.' }, 400);
    if (site.projects.some(p => !validSlug(p.slug))) return json({ error: 'slug는 영문 소문자·숫자·하이픈만 가능합니다.' }, 400);
    await env.CONTENT.put('site', JSON.stringify(site));
    return json({ ok: true });
  }
  if ((mm = path.match(/^\/api\/page\/([^/]+)$/))) {
    if (!validSlug(mm[1])) return json({ error: 'slug 형식 오류' }, 400);
    if (m === 'PUT') { await env.CONTENT.put(`page:${mm[1]}`, await req.text()); return json({ ok: true }); }
    if (m === 'DELETE') { await env.CONTENT.delete(`page:${mm[1]}`); return json({ ok: true }); }
  }
  if (m === 'GET' && path === '/api/media') {
    const items = [];
    let cursor;
    do {
      const r = await env.CONTENT.list({ prefix: 'media:', cursor });
      items.push(...r.keys.map(k => k.name.slice(6)));
      cursor = r.list_complete ? null : r.cursor;
    } while (cursor);
    return json({ items });
  }
  if ((mm = path.match(/^\/api\/media\/(.+)$/))) {
    const p = decodeURIComponent(mm[1]);
    if (!validMediaPath(p)) return json({ error: '파일 경로 형식 오류' }, 400);
    if (m === 'PUT') {
      const type = req.headers.get('Content-Type') || '';
      if (!type.startsWith('image/')) return json({ error: '이미지 파일만 업로드할 수 있습니다.' }, 400);
      const buf = await req.arrayBuffer();
      if (buf.byteLength > MAX_IMAGE_BYTES) return json({ error: '이미지가 너무 큽니다.' }, 413);
      await env.CONTENT.put(`media:${p}`, buf, { metadata: { type } });
      return json({ ok: true, url: `/media/${p}` });
    }
    if (m === 'DELETE') { await env.CONTENT.delete(`media:${p}`); return json({ ok: true }); }
  }
  return json({ error: 'not found' }, 404);
}

export default {
  async fetch(req, env) {
    const h = cors(req, env);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: h });
    let res;
    try { res = await handle(req, env); }
    catch (e) { res = json({ error: '서버 오류: ' + e.message }, 500); }
    const out = new Response(res.body, res);
    for (const [k, v] of Object.entries(h)) out.headers.set(k, v);
    return out;
  },
};
