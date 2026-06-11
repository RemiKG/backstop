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
    if (r.status >= 400) throw new Error(`search ${r.status}: ${t.slice(0, 300)}`);
    return JSON.parse(t).results || [];
  }

  // Ingest a single event over receivers/simple. A leading ISO/epoch in `eventText`
  // is auto-extracted as _time by Splunk's default props — this is how the seeder
  // creates past-dated (already-blind) and fresh events on REAL timestamps.
  async ingest(index, sourcetype, source, eventText) {
    const r = await this._fetch(
      this._proxy(
        `/services/receivers/simple?index=${encodeURIComponent(index)}&sourcetype=${encodeURIComponent(
          sourcetype
        )}&source=${encodeURIComponent(source)}`
      ),
      { method: 'POST', headers: this._headers({ 'Content-Type': 'text/plain' }), body: eventText }
    );
    if (r.status >= 400) throw new Error('ingest ' + r.status + ' ' + (await r.text()).slice(0, 200));
    return true;
  }

  async listIndexes() {
    const r = await this._fetch(
      this._proxy('/services/data/indexes?output_mode=json&count=0&search=isInternal=0'),
      { headers: this._headers() }
    );
    return JSON.parse(await r.text()).entry.map((e) => e.name);
  }

  async ensureIndex(name) {
    const have = await this.listIndexes();
    if (have.includes(name)) return false;
    const r = await this._fetch(this._proxy('/services/data/indexes'), {
      method: 'POST',
      headers: this._headers({ 'Content-Type': 'application/x-www-form-urlencoded' }),
      body: new URLSearchParams({ name, output_mode: 'json' }).toString(),
    });
    if (r.status >= 400) throw new Error('ensureIndex ' + r.status + ' ' + (await r.text()).slice(0, 200));
    return true;
  }

  // Enumerate every saved search / alert on the instance. Returns the raw SPL, cron,
  // window, actions, and category for each — the detection estate. No premium app needed.
  async savedSearches() {
    const r = await this._fetch(this._proxy('/services/saved/searches?output_mode=json&count=0'), {
      headers: this._headers(),
    });
    const t = await r.text();
    if (r.status >= 400) throw new Error('saved/searches ' + r.status + ': ' + t.slice(0, 200));
    const j = JSON.parse(t);
    return (j.entry || []).map((e) => {
      const c = e.content || {};
      return {
        name: e.name,
        app: (e.acl && e.acl.app) || '',
        search: c.search || '',
        cron: c.cron_schedule || '',
        earliest: c['dispatch.earliest_time'] || '',
        latest: c['dispatch.latest_time'] || '',
        isScheduled: c.is_scheduled === '1' || c.is_scheduled === true || c.is_scheduled === 1,
        actions: c.actions || '',
        description: c.description || '',
        disabled: c.disabled === '1' || c.disabled === true || c.disabled === 1,
      };
    });
  }

  // Create (or update) a saved search. Used by the seeder to plant a realistic
  // detection estate, and by Hand-back to schedule the Backstop meta-detection.
  async upsertSavedSearch(name, props) {
    // Try create first; if it exists (409), POST to the named endpoint to update.
    const mk = new URLSearchParams({ name, output_mode: 'json', ...props });
    let r = await this._fetch(this._proxy('/services/saved/searches'), {
      method: 'POST',
      headers: this._headers({ 'Content-Type': 'application/x-www-form-urlencoded' }),
      body: mk.toString(),
    });
    if (r.status === 409) {
      const upd = new URLSearchParams({ output_mode: 'json', ...props });
      r = await this._fetch(this._proxy('/services/saved/searches/' + encodeURIComponent(name)), {
        method: 'POST',
        headers: this._headers({ 'Content-Type': 'application/x-www-form-urlencoded' }),
        body: upd.toString(),
      });
    }
    if (r.status >= 400) throw new Error('upsertSavedSearch ' + r.status + ' ' + (await r.text()).slice(0, 200));
    return true;
  }

  async deleteSavedSearch(name) {
    const r = await this._fetch(this._proxy('/services/saved/searches/' + encodeURIComponent(name)), {
      method: 'DELETE',
      headers: this._headers(),
    });
    return r.status < 400;
  }

  // Write the coverage-gap map back into the user's own Splunk as a CSV lookup, so the
  // meta-monitoring survives outside the app. Uses | makeresults count=N + per-row case()
  // eval (reliable over the oneshot proxy — append-subsearch composition is not), then
  // | outputlookup, which creates the lookup file automatically.
  async writeLookup(lookupName, rows) {
    if (!rows.length) return false;
    const cols = Object.keys(rows[0]);
    const esc = (v) => String(v == null ? '' : v).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    // For each column, a case() that maps row index _r -> the value for that row.
    const evals = cols
      .map((c) => {
        const branches = rows.map((row, i) => `_r=${i + 1},"${esc(row[c])}"`).join(', ');
        return `eval ${c}=case(${branches})`;
      })
      .join(' | ');
    const spl =
      `| makeresults count=${rows.length} | streamstats count as _r | ${evals} ` +
      `| table ${cols.join(', ')} | outputlookup ${lookupName}.csv`;
    await this.search(spl, { earliest: '-1m', latest: 'now' });
    return true;
  }

  // Read a lookup back (verification / Hand-back display).
  async readLookup(lookupName) {
    try {
      return await this.search(`| inputlookup ${lookupName}.csv`, { earliest: '-1m', latest: 'now' });
    } catch {
      return [];
    }
  }

  // Official Splunk MCP Server seam (app 7931, /services/mcp). Returns null when not installed.
  async mcp(path = '', init = {}) {
    const r = await this._fetch(this._proxy('/services/mcp' + path), {
      ...init,
      headers: this._headers(init.headers || {}),
    });
    if (r.status === 404) return null;
    return r;
  }

  // True iff the official Splunk MCP Server app is installed and reachable.
  async mcpAvailable() {
    try {
      const r = await this.mcp('', {});
      return !!r && r.status < 400;
    } catch {
      return false;
    }
  }

  // Build a deep link into the user's own Splunk search app with a query pre-filled.
  // Powers the "Run this in Search" button (the anti-fake, re-measure-it-yourself move).
  searchDeepLink(spl, { earliest = '-30d', latest = 'now' } = {}) {
    const q = encodeURIComponent(spl);
    return `${this.base}/${this.locale}/app/search/search?q=${q}&earliest=${encodeURIComponent(
      earliest
    )}&latest=${encodeURIComponent(latest)}`;
  }
}
