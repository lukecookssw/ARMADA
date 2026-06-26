#!/usr/bin/env node
// ARMADA fleet identity — mint a short-lived GitHub App installation token.
//
// Gives the fleet its OWN GitHub identity. `gh` cannot authenticate as a GitHub
// App directly, so the fleet mints an INSTALLATION ACCESS TOKEN itself: sign a
// short-lived JWT with the App's private key -> exchange it for a ~1-hour
// installation token -> use that token as GH_TOKEN for writes and git pushes.
// The token auto-expires; the fleet re-mints on demand. No manual refresh, ever.
//
// Every fleet WRITE runs as the App:
//   GH_TOKEN="$(node "${CLAUDE_PLUGIN_ROOT}/scripts/mint-app-token.mjs")" gh pr comment ...
// so PR/issue comments, review replies, labels, commits and PRs are authored by
// the App's bot login (config `fleetLogin`, e.g. lc-armada-fleet[bot]) instead of
// the maintainer's account. That makes "fleet vs human" detection author-based
// and unambiguous (skills/crows-nest/references/fleet-identity.md).
//
// Reads from the environment (set once per machine — never committed):
//   ARMADA_APP_ID                 the App ID (number on the App's settings page)
//   ARMADA_APP_PRIVATE_KEY_PATH   path to the App's .pem private key file
//   ARMADA_APP_INSTALLATION_ID    (optional) the install id; auto-discovered if unset
//
// The private key never leaves the machine and its CONTENTS never go in env/config
// — only its path does. The minted token is the only thing that crosses to `gh`.
//
// CACHING: a freshly minted installation token is cached (per App+installation)
// under the OS temp dir with its expiry, and reused until ~5 min before it lapses.
// So calling this once per write command is cheap (cache hit = instant, no API
// call) AND a long-running watch (crows-nest /loop, multi-minute builds) gets a
// fresh token automatically the moment the old one nears expiry.
//
// Dependency-free: only Node built-ins, so it runs in ARMADA's no-package.json
// repo and in any installed-plugin cache. Reference it from skills via
// ${CLAUDE_PLUGIN_ROOT}/scripts/mint-app-token.mjs (installed plugins are copied
// to a version cache; relative paths break there).
//
// Modes:
//   (default)   Print a valid installation token to stdout (mint or cache-hit).
//   --check     Mint, then print the resolved identity + visible repos to stderr
//               and a one-line OK/FAIL summary — a self-test for `gh` wiring.
//               Prints nothing to stdout (safe to eyeball; not for GH_TOKEN=).
//
// Run:
//   node scripts/mint-app-token.mjs            # -> token on stdout
//   node scripts/mint-app-token.mjs --check    # -> verify identity, human-readable

import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CHECK = process.argv.includes('--check');

function fail(msg) {
  process.stderr.write(`mint-app-token: ${msg}\n`);
  process.exit(1);
}

const appId = process.env.ARMADA_APP_ID;
const keyPath = process.env.ARMADA_APP_PRIVATE_KEY_PATH;
let instId = process.env.ARMADA_APP_INSTALLATION_ID || '';

if (!appId) fail('ARMADA_APP_ID is not set (the GitHub App id).');
if (!keyPath) fail('ARMADA_APP_PRIVATE_KEY_PATH is not set (path to the App .pem).');
if (!fs.existsSync(keyPath)) fail(`private key not found at ARMADA_APP_PRIVATE_KEY_PATH: ${keyPath}`);

const pem = fs.readFileSync(keyPath, 'utf8');
const b64url = (s) => Buffer.from(s).toString('base64url');

function mintJwt() {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  // iat backdated 60s for clock skew; exp 9 min out (GitHub caps App JWTs at 10).
  const payload = { iat: now - 60, exp: now + 540, iss: appId };
  const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const sig = crypto.sign('RSA-SHA256', Buffer.from(signingInput), pem).toString('base64url');
  return `${signingInput}.${sig}`;
}

async function api(jwt, apiPath, opts = {}) {
  const res = await fetch(`https://api.github.com${apiPath}`, {
    ...opts,
    headers: {
      Authorization: `Bearer ${jwt}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'armada-fleet',
      ...(opts.headers || {}),
    },
  });
  return res;
}

// --- token cache (per App + installation), keyed so machines/apps don't collide.
const cacheKey = crypto.createHash('sha256').update(`${appId}:${keyPath}:${instId}`).digest('hex').slice(0, 16);
const cachePath = path.join(os.tmpdir(), `armada-app-token-${cacheKey}.json`);
const SKEW_MS = 5 * 60 * 1000; // re-mint when within 5 min of expiry

function readCachedToken() {
  try {
    const { token, expires_at } = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
    if (token && expires_at && Date.parse(expires_at) - Date.now() > SKEW_MS) return token;
  } catch {
    /* no/!valid cache -> mint fresh */
  }
  return null;
}

function writeCachedToken(token, expires_at) {
  try {
    fs.writeFileSync(cachePath, JSON.stringify({ token, expires_at }), { mode: 0o600 });
  } catch {
    /* caching is best-effort; a write failure just means we re-mint next time */
  }
}

async function mintInstallationToken() {
  const jwt = mintJwt();
  if (!instId) {
    const res = await api(jwt, '/app/installations');
    if (!res.ok) fail(`could not list installations (HTTP ${res.status}). Check the App id / private key.`);
    const insts = await res.json();
    if (!Array.isArray(insts) || insts.length === 0) fail('the App has no installations — install it on your account/repos first.');
    instId = String(insts[0].id); // single-account install
  }
  const res = await api(jwt, `/app/installations/${instId}/access_tokens`, { method: 'POST' });
  if (!res.ok) {
    const body = await res.text();
    fail(`token exchange failed (HTTP ${res.status}) for installation ${instId}: ${body}`);
  }
  const { token, expires_at } = await res.json();
  if (!token) fail('token exchange returned no token.');
  writeCachedToken(token, expires_at);
  return token;
}

async function getToken() {
  const cached = readCachedToken();
  if (cached) return cached;
  return mintInstallationToken();
}

if (CHECK) {
  const token = await getToken();
  const ghApi = async (p) => {
    const res = await fetch(`https://api.github.com${p}`, {
      headers: {
        Authorization: `token ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'armada-fleet',
      },
    });
    return res.ok ? res.json() : { _error: res.status };
  };
  const me = await ghApi('/installation/repositories');
  const repos = me?.repositories?.map((r) => r.full_name) || [];
  process.stderr.write(`App id            : ${appId}\n`);
  process.stderr.write(`Installation id   : ${instId}\n`);
  process.stderr.write(`Visible repos (${repos.length}) : ${repos.slice(0, 20).join(', ')}${repos.length > 20 ? ', …' : ''}\n`);
  if (repos.length > 0) {
    process.stderr.write('OK — token minted and resolves to the App installation.\n');
    process.exit(0);
  }
  process.stderr.write('FAIL — token minted but no repositories visible. Is the App installed on your repos?\n');
  process.exit(1);
}

process.stdout.write(await getToken());
