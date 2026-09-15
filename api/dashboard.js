const fs = require('fs');
const path = require('path');

const dashboardFile = path.join(process.cwd(), 'dashboard.html');

function requestCookie(req) {
  const cookie = req.headers.cookie || req.headers.Cookie;
  if (Array.isArray(cookie)) return cookie.join('; ');
  return typeof cookie === 'string' ? cookie : '';
}

module.exports = async function dashboardGate(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.status(405).setHeader('Allow', 'GET, HEAD').send('Method not allowed.');
    return;
  }

  try {
    const protocol = req.headers['x-forwarded-proto'] || 'https';
    const host = req.headers.host;
    if (!host) throw new Error('Request host is unavailable.');
    const upstream = await fetch(`${protocol}://${host}/api/auth/status?_=${Date.now()}`, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        ...(requestCookie(req) ? { Cookie: requestCookie(req) } : {}),
      },
      redirect: 'manual'
    });
    const status = upstream.ok ? await upstream.json() : null;
    if (!status?.authenticated) {
      res.setHeader('Cache-Control', 'no-store');
      res.redirect(302, '/admin-login.html');
      return;
    }

    const dashboard = fs.readFileSync(dashboardFile);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'private, no-store, max-age=0');
    if (req.method === 'HEAD') {
      res.status(200).end();
      return;
    }
    res.status(200).send(dashboard);
  } catch (error) {
    res.setHeader('Cache-Control', 'no-store');
    res.redirect(302, '/admin-login.html');
  }
};
