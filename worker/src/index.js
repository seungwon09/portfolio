// 포트폴리오 API (Cloudflare Worker)
// 읽기: 누구나 / 쓰기: 관리자 로그인 세션만
//
// KV 키 구조
//   site            사이트 설정 JSON (제목, 프로젝트 목록, 디자인 값)
//   page:<slug>     프로젝트 본문 (Markdown)
//   media:<path>    사진 (바이너리, metadata.type = MIME)
//   rl:<ip>         로그인 실패 횟수 (자동 만료)
//   video:<path>    영상 목록 (값 없음, metadata = { type, size }). 영상 파일 자체는 Backblaze B2
//
// 비밀값 (wrangler secret)
//   ADMIN_PASSWORD  관리자 비밀번호
//   SESSION_SECRET  세션 서명 키
//   B2_KEY_ID       Backblaze B2 keyID
//   B2_APP_KEY      Backblaze B2 applicationKey
// 일반 변수 (wrangler.toml): B2_BUCKET, B2_ENDPOINT

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
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, Range',
    'Access-Control-Expose-Headers': 'Content-Range, Content-Length, Accept-Ranges',
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

// ---------- Backblaze B2 (S3 호환 API, AWS Signature V4) ----------
const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
const sha256hex = async s => hex(await crypto.subtle.digest('SHA-256', enc.encode(s)));
async function hmacRaw(key, data) {
  const k = await crypto.subtle.importKey('raw', typeof key === 'string' ? enc.encode(key) : key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return crypto.subtle.sign('HMAC', k, enc.encode(data));
}
const rfc3986 = s => encodeURIComponent(s).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());

// signHeaders: 서명에 포함할 헤더, extraHeaders: 서명하지 않고 전달할 헤더(Range 등)
async function b2(env, method, key, { query = {}, signHeaders = {}, extraHeaders = {}, body = null } = {}) {
  if (!env.B2_KEY_ID || !env.B2_APP_KEY || !env.B2_BUCKET || !env.B2_ENDPOINT) throw new Error('영상 저장소 설정이 없습니다.');
  const host = env.B2_ENDPOINT;
  const region = host.split('.')[1];
  const uri = '/' + env.B2_BUCKET + '/' + key.split('/').map(rfc3986).join('/');
  const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
  const day = amzDate.slice(0, 8);
  const qs = Object.keys(query).sort().map(k => `${rfc3986(k)}=${rfc3986(query[k])}`).join('&');
  const h = { host, 'x-amz-content-sha256': 'UNSIGNED-PAYLOAD', 'x-amz-date': amzDate };
  for (const [k, v] of Object.entries(signHeaders)) h[k.toLowerCase()] = String(v).trim();
  const names = Object.keys(h).sort();
  const canonical = [method, uri, qs, names.map(n => `${n}:${h[n]}\n`).join(''), names.join(';'), 'UNSIGNED-PAYLOAD'].join('\n');
  const scope = `${day}/${region}/s3/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, await sha256hex(canonical)].join('\n');
  let k = await hmacRaw('AWS4' + env.B2_APP_KEY, day);
  for (const part of [region, 's3', 'aws4_request']) k = await hmacRaw(k, part);
  const sig = hex(await hmacRaw(k, toSign));
  const headers = { ...h, ...extraHeaders, Authorization: `AWS4-HMAC-SHA256 Credential=${env.B2_KEY_ID}/${scope}, SignedHeaders=${names.join(';')}, Signature=${sig}` };
  delete headers.host;
  return fetch(`https://${host}${uri}${qs ? '?' + qs : ''}`, { method, headers, body });
}

async function b2ok(res, what) {
  if (res.ok) return res;
  const t = await res.text();
  const m = t.match(/<Message>([^<]*)<\/Message>/);
  throw new Error(`${what} 실패 (${res.status}${m ? ': ' + m[1] : ''})`);
}

