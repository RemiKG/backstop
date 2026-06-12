// Gemini (Vertex AI) — the agent's reasoning brain. NOT a chat key; authenticates with a
// Google service-account via a self-signed JWT (zero npm deps) and calls the Vertex
// :generateContent REST endpoint. Used ONLY to accelerate the SPL dependency parse —
// it never decides health. Strip it out (regex-only mode) and the map still computes.
//
// Env (server-side only) — the SA is read from EITHER source, file first, env-var second:
//   GOOGLE_APPLICATION_CREDENTIALS = absolute path to the Vertex SA json (local dev / Cloud Run)
//   VERTEX_SA_JSON                  = the SA json INLINE as a string (serverless hosts with no
//                                     filesystem key, e.g. Vercel). Plain JSON or base64-encoded.
//   VERTEX_PROJECT (default rapid-agents-5166), VERTEX_LOCATION (default global),
//   VERTEX_MODEL (default gemini-flash-latest)

import crypto from 'crypto';
import fs from 'fs';

const PROJECT = process.env.VERTEX_PROJECT || 'rapid-agents-5166';
const LOCATION = process.env.VERTEX_LOCATION || 'global';
const MODEL = process.env.VERTEX_MODEL || 'gemini-flash-latest';

let _sa = null;
let _tokenCache = { token: null, exp: 0 };

function loadSA() {
  if (_sa) return _sa;
  // 1) Inline JSON in an env var (Vercel and any host without a writable key file).
  const inline = process.env.VERTEX_SA_JSON;
  if (inline && inline.trim()) {
    try {
      const raw = inline.trim().startsWith('{')
        ? inline
        : Buffer.from(inline, 'base64').toString('utf8');
      _sa = JSON.parse(raw);
      return _sa;
    } catch {
      // fall through to the file path
    }
  }
  // 2) A key file on disk (local dev; Cloud Run binds the SA so this is also unset there).
  const p = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (p && fs.existsSync(p)) {
    try {
      _sa = JSON.parse(fs.readFileSync(p, 'utf8'));
      return _sa;
    } catch {
      return null;
    }
  }
  return null;
}

export function geminiConfigured() {
  return !!loadSA();
}

const b64url = (b) =>
  Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function mintToken() {
  const sa = loadSA();
  if (!sa) throw new Error('Vertex SA not configured (GOOGLE_APPLICATION_CREDENTIALS missing)');
  const now = Math.floor(Date.now() / 1000);
  if (_tokenCache.token && _tokenCache.exp - 60 > now) return _tokenCache.token;
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = b64url(
    JSON.stringify({
      iss: sa.client_email,
      scope: 'https://www.googleapis.com/auth/cloud-platform',
      aud: 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600,
    })
  );
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(`${header}.${claim}`);
  signer.end();
  const sig = b64url(signer.sign(sa.private_key));
  const jwt = `${header}.${claim}.${sig}`;
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });
  const j = await r.json();
  if (!j.access_token) throw new Error('token mint failed: ' + JSON.stringify(j).slice(0, 200));
  _tokenCache = { token: j.access_token, exp: now + (j.expires_in || 3600) };
  return j.access_token;
}

// Raw single-shot generate. Retries once on the documented 403-IAM-propagation race.
export async function generate(prompt, { maxOutputTokens = 2048, temperature = 0, json = true } = {}) {
  const url = `https://aiplatform.googleapis.com/v1/projects/${PROJECT}/locations/${LOCATION}/publishers/google/models/${MODEL}:generateContent`;
  const payload = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      maxOutputTokens,
      temperature,
      ...(json ? { responseMimeType: 'application/json' } : {}),
    },
  };
  let lastErr = '';
  for (let attempt = 0; attempt < 3; attempt++) {
    const token = await mintToken();
    const r = await fetch(url, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const txt = await r.text();
    if (r.status === 403 && /predict|denied|propagat/i.test(txt)) {
      lastErr = txt.slice(0, 200);
      await new Promise((s) => setTimeout(s, 1500 * (attempt + 1)));
      continue;
    }
    if (r.status >= 400) throw new Error('vertex ' + r.status + ': ' + txt.slice(0, 200));
    const j = JSON.parse(txt);
    return j.candidates?.[0]?.content?.parts?.[0]?.text || '';
  }
  throw new Error('vertex retry exhausted: ' + lastErr);
}

export const VERTEX_META = { project: PROJECT, location: LOCATION, model: MODEL };
