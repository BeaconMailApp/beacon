'use strict';
// Google sign-in for desktop apps: opens the user's real browser, catches the reply on a
// local 127.0.0.1 port (loopback flow with PKCE), then trades the code for tokens.

const http = require('http');
const crypto = require('crypto');
const { shell } = require('electron');

const SCOPES = ['https://www.googleapis.com/auth/gmail.modify'];
// Google Calendar: see and edit events, and see which calendars you have. Asked for, but not required,
// so unticking them on the Google screen still lets mail work.
const CAL_SCOPES = ['https://www.googleapis.com/auth/calendar.events', 'https://www.googleapis.com/auth/calendar.readonly'];
const OPTIONAL_SCOPES = CAL_SCOPES.slice();
const SCOPE = { filters: 'https://www.googleapis.com/auth/gmail.settings.basic', calendar: CAL_SCOPES };
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';

const b64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const PAGE = (title, body, ok) => `<!doctype html><meta charset="utf-8"><title>${title}</title>
<style>body{font-family:Segoe UI,system-ui,sans-serif;background:#11151b;color:#e6e9ef;display:grid;place-items:center;height:100vh;margin:0}
div{max-width:440px;text-align:center;padding:24px}h1{font-weight:500;font-size:22px;color:${ok ? '#6cc38f' : '#f2736a'}}p{color:#a7b0bd;line-height:1.5}</style>
<div><h1>${title}</h1><p>${body}</p></div>`;

function escapeHtml(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

async function postForm(url, params) {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(params).toString() });
  const text = await res.text();
  let json = {};
  try { json = JSON.parse(text); } catch (_) { json = { error: 'bad_response', error_description: text.slice(0, 200) }; }
  if (!res.ok) { const e = new Error(json.error_description || json.error || ('HTTP ' + res.status)); e.code = json.error || 'http_' + res.status; throw e; }
  return json;
}

/** Runs the browser sign-in. Resolves {access_token, refresh_token, expires_at, scope}. */
let cancelCurrent = null;
/** Stops a sign-in that is waiting for the browser (the person closed the tab or changed their mind). */
function cancel() { if (cancelCurrent) cancelCurrent(); }

function signIn(client, { loginHint, timeoutMs = 5 * 60 * 1000 } = {}) {
  return new Promise((resolve, reject) => {
    const verifier = b64url(crypto.randomBytes(48));
    const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
    const state = b64url(crypto.randomBytes(16));
    let done = false;
    let redirectUri = '';

    const finish = (err, val) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      setTimeout(() => server.close(), 1500);
      cancelCurrent = null;
      if (err) reject(err); else resolve(val);
    };

    const server = http.createServer(async (req, res) => {
      const u = new URL(req.url, 'http://127.0.0.1');
      if (u.pathname !== '/') { res.writeHead(404); res.end(); return; }
      const err = u.searchParams.get('error');
      const code = u.searchParams.get('code');
      if (u.searchParams.get('state') !== state) {
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(PAGE('Sign-in did not match', 'Close this tab and try again from Beacon.', false));
        return;
      }
      if (err || !code) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(PAGE('Sign-in cancelled', 'Nothing was changed. You can close this tab and try again from Beacon.', false));
        const e = new Error(err === 'access_denied' ? 'You cancelled the Google sign-in.' : 'Google sign-in failed: ' + (err || 'no code'));
        e.code = err || 'no_code';
        finish(e);
        return;
      }
      try {
        const tok = await postForm(TOKEN_URL, {
          code, client_id: client.client_id, client_secret: client.client_secret,
          redirect_uri: redirectUri, grant_type: 'authorization_code', code_verifier: verifier,
        });
        const granted = String(tok.scope || '').split(/\s+/);
        if (!SCOPES.every((s) => granted.includes(s))) {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(PAGE('Gmail access was not allowed', 'On the Google screen, tick the box that lets Beacon read, compose and send email, then try again.', false));
          const e = new Error('The Gmail permission box was not ticked on the Google screen. Try again and tick it.');
          e.code = 'scope_missing';
          finish(e);
          return;
        }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(PAGE('You are signed in', 'Beacon now has your mail. You can close this tab and go back to the app.', true));
        finish(null, { access_token: tok.access_token, refresh_token: tok.refresh_token, expires_at: Date.now() + (tok.expires_in - 60) * 1000, scope: tok.scope });
      } catch (e) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(PAGE('Sign-in failed', escapeHtml(e.message) + '<br>Close this tab and try again from Beacon.', false));
        finish(e);
      }
    });

    const timer = setTimeout(() => { const e = new Error('Sign-in timed out. Try again.'); e.code = 'timeout'; finish(e); }, timeoutMs);
    if (cancelCurrent) cancelCurrent(); // only one sign-in at a time
    cancelCurrent = () => { const e = new Error('Sign-in cancelled.'); e.code = 'cancelled'; finish(e); };
    server.on('error', (e) => finish(e));
    server.listen(0, '127.0.0.1', () => {
      redirectUri = 'http://127.0.0.1:' + server.address().port;
      const q = new URLSearchParams({
        client_id: client.client_id, redirect_uri: redirectUri, response_type: 'code', scope: SCOPES.concat(OPTIONAL_SCOPES).join(' '),
        code_challenge: challenge, code_challenge_method: 'S256', state, access_type: 'offline', prompt: 'consent select_account',
        include_granted_scopes: 'true',
      });
      if (loginHint) q.set('login_hint', loginHint);
      shell.openExternal(AUTH_URL + '?' + q.toString());
    });
  });
}

async function refresh(client, refreshToken) {
  const tok = await postForm(TOKEN_URL, { client_id: client.client_id, client_secret: client.client_secret, refresh_token: refreshToken, grant_type: 'refresh_token' });
  return { access_token: tok.access_token, expires_at: Date.now() + (tok.expires_in - 60) * 1000, refresh_token: tok.refresh_token || refreshToken };
}

async function revoke(token) {
  try { await fetch(REVOKE_URL + '?token=' + encodeURIComponent(token), { method: 'POST' }); } catch (_) {}
}

module.exports = { signIn, cancel, refresh, revoke, SCOPES, OPTIONAL_SCOPES, CAL_SCOPES, SCOPE };
