// Splunk Cloud client over the 443 web-REST proxy (session login → /splunkd/__raw/services/...).
// Adapted from the proven _tools/splunk-client.mjs. No 8089, no ACS, no IP allowlist.
// Auth = web session login (cval-cookie flow). Works locally and from any deployed backend (443 is public).
//
// Env (server-side only, never shipped to the browser):
//   SPLUNK_URL, SPLUNK_USER, SPLUNK_PASS, optional SPLUNK_LOCALE (default en-GB).

export class SplunkClient {
  constructor(opts = {}) {
    this.base = (opts.url || process.env.SPLUNK_URL || '').replace(/\/$/, '');
    this.user = opts.user || process.env.SPLUNK_USER;
    this.pass = opts.pass || process.env.SPLUNK_PASS;
    this.locale = opts.locale || process.env.SPLUNK_LOCALE || 'en-GB';
    this.cookies = {};
    this.csrf = '';
    this.loggedIn = false;
  }

  _store(res) {
    const sc = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
    for (const c of sc) {
      const kv = c.split(';')[0];
      const i = kv.indexOf('=');
      if (i > 0) this.cookies[kv.slice(0, i).trim()] = kv.slice(i + 1);
    }
  }
  _cookieHeader() {
    return Object.entries(this.cookies).map(([k, v]) => `${k}=${v}`).join('; ');
  }
  _proxy(p) {
    return `${this.base}/${this.locale}/splunkd/__raw${p}`;
  }
  // Always bypass Next.js's fetch cache: this is a stateful session/cookie flow, and a
  // cached GET on the login page would return stale (cookie-less) responses, breaking auth.
  _fetch(url, init = {}) {
    return fetch(url, { cache: 'no-store', ...init });
  }
  _headers(extra = {}) {
    return {
      Cookie: this._cookieHeader(),
      'X-Splunk-Form-Key': this.csrf,
      'X-Requested-With': 'XMLHttpRequest',
      ...extra,
    };
  }

  async login() {
    if (!this.base || !this.user || !this.pass) {
      throw new Error('Splunk not configured: set SPLUNK_URL / SPLUNK_USER / SPLUNK_PASS');
    }
    let r = await this._fetch(`${this.base}/${this.locale}/account/login`, { redirect: 'manual' });
    this._store(r);
    await r.text();
    const form = new URLSearchParams({
      username: this.user,
      password: this.pass,
      cval: this.cookies.cval || '',
      return_to: `/${this.locale}/app/launcher/home`,
    });
    r = await this._fetch(`${this.base}/${this.locale}/account/login`, {
      method: 'POST',
      redirect: 'manual',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: this._cookieHeader() },
      body: form.toString(),
    });
    this._store(r);
    if (r.status >= 400) throw new Error('Splunk login failed: ' + r.status);
    const k = Object.keys(this.cookies).find((x) => x.startsWith('splunkweb_csrf_token'));
    this.csrf = k ? this.cookies[k] : '';
    this.loggedIn = true;
    return this;
  }

  // Run an SPL search (oneshot). Returns parsed result rows.
  async search(spl, { earliest = '-24h', latest = 'now' } = {}) {
    const search = spl.startsWith('|') || spl.startsWith('search') ? spl : 'search ' + spl;
    const body = new URLSearchParams({
      search,
      exec_mode: 'oneshot',
      output_mode: 'json',
      earliest_time: earliest,
      latest_time: latest,
      count: '0',
    });
    const r = await this._fetch(this._proxy('/services/search/jobs'), {
      method: 'POST',
      headers: this._headers({ 'Content-Type': 'application/x-www-form-urlencoded' }),
      body: body.toString(),
    });
    const t = await r.text();