const VIDEO_PREFIX = 'v/';

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

  if ((m === 'GET' || m === 'HEAD') && (mm = path.match(/^\/video\/(.+)$/))) {
    const p = decodeURIComponent(mm[1]);
    if (!validMediaPath(p)) return new Response('not found', { status: 404 });
    const range = req.headers.get('Range');
    const r = await b2(env, m, VIDEO_PREFIX + p, { extraHeaders: range ? { Range: range } : {} });
    if (r.status === 404 || r.status === 403) return new Response('not found', { status: 404 });
    const out = new Headers({ 'Cache-Control': 'public, max-age=31536000, immutable', 'Accept-Ranges': 'bytes' });
    for (const n of ['Content-Type', 'Content-Length', 'Content-Range', 'ETag', 'Last-Modified']) { const v = r.headers.get(n); if (v) out.set(n, v); }
    return new Response(r.body, { status: r.status, headers: out });
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
  // 영상 목록
  if (m === 'GET' && path === '/api/videos') {
    const items = [];
    let cursor;
    do {
      const r = await env.CONTENT.list({ prefix: 'video:', cursor });
      items.push(...r.keys.map(k => ({ path: k.name.slice(6), ...(k.metadata || {}) })));
      cursor = r.list_complete ? null : r.cursor;
    } while (cursor);
    return json({ items });
  }
  // 영상 업로드 (분할 업로드: 시작 → 조각 PUT → 완료)
  if ((mm = path.match(/^\/api\/video-upload\/(.+)$/))) {
    const p = decodeURIComponent(mm[1]);
    if (!validMediaPath(p)) return json({ error: '파일 경로 형식 오류' }, 400);
    const key = VIDEO_PREFIX + p;
    const uploadId = url.searchParams.get('uploadId');
    if (m === 'POST' && !uploadId) {
      const type = req.headers.get('Content-Type') || '';
      if (!type.startsWith('video/')) return json({ error: '영상 파일만 업로드할 수 있습니다.' }, 400);
      const r = await b2ok(await b2(env, 'POST', key, { query: { uploads: '' }, signHeaders: { 'content-type': type } }), '업로드 시작');
      const id = (await r.text()).match(/<UploadId>([^<]+)<\/UploadId>/);
      if (!id) return json({ error: '업로드 ID를 받지 못했습니다.' }, 502);
      return json({ uploadId: id[1] });
    }
    if (m === 'PUT' && uploadId) {
      const n = Number(url.searchParams.get('partNumber'));
      const len = Number(req.headers.get('Content-Length'));
      if (!(n >= 1 && n <= 10000) || !len) return json({ error: '조각 정보 오류' }, 400);
      const { readable, writable } = new FixedLengthStream(len);
      req.body.pipeTo(writable);
      const r = await b2ok(await b2(env, 'PUT', key, { query: { partNumber: String(n), uploadId }, body: readable }), `조각 ${n} 업로드`);
      return json({ etag: r.headers.get('ETag') });
    }
    if (m === 'POST' && uploadId) {
      const { parts, type, size } = await req.json();
      if (!Array.isArray(parts) || !parts.length) return json({ error: '조각 목록이 없습니다.' }, 400);
      const xml = '<CompleteMultipartUpload>' + parts.map(x => `<Part><PartNumber>${Number(x.n)}</PartNumber><ETag>${String(x.etag).replace(/[<>&]/g, '')}</ETag></Part>`).join('') + '</CompleteMultipartUpload>';
      const r = await b2ok(await b2(env, 'POST', key, { query: { uploadId }, signHeaders: { 'content-type': 'application/xml' }, body: xml }), '업로드 완료');
      if (/<Error>/.test(await r.text())) return json({ error: '업로드 완료 처리 실패' }, 502);
      await env.CONTENT.put(`video:${p}`, '', { metadata: { type: String(type || ''), size: Number(size) || 0 } });
      return json({ ok: true, url: `/video/${p}` });
    }
    if (m === 'DELETE' && uploadId) {
      await b2(env, 'DELETE', key, { query: { uploadId } });
      return json({ ok: true });
    }
  }
  if (m === 'DELETE' && (mm = path.match(/^\/api\/video\/(.+)$/))) {
    const p = decodeURIComponent(mm[1]);
    if (!validMediaPath(p)) return json({ error: '파일 경로 형식 오류' }, 400);
    const r = await b2(env, 'DELETE', VIDEO_PREFIX + p);
    if (!r.ok && r.status !== 404) await b2ok(r, '영상 삭제');
    await env.CONTENT.delete(`video:${p}`);
    return json({ ok: true });
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
