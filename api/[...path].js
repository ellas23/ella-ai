const ALLOWED_PREFIXES = ['/api/'];

function bridgeUrl(pathname, search) {
  const base = String(process.env.ELLA_BRIDGE_URL || '').replace(/\/+$/, '');
  if (!base) throw new Error('ELLA_BRIDGE_URL is not configured.');
  return `${base}${pathname}${search || ''}`;
}

async function requestBody(req) {
  if (Buffer.isBuffer(req.body)) return req.body;
  if (req.body instanceof Uint8Array) return Buffer.from(req.body);
  if (req.body instanceof ArrayBuffer) return Buffer.from(req.body);
  if (typeof req.body === 'string') return req.body;
  if (req.body !== undefined) return JSON.stringify(req.body);
  const chunks = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

async function fetchBridge(target, init) {
  const attempts = init.method === 'GET' || init.method === 'HEAD' ? 2 : 1;
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await fetch(target, {
        ...init,
        signal: AbortSignal.timeout(15000)
      });
    } catch (error) {
      lastError = error;
      if (attempt + 1 < attempts) await new Promise(resolve => setTimeout(resolve, 250));
    }
  }
  throw lastError;
}

module.exports = async function handler(req, res) {
  const pathname = new URL(req.url, 'http://vercel.local').pathname;
  if (!ALLOWED_PREFIXES.some(prefix => pathname.startsWith(prefix))) {
    res.status(404).json({ ok: false, error: 'Not found.' });
    return;
  }

  let target;
  try {
    target = bridgeUrl(pathname, new URL(req.url, 'http://vercel.local').search);
  } catch (error) {
    res.status(503).json({ ok: false, error: error.message });
    return;
  }

  const headers = {
    Accept: req.headers.accept || 'application/json',
    'Content-Type': req.headers['content-type'] || 'application/json'
  };
  if (req.headers['content-length']) headers['Content-Length'] = req.headers['content-length'];
  if (req.headers.cookie) headers.Cookie = req.headers.cookie;
  if (req.headers.authorization) headers.Authorization = req.headers.authorization;
  if (process.env.ELLA_BRIDGE_TOKEN) headers['X-Ella-Bridge-Token'] = process.env.ELLA_BRIDGE_TOKEN;

  const init = { method: req.method, headers, redirect: 'manual' };
  if (!['GET', 'HEAD'].includes(req.method)) {
    init.body = await requestBody(req);
  }

  try {
    const upstream = await fetchBridge(target, init);
    const contentType = upstream.headers.get('content-type');
    if (contentType) res.setHeader('Content-Type', contentType);
    const setCookies = typeof upstream.headers.getSetCookie === 'function'
      ? upstream.headers.getSetCookie()
      : (upstream.headers.get('set-cookie') ? [upstream.headers.get('set-cookie')] : []);
    if (setCookies.length) {
      const secureFrontend = req.headers['x-forwarded-proto'] === 'https' || req.headers['x-forwarded-proto'] === undefined;
      res.setHeader('Set-Cookie', setCookies.map(cookie => {
        if (!secureFrontend || /;\s*Secure(?:;|$)/i.test(cookie)) return cookie;
        return `${cookie}; Secure`;
      }));
    }
    if (pathname === '/api/auth/login' || pathname === '/api/auth/status' || pathname === '/api/auth/logout' || pathname.startsWith('/api/')) {
      res.setHeader('Cache-Control', 'no-store, private, max-age=0');
      res.setHeader('Vary', 'Cookie');
    }
    res.status(upstream.status);
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    const buffer = Buffer.from(await upstream.arrayBuffer());
    res.send(buffer);
  } catch (error) {
    res.status(502).json({ ok: false, error: 'Ella bridge is unavailable.' });
  }
};

module.exports.config = { api: { bodyParser: false } };
