#!/usr/bin/env node
// =============================================================================
// scan-secrets.mjs — deterministic secret / PII scan (gauntlet step g).
// -----------------------------------------------------------------------------
// Zero dependencies (Node >= 18). Scans every file git would commit: tracked files
// plus untracked files that are not ignored, and also the STAGED copy of each staged file
// (a commit holds the index, which can differ from the working tree). Exits 1 when it
// finds anything, so the pre-commit hook and CI block the commit.
//
// This repo publishes golden DOM fixtures captured from live chat UIs, so the rules
// concentrate on what those captures can leak: provider conversation URLs that carry a
// real id, account identifiers (avatars, org ids), session cookies and tokens, e-mail
// addresses, personal numbers and the network identity a Cloudflare gate page prints,
// plus the usual credential shapes. Each line is also scanned after HTML-entity and
// %-decoding, so an address written with `&#64;` for the at-sign, or `%2Fchat%2F<uuid>`, cannot slip past.
//
// A fixture the scanner cannot read (binary, UTF-16 without a BOM, over 2 MB) is itself a
// finding: silently skipping it would let the largest captures through unchecked.
//
// Usage:
//   node scripts/scan-secrets.mjs                scan the working tree + staged copies
//   node scripts/scan-secrets.mjs --history      scan every line added on any ref
//   node scripts/scan-secrets.mjs --self-test    prove every rule and the engine behave (add
//                                                --full for the slow git-backed checks; CI and
//                                                a staged edit of this file run them anyway)
//   node scripts/scan-secrets.mjs --list-rules
//   node scripts/scan-secrets.mjs --root DIR     scan another checkout
//   node scripts/scan-secrets.mjs --files A B..  scan exactly these files (working copy)
//
// scripts/scan-secrets.allowlist.json holds the policy: `allow` (a justified exception is
// rule + path glob + reason, optionally the matched text) and `denyInFixtures` (names that
// must never appear inside a fixture). Findings never print PII or a full secret.
//
// This file must itself pass the scan, so the self-test samples below are assembled from
// pieces at run time and no credential-shaped literal appears in the source.
// =============================================================================

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const MAX_BYTES = 2 * 1024 * 1024;
const HERE = dirname(fileURLToPath(import.meta.url));

const inFixtures = (path) => path.startsWith('test/fixtures/');

// Words that mean "this is not a real value".
const PLACEHOLDER =
  /(?:REDACTED|EXAMPLE|PLACEHOLDER|CHANGEME|CHANGE_ME|YOUR[_-]|<[^>]+>|\$\{|\{\{|x{4,}|\*{4,}|dummy|sample|fake)/i;

// File extensions that make `name@2x.png` look like an address.
const ASSET_TLD =
  /\.(?:png|jpe?g|gif|svg|webp|avif|ico|bmp|css|m?js|cjs|tsx?|jsx|json|map|md|html?|woff2?|ttf|otf|eot|mp[34]|webm|wav|ogg|pdf|txt|xml|ya?ml|toml|lock)$/i;

// Addresses that are public by design or explicitly synthetic.
const EMAIL_OK = [
  /@(?:[\w-]+\.)*example\.(?:com|org|net)$/i,
  /@(?:[\w-]+\.)*[\w-]+\.(?:invalid|test|example|localhost)$/i,
  /@users\.noreply\.github\.com$/i,
  /^(?:noreply|no-reply)@(?:anthropic|github)\.com$/i,
  /^git@(?:github|gitlab|bitbucket)\.(?:com|org)$/i,
];

const shannon = (s) => {
  const counts = new Map();
  for (const ch of s) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  let h = 0;
  for (const n of counts.values()) h -= (n / s.length) * Math.log2(n / s.length);
  return h;
};

const luhn = (digits) => {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
};

// Private, loopback, link-local and documentation (RFC 5737) IPv4 addresses carry no identity.
function publicIpv4(text) {
  const o = text.split('.').map(Number);
  if (o.length !== 4 || o.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  const [a, b, c] = o;
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 100 && b >= 64 && b <= 127) return false; // carrier-grade NAT, RFC 6598
  if (a === 192 && b === 168) return false;
  if (a === 169 && b === 254) return false;
  if (a === 192 && b === 0 && c === 2) return false;
  if (a === 198 && b === 51 && c === 100) return false;
  if (a === 203 && b === 0 && c === 113) return false;
  return true;
}

// Each rule: id, why, re (global), optional scope(path), pre(line) prefilter, skip(match).
const RULES = [
  {
    id: 'private-key-block',
    why: 'private key material',
    re: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY(?: BLOCK)?-----/g,
  },
  { id: 'aws-access-key-id', why: 'AWS access key id', re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  {
    id: 'github-token',
    why: 'GitHub token',
    re: /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{50,})\b/g,
  },
  { id: 'slack-token', why: 'Slack token', re: /\bxox[abprs]-[A-Za-z0-9-]{10,}/g },
  { id: 'google-api-key', why: 'Google API key', re: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  {
    id: 'llm-api-key',
    why: 'OpenAI/Anthropic-style API key',
    pre: (line) => line.includes('sk-'),
    re: /\bsk-(?:ant-|proj-|live-|test-)?[A-Za-z0-9_-]{20,}/g,
  },
  {
    id: 'jwt',
    why: 'JSON web token',
    pre: (line) => line.includes('eyJ'),
    re: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
  },
  {
    id: 'bearer-token',
    why: 'bearer credential',
    pre: (line) => line.includes('Bearer'),
    re: /\bBearer\s+([A-Za-z0-9._~+/-]{20,}=*)/g,
    skip: (m) => PLACEHOLDER.test(m[1]),
  },
  {
    id: 'session-cookie',
    why: 'session cookie / auth token value',
    re: /\b(?:cf_clearance|__cf_bm|_cfuvid|_ga|_gid|sessionKey|sessionid|__Secure-[A-Za-z0-9._-]*(?:session|token)[A-Za-z0-9._-]*|__Host-[A-Za-z0-9._-]+|SAPISID|APISID|HSID|SSID)\s*[=:]\s*["']?([A-Za-z0-9._%~+/-]{16,})/g,
    // A real cookie value has digits and entropy; `request.cookies.get` has neither.
    skip: (m) => PLACEHOLDER.test(m[1]) || !/\d/.test(m[1]) || shannon(m[1]) < 3.0,
  },
  {
    id: 'email-address',
    why: 'e-mail address',
    pre: (line) => line.includes('@'),
    // Anchored at the start of a run so each run is tried once (no quadratic backtracking) and
    // closed with a boundary so `inter@italic.woff2` is not read as an address.
    re: /(?<![A-Za-z0-9._%+-])[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}(?![A-Za-z0-9-])/g,
    skip: (m) => ASSET_TLD.test(m[0]) || EMAIL_OK.some((ok) => ok.test(m[0])),
  },
  {
    id: 'conversation-url',
    why: 'provider conversation URL carrying a real id (replace the id with REDACTED-CONVERSATION-ID)',
    re: /\b(?:claude\.ai\/(?:chat|share|project)|chatgpt\.com\/(?:c|share)|chat\.openai\.com\/(?:c|share)|gemini\.google\.com\/(?:app|share)|grok\.com\/(?:chat|share)|(?:www\.)?meta\.ai\/(?:prompt|chat))\/((?=[A-Za-z0-9_-]*\d)[A-Za-z0-9_-]{8,})/g,
    skip: (m) => PLACEHOLDER.test(m[1]),
  },
  {
    id: 'fixture-uuid',
    why: 'UUID inside a fixture (real conversation/account ids look like this; use an obviously synthetic value)',
    scope: inFixtures,
    re: /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,
  },
  {
    id: 'account-id',
    why: 'account identifier inside a fixture (avatar URL, org/user/account id, Gemini conversation id)',
    scope: inFixtures,
    re: /(?:lh\d\.googleusercontent\.com\/a\/[A-Za-z0-9_-]{16,}|gravatar\.com\/avatar\/[0-9a-f]{32}|files\.oaiusercontent\.com\/[^\s"'<>]*[?&]sig=|\b(?:org|user)-[A-Za-z0-9]{20,}\b|\bacct_[A-Za-z0-9]{10,}\b|\bc_[0-9a-f]{12,}\b)/gi,
  },
  {
    id: 'cloudflare-ray-id',
    why: 'Cloudflare Ray ID inside a fixture (identifies the capture)',
    scope: inFixtures,
    re: /Ray ID:?\s*(?:<[^>]*>\s*)*[0-9a-f]{16}\b/gi,
  },
  {
    id: 'public-ip',
    why: 'public IPv4 address inside a fixture (a gate page prints the visitor\'s address)',
    scope: inFixtures,
    // Not inside a path, version or hyphenated name (`/lib/1.2.3.4/`, `node-20.11.1.0`, `v1.2.3.4`),
    // but a sentence-final address ("...is 8.8.4.4.") still counts.
    re: /(?<![\w/.-])(?:\d{1,3}\.){3}\d{1,3}(?![\w/-]|\.\d)/g,
    skip: (m) => !publicIpv4(m[0]),
  },
  {
    id: 'us-ssn',
    why: 'US social security number',
    re: /(?<![\w-])(?!000|666|9\d\d)\d{3}-(?!00)\d{2}-(?!0000)\d{4}(?![\w-])/g,
  },
  {
    id: 'payment-card',
    why: 'payment card number (Luhn-valid)',
    re: /(?<![\w-])(?:(?:4\d{3}|5[1-5]\d{2}|2[2-7]\d{2}|6011)(?:[ -]?\d{4}){3}|3[47]\d{2}[ -]?\d{6}[ -]?\d{5})(?![\w-])/g,
    skip: (m) => !luhn(m[0].replace(/[ -]/g, '')),
  },
  {
    id: 'phone-number',
    why: 'phone number',
    re: /(?<![\w.-])(?:\+?1[ .-])?\(?[2-9]\d{2}\)?[ .-][2-9]\d{2}[ .-]\d{4}(?![\w-])/g,
    // 555-0100..0199 is the range reserved for fiction; test data may use it freely.
    skip: (m) => /555[ .-]01\d\d$/.test(m[0]),
  },
  {
    id: 'secret-assignment',
    why: 'high-entropy value assigned to a secret-like name',
    re: /\b(?:api[_-]?key|secret(?:[_-]?key)?|access[_-]?token|auth[_-]?token|token|password|passwd|client[_-]?secret|private[_-]?key)\b["']?\s*[:=]\s*["']([^"'\s]{12,})["']/gi,
    skip: (m) => PLACEHOLDER.test(m[1]) || shannon(m[1]) < 3.5,
  },
];

// Findings the engine itself raises (not regex rules): a fixture it could not read.
const ENGINE_RULES = {
  'unscannable-fixture': 'fixture cannot be scanned (binary, UTF-16 without a BOM, or over 2 MB): minimize it or save it as UTF-8 text',
};

// Findings whose text is personal: print only its length, never a fragment.
const PII_RULES = new Set(['email-address', 'us-ssn', 'payment-card', 'phone-number', 'owner-term', 'public-ip']);

const mask = (f) => {
  if (f.rule in ENGINE_RULES) return 'n/a';
  if (PII_RULES.has(f.rule)) return `${f.text.length} chars`;
  if (f.rule === 'conversation-url') return f.text.replace(/[^/]+$/, '…');
  return `${f.text.slice(0, 4)}… (${f.text.length} chars)`;
};

// A name that must never appear inside a fixture (the account owner's, say).
function buildDenyRule(terms) {
  const list = (terms ?? []).map((t) => String(t).trim()).filter(Boolean);
  if (list.length === 0) return null;
  const source = list.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  return {
    id: 'owner-term',
    why: 'a name from denyInFixtures appears inside a fixture (account menus and avatars print it)',
    scope: inFixtures,
    // Starts at a word boundary so "destroy hardened steel" does not match "Roy Harden"; there is
    // deliberately no trailing boundary, so a mailbox such as "royhardenre" still matches "royharden".
    re: new RegExp(`(?<![A-Za-z0-9])(?:${source})`, 'gi'),
  };
}

// ------------------------------------------------------------------- policy file
function globToRegExp(glob) {
  const g = glob.split('\\').join('/');
  let out = '';
  for (let i = 0; i < g.length; i++) {
    const c = g[i];
    if (c === '*') {
      if (g[i + 1] === '*') {
        i++;
        if (g[i + 1] === '/') {
          i++;
          out += '(?:.*/)?';
        } else out += '.*';
      } else out += '[^/]*';
    } else if (c === '?') out += '[^/]';
    else out += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${out}$`);
}

function parsePolicy(parsed) {
  const entries = Array.isArray(parsed?.allow) ? parsed.allow : [];
  const ids = new Set([...RULES.map((r) => r.id), ...Object.keys(ENGINE_RULES), 'owner-term']);
  const allow = entries.map((e, i) => {
    if (!ids.has(e.rule) || !e.path || !String(e.reason ?? '').trim()) {
      throw new Error(`scan-secrets.allowlist.json entry ${i}: needs a known "rule", a "path" and a non-empty "reason"`);
    }
    return { rule: e.rule, path: globToRegExp(e.path), contains: e.contains ?? null };
  });
  return { allow, deny: buildDenyRule(parsed?.denyInFixtures) };
}

function loadPolicy(root) {
  const file = join(root, 'scripts', 'scan-secrets.allowlist.json');
  return existsSync(file) ? parsePolicy(JSON.parse(readFileSync(file, 'utf8'))) : parsePolicy({});
}

const isAllowed = (allow, finding) =>
  allow.some(
    (a) => a.rule === finding.rule && a.path.test(finding.path) && (a.contains === null || finding.text.includes(a.contains)),
  );

// ------------------------------------------------------------------- scanning
const ENTITIES = {
  amp: '&', commat: '@', period: '.', sol: '/', lowbar: '_', hyphen: '-', colon: ':', quot: '"', apos: "'",
  lt: '<', gt: '>', num: '#', plus: '+', equals: '=', percnt: '%', excl: '!', quest: '?',
};
const ENCODED = /&#?[a-z0-9]{1,8};|%[0-9a-f]{2}/i;

const codePoint = (n, whole) => (Number.isInteger(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : whole);

// HTML-entity and percent decoding, twice so `&amp;#64;` and `%2540` also resolve.
function decodeLine(line) {
  let out = line;
  for (let pass = 0; pass < 2; pass++) {
    const before = out;
    out = out
      .replace(/&#x([0-9a-f]{1,6});/gi, (m, h) => codePoint(parseInt(h, 16), m))
      .replace(/&#(\d{1,7});/g, (m, d) => codePoint(Number(d), m))
      .replace(/&([a-z]{2,8});/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m)
      .replace(/%([0-9a-f]{2})/gi, (m, h) => String.fromCharCode(parseInt(h, 16)));
    if (out === before) break;
  }
  return out;
}

function scanLine(line, lineNo, path, rules, decoded, findings) {
  for (const rule of rules) {
    if (rule.scope && !rule.scope(path)) continue;
    if (rule.pre && !rule.pre(line)) continue;
    const re = new RegExp(rule.re.source, rule.re.flags);
    let m;
    while ((m = re.exec(line)) !== null) {
      if (m[0] === '') re.lastIndex++;
      if (rule.skip && rule.skip(m)) continue;
      findings.push({ path, line: lineNo, col: decoded ? 1 : m.index + 1, rule: rule.id, why: rule.why, text: m[0], decoded });
    }
  }
}

function scanText(text, path, rules = RULES) {
  const findings = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    scanLine(lines[i], i + 1, path, rules, false, findings);
    if (ENCODED.test(lines[i])) {
      const decoded = decodeLine(lines[i]);
      if (decoded !== lines[i]) {
        const extra = [];
        scanLine(decoded, i + 1, path, rules, true, extra);
        const known = new Set(findings.filter((f) => f.line === i + 1).map((f) => `${f.rule}|${f.text}`));
        for (const f of extra) if (!known.has(`${f.rule}|${f.text}`)) findings.push(f);
      }
    }
  }
  return findings;
}

function decodeBuffer(buf) {
  if (buf.length > MAX_BYTES) return { skip: 'oversize' };
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) return { text: buf.subarray(2).toString('utf16le') };
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
    const body = Buffer.from(buf.subarray(2, buf.length - ((buf.length - 2) % 2)));
    return { text: body.swap16().toString('utf16le') };
  }
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) return { text: buf.subarray(3).toString('utf8') };
  if (buf.subarray(0, 8192).includes(0)) return { skip: 'binary' };
  return { text: buf.toString('utf8') };
}

const unscannable = (path) => [
  { path, line: 1, col: 1, rule: 'unscannable-fixture', why: ENGINE_RULES['unscannable-fixture'], text: path },
];

function scanBuffer(buf, path, rules) {
  const d = decodeBuffer(buf);
  if (d.skip) return { findings: inFixtures(path) ? unscannable(path) : [], skipped: d.skip };
  return { findings: scanText(d.text, path, rules), skipped: null };
}

const git = (root, ...args) =>
  execFileSync('git', args, { cwd: root, maxBuffer: 512 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });

const posix = (p) => p.split('\\').join('/');

function scanTree(root, explicitFiles, rules = RULES) {
  let files = explicitFiles;
  if (!files) {
    try {
      files = git(root, 'ls-files', '-z', '--cached', '--others', '--exclude-standard').toString('utf8').split('\0').filter(Boolean);
    } catch (err) {
      throw new Error(`cannot list files: ${root} is not a git checkout (${err.message.split('\n')[0]})`);
    }
  } else {
    files = files.map((f) => {
      const abs = resolve(root, f);
      if (!existsSync(abs)) throw new Error(`--files: ${f} does not exist`);
      return posix(relative(root, abs));
    });
  }
  const findings = [];
  const skipped = { binary: 0, oversize: 0 };
  let scanned = 0;
  const tally = (r) => {
    if (r.skipped) skipped[r.skipped]++;
    else scanned++;
  };
  for (const rel of new Set(files)) {
    const abs = resolve(root, rel);
    if (!existsSync(abs)) continue; // deleted in the working tree
    const st = statSync(abs);
    if (!st.isFile()) continue;
    const r = st.size > MAX_BYTES ? scanBuffer(Buffer.alloc(MAX_BYTES + 1), posix(rel), rules) : scanBuffer(readFileSync(abs), posix(rel), rules);
    tally(r);
    findings.push(...r.findings);
  }

  // A commit holds the INDEX, not the working tree. A file staged with a secret and then
  // edited clean in the working tree passes the loop above yet would still be committed, so
  // scan the staged copy of every staged file too. Findings identical to one already found in
  // the working copy are not reported twice.
  if (!explicitFiles) {
    const seen = new Set(findings.map((f) => `${f.rule}|${f.path}|${f.line}|${f.col}|${f.text}`));
    const staged = git(root, 'diff', '--cached', '--name-only', '-z', '--diff-filter=ACMR').toString('utf8').split('\0').filter(Boolean);
    for (const rel of staged) {
      const r = scanBuffer(git(root, 'show', `:${rel}`), rel, rules);
      for (const f of r.findings) {
        if (!seen.has(`${f.rule}|${f.path}|${f.line}|${f.col}|${f.text}`)) findings.push({ ...f, where: 'staged' });
      }
    }
  }
  return { findings, scanned, skipped };
}

// Undo git's C-style quoting of a path (`"caf\303\251"`), which it applies to unusual names.
function unquoteGitPath(quoted) {
  const inner = quoted.slice(1, -1);
  const simple = { t: 9, n: 10, r: 13, a: 7, b: 8, f: 12, v: 11 };
  const bytes = [];
  for (let i = 0; i < inner.length; i++) {
    if (inner[i] !== '\\') {
      bytes.push(...Buffer.from(inner[i]));
      continue;
    }
    const n = inner[++i];
    if (/[0-7]/.test(n)) {
      let oct = n;
      while (oct.length < 3 && /[0-7]/.test(inner[i + 1] ?? '')) oct += inner[++i];
      bytes.push(parseInt(oct, 8));
    } else bytes.push(simple[n] ?? n.charCodeAt(0));
  }
  return Buffer.from(bytes).toString('utf8');
}

function plusPath(header) {
  const raw = header.replace(/\t$/, '');
  if (raw === '/dev/null') return '';
  const unq = raw.startsWith('"') ? unquoteGitPath(raw) : raw;
  return unq.startsWith('b/') ? unq.slice(2) : unq;
}

// Every line ever added on any ref. A merge commit is diffed against its first parent so an
// "evil merge" resolution is seen; the same finding is reported once, at its first commit.
function scanHistory(root, rules = RULES) {
  const log = git(
    root, '-c', 'core.quotePath=false', 'log', '--all', '--no-color', '--no-ext-diff',
    '--diff-merges=first-parent', '-p', '-U0', '--format=@@commit %h',
  ).toString('utf8');
  const findings = [];
  const reported = new Set();
  let commit = '';
  let path = '';
  let line = 0;
  let oldLeft = 0;
  let newLeft = 0;
  let commits = 0;
  for (const raw of log.split('\n')) {
    if (oldLeft > 0 || newLeft > 0) {
      // Inside a hunk body the header counts say how many lines follow, so a content line that
      // happens to begin `++ ` is never mistaken for a `+++ ` file header.
      if (raw.startsWith('+')) {
        newLeft--;
        if (path) {
          for (const f of scanText(raw.slice(1), path, rules)) {
            const key = `${f.rule}|${path}|${f.text}`;
            if (!reported.has(key)) {
              reported.add(key);
              findings.push({ ...f, line, where: commit });
            }
          }
        }
        line++;
        continue;
      }
      if (raw.startsWith('-')) {
        oldLeft--;
        continue;
      }
      if (raw.startsWith('\\')) continue; // "\ No newline at end of file"
      oldLeft = 0;
      newLeft = 0;
    }
    if (raw.startsWith('@@commit ')) {
      commit = raw.slice(9).trim();
      commits++;
      path = '';
    } else if (raw.startsWith('diff --git ')) {
      path = '';
    } else if (raw.startsWith('+++ ')) {
      path = plusPath(raw.slice(4));
    } else if (raw.startsWith('@@ ')) {
      const m = /^@@ -\d+(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(raw);
      if (m) {
        oldLeft = m[1] === undefined ? 1 : Number(m[1]);
        line = Number(m[2]);
        newLeft = m[3] === undefined ? 1 : Number(m[3]);
      }
    }
  }
  return { findings, scanned: commits };
}

// -------------------------------------------------------------------- self-test
// Samples are assembled from parts so this source contains no credential-shaped literal.
const j = (...parts) => parts.join('');
const CASES = [
  // [rule, path, positives, negatives]
  ['private-key-block', 'a.txt', [j('-----BEGIN ', 'RSA PRIVATE KEY-----')], ['-----BEGIN PUBLIC KEY-----']],
  ['aws-access-key-id', 'a.txt', [j('key=AKIA', 'IOSFODNN7EXAMPLE')], ['AKIA is a prefix']],
  ['github-token', 'a.txt', [j('ghp', '_', 'a1B2'.repeat(9))], ['ghp_short']],
  ['slack-token', 'a.txt', [j('xox', 'b-1234567890-abcdefghij')], ['xoxb']],
  ['google-api-key', 'a.txt', [j('AI', 'za', 'A'.repeat(35))], ['AIza']],
  ['llm-api-key', 'a.txt', [j('sk', '-ant-api03-', 'A1b2C3d4E5f6G7h8I9j0')], ['a disk-space-monitor', 'risk-free-assessment-tool']],
  ['jwt', 'a.txt', [j('eyJhbGciOiJIUzI1NiJ9', '.', 'eyJzdWIiOiIxMjM0NTY3ODkwIn0', '.', 'abcdefghijk1234567')], ['eyJ.short.x']],
  ['bearer-token', 'a.txt', [j('Authorization: Bearer ', 'abcdEFGH1234ijklMNOP5678qrst')], ['Bearer <token>', 'Bearer REDACTED-TOKEN-VALUE-1234']],
  [
    'session-cookie',
    'a.txt',
    [j('cf_clearance', '=', 'abcdefghijklmnopqrstuvwxyz0123456789'), j('_ga', '=', 'GA1.2.123456789.1234567890')],
    ['cf_clearance=REDACTED', 'the cf_clearance cookie', "const sessionid = request.cookies.get('sessionid') ?? '';"],
  ],
  [
    'email-address',
    'a.txt',
    [j('jane.doe', '@', 'corp-mail.io'), j('name', '@', 'gmail.com')],
    [
      j('you', '@', 'example.com'), j('noreply', '@', 'anthropic.com'), j('12345+user', '@', 'users.noreply.github.com'),
      j('git', '@', 'github.com'), j('logo', '@', '2x.png'), j('vite', '@', '5.0.0'),
      j('url(fonts/inter', '@', 'italic.woff2)'), j('a', '@', 'b'),
    ],
  ],
  [
    'conversation-url',
    'a.txt',
    [
      j('https://claude.ai/chat/', '11111111-2222-3333-4444-555555555555'),
      j('https://gemini.google.com/app/', 'abcdef0123456789'),
      j('https://chatgpt.com/c/', '68a1b2c3-d4e5-6789-abcd-ef0123456789'),
    ],
    ['https://claude.ai/chat/REDACTED-CONVERSATION-ID', 'https://chatgpt.com/', 'https://gemini.google.com/app/download', 'https://claude.ai/chat/history'],
  ],
  ['fixture-uuid', 'test/fixtures/x/y.html', [j('id="', '11111111-2222-3333-4444-555555555555', '"')], ['no uuid here']],
  ['fixture-uuid', 'docs/x.md', [], [j('11111111-2222-3333-4444-555555555555')]], // scoped to fixtures only
  [
    'account-id',
    'test/fixtures/x/y.html',
    [
      j('https://lh3.googleusercontent.com/a/', 'ACg8ocJ', 'a1B2c3D4e5F6g7'),
      j('https://www.gravatar.com/avatar/', '0123456789abcdef0123456789abcdef'),
      j('org', '-', 'A1b2C3d4E5f6G7h8I9j0K1l2'),
      j('acct', '_', '1AbCdEfGhIjKlMn'),
      j('/app/c', '_', 'abcdef0123456789'),
      j('https://files.oaiusercontent.com/file-x?', 'se=2026&sig=abcdef'),
    ],
    ['https://lh3.googleusercontent.com/', 'organization-settings', 'c_short', 'user-menu'],
  ],
  ['account-id', 'docs/x.md', [], [j('org', '-', 'A1b2C3d4E5f6G7h8I9j0K1l2')]], // scoped to fixtures only
  ['cloudflare-ray-id', 'test/fixtures/x/y.html', [j('Ray ID: <code>', '8f1a2b3c4d5e6f70', '</code>')], ['Ray ID:', 'Ray ID: <code>REDACTED</code>']],
  [
    'public-ip',
    'test/fixtures/x/y.html',
    [j('Your IP: 8.8.', '4.4'), j('addr 93.184.', '216.34'), j('Your IP is 8.8.', '4.4.'), j('<p>8.8.', '4.4</p>')],
    [
      '10.0.0.1', '192.168.1.5', '127.0.0.1', '172.20.0.9', '203.0.113.57', '198.51.100.7', '192.0.2.1', '0.0.0.0', '999.1.1.1',
      'version 1.2.3', '169.254.0.1', '100.64.0.1', '/lib/1.2.3.4/lib.min.js', 'node-20.11.1.0', 'v1.2.3.4', '1.2.3.4.5',
    ],
  ],
  ['us-ssn', 'a.txt', [j('123-45-', '6789')], ['2026-06-05', '000-12-3456', j('id 1234-', '123-45-6789-abcd')]],
  [
    'payment-card',
    'a.txt',
    [j('4111 1111 ', '1111 1111'), j('378282246310', '005')],
    ['1234 5678 9012 3456', '4111 1111 1111 1112', '9111 1111 1111 1110', j('id 11111111-2222-3333', '-4444-555555555555')],
  ],
  ['phone-number', 'a.txt', [j('(555) ', '867-5309'), j('415-', '867-5309')], ['2026-06-05T00:00:00', 'v10.200.3000', j('(212) ', '555-0123')]],
  [
    'secret-assignment',
    'a.txt',
    [j('api_key = "', 'Zq8Xv2Lm9Rt4Wb7Nc3Hd6Ks1', '"')],
    ['api_key = "your-api-key-here"', 'token = process.env.TOKEN', 'password: "aaaaaaaaaaaaaaaa"', 'secret = "${SECRET_FROM_VAULT}"'],
  ],
];

// The git-backed checks spawn ~20 git processes (seconds on Windows), so they run in CI, with
// --full, or when this very file is staged; otherwise the pre-commit hook stays fast.
function needsFullSelfTest(root, requested) {
  if (requested || process.env.CI) return true;
  try {
    return git(root, 'diff', '--cached', '--name-only', '--', 'scripts/scan-secrets.mjs').toString('utf8').trim() !== '';
  } catch {
    return false;
  }
}

function selfTest(full) {
  let failures = 0;
  const check = (ok, what) => {
    if (!ok) {
      failures++;
      console.error(`self-test FAIL  ${what}`);
    }
  };
  const flagged = (text, path, rule, rules = RULES) => scanText(text, path, rules).some((f) => f.rule === rule);

  // Every rule: positives fire, negatives stay quiet, and every rule has a test case.
  const seen = new Set();
  for (const [rule, path, positives, negatives] of CASES) {
    seen.add(rule);
    for (const sample of positives) check(flagged(sample, path, rule), `${rule}: should have flagged: ${sample.slice(0, 4)}…(${sample.length})`);
    for (const sample of negatives) check(!flagged(sample, path, rule), `${rule}: should NOT have flagged: ${sample}`);
  }
  for (const rule of RULES) check(seen.has(rule.id), `${rule.id}: rule has no test case`);

  // Owner terms come from the policy file, are case-insensitive and fixture-scoped.
  const deny = buildDenyRule(['Jane Roe', 'janeroe']);
  check(flagged('Signed in as JANE ROE', 'test/fixtures/a.html', 'owner-term', [deny]), 'owner-term: should flag a denied name in a fixture');
  check(flagged('user janeroe', 'test/fixtures/a.html', 'owner-term', [deny]), 'owner-term: should flag the second term');
  check(!flagged('Signed in as Jane Roe', 'docs/a.md', 'owner-term', [deny]), 'owner-term: must be fixture-scoped');
  check(!flagged('Roe v. Wade', 'test/fixtures/a.html', 'owner-term', [deny]), 'owner-term: must not flag other text');
  for (const inside of ['Mojane Roe', 'Sunjaneroe', 'destroyjaneroe']) check(!flagged(inside, 'test/fixtures/a.html', 'owner-term', [deny]), `owner-term: must not flag inside a longer word: ${inside}`);
  check(flagged('mailbox janeroesmith', 'test/fixtures/a.html', 'owner-term', [deny]), 'owner-term: a longer mailbox that starts with the term must still be flagged');
  check(buildDenyRule([]) === null, 'owner-term: no terms means no rule');

  // Encoded forms are decoded before scanning.
  const at = j('jane.doe', '@', 'corp-mail.io');
  for (const enc of [j('jane.doe', '&#64;', 'corp-mail.io'), j('jane.doe', '&#x40;', 'corp-mail.io'), j('jane.doe', '%40', 'corp-mail.io'), j('jane.doe', '&commat;', 'corp-mail.io'), j('jane.doe', '&amp;#64;', 'corp-mail.io')]) {
    check(flagged(enc, 'a.txt', 'email-address'), `decoding: should flag ${enc}`);
  }
  check(flagged(j('%2Fchat%2F', '11111111-2222-3333-4444-555555555555'), 'test/fixtures/a.html', 'fixture-uuid'), 'decoding: %2F-prefixed UUID should be flagged');
  check(flagged(j('https%3A%2F%2Fclaude.ai%2Fchat%2F', '11111111-2222-3333-4444-555555555555'), 'a.txt', 'conversation-url'), 'decoding: encoded conversation URL should be flagged');
  check(!flagged('100%25 sure, R&amp;D &lt;b&gt;', 'a.txt', 'email-address'), 'decoding: ordinary encoded text must stay quiet');
  check(scanText(at, 'a.txt').length === scanText(at, 'a.txt').filter((f, i, a) => a.findIndex((g) => g.text === f.text && g.rule === f.rule) === i).length, 'a finding must not be reported twice');

  // Files the scanner cannot read: a fixture becomes a finding, anything else is only counted.
  const url = j('https://claude.ai/chat/', 'abcdef01-2345-6789-abcd-ef0123456789');
  const utf16le = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(url, 'utf16le')]);
  const utf16be = Buffer.concat([Buffer.from([0xfe, 0xff]), Buffer.from(url, 'utf16le').swap16()]);
  const utf8bom = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(url)]);
  for (const [name, buf] of [['UTF-16LE', utf16le], ['UTF-16BE', utf16be], ['UTF-8 BOM', utf8bom]]) {
    check(scanBuffer(buf, 'docs/x.txt', RULES).findings.some((f) => f.rule === 'conversation-url'), `${name} file with a BOM must be decoded and scanned`);
  }
  const nul = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01]);
  check(scanBuffer(nul, 'test/fixtures/a/shot.png', RULES).findings.some((f) => f.rule === 'unscannable-fixture'), 'a binary fixture must be a finding');
  check(scanBuffer(nul, 'docs/shot.png', RULES).findings.length === 0 && scanBuffer(nul, 'docs/shot.png', RULES).skipped === 'binary', 'a binary non-fixture is skipped and counted, not a finding');
  check(scanBuffer(Buffer.from('a'.repeat(MAX_BYTES + 1)), 'test/fixtures/a/big.html', RULES).findings.some((f) => f.rule === 'unscannable-fixture'), 'an oversized fixture must be a finding');

  // Linear time: a line that is one long run must not hang the pre-commit hook.
  const started = Date.now();
  for (const line of ['a'.repeat(300_000), 'a@'.repeat(150_000), 'a.'.repeat(150_000), `${'a1-'.repeat(100_000)}@`, '%40'.repeat(100_000)]) scanText(line, 'test/fixtures/a.html');
  check(Date.now() - started < 5000, `scanning long single lines took ${Date.now() - started} ms (must stay linear)`);

  // Findings are printed to logs that may be public: never a fragment of PII or most of a secret.
  for (const rule of PII_RULES) check(!mask({ rule, text: 'SENSITIVE-TEXT-1234' }).includes('SENS'), `mask must not print a fragment of a ${rule} finding`);
  check(!mask({ rule: 'conversation-url', text: j('claude.ai/chat/', 'abcdef0123456789') }).includes('abcdef'), 'mask must hide a conversation id');
  check(!mask({ rule: 'llm-api-key', text: j('sk', '-ant-api03-', 'A1b2C3d4E5f6G7h8I9j0') }).includes('A1b2C3d4'), 'mask must not print most of a secret');

  // Policy: globs, scoping and refusing an entry that gives no reason.
  check(globToRegExp('a/**/b.txt').test('a/x/y/b.txt') && globToRegExp('a/**/b.txt').test('a/b.txt'), 'glob ** should cross folders, including none');
  check(!globToRegExp('a/*.txt').test('a/b/c.txt'), 'glob * must not cross a slash');
  check(globToRegExp('docs\\**').test('docs/x/y.md'), 'a backslash glob must be normalised');
  const email = { rule: 'email-address', path: 'docs/a/b.md', text: j('someone', '@', 'corp-mail.io') };
  const { allow } = parsePolicy({ allow: [{ rule: 'email-address', path: 'docs/**', contains: j('someone', '@'), reason: 'test' }] });
  check(isAllowed(allow, email), 'allowlist should cover a matching finding');
  check(!isAllowed(allow, { ...email, path: 'test/a.md' }), 'allowlist must not cover another path');
  check(!isAllowed(allow, { ...email, rule: 'jwt' }), 'allowlist must not cover another rule');
  check(!isAllowed(allow, { ...email, text: j('other', '@', 'corp-mail.io') }), 'allowlist must not cover other text');
  check(isAllowed(allow, { ...email, where: 'abc1234' }), 'a history finding (with a commit) must still be allowlistable by path');
  for (const bad of [{ rule: 'email-address', path: 'docs/**' }, { rule: 'email-address', path: 'docs/**', reason: '  ' }, { rule: 'nope', path: 'x', reason: 'r' }]) {
    let threw = false;
    try {
      parsePolicy({ allow: [bad] });
    } catch {
      threw = true;
    }
    check(threw, `allowlist must refuse ${JSON.stringify(bad)}`);
  }
  check(parsePolicy({ allow: [{ rule: 'unscannable-fixture', path: 'test/fixtures/**', reason: 'ok' }] }).allow.length === 1, 'an engine rule must be allowlistable');

  // Git-backed behaviour, in a throwaway repository.
  const dir = full ? mkdtempSync(join(tmpdir(), 'scan-secrets-')) : null;
  const run = (...args) => git(dir, '-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=', ...args);
  try {
    if (!full) throw new SkipGitChecks();
    run('init', '-q', '-b', 'main');
    mkdirSync(join(dir, 'test', 'fixtures'), { recursive: true });

    // A commit holds the index: staged secret + clean working copy must still be caught.
    const rel = 'test/fixtures/x.html';
    writeFileSync(join(dir, rel), j('<a href="', url, '">x</a>\n'));
    run('add', rel);
    writeFileSync(join(dir, rel), '<p>clean</p>\n');
    check(scanTree(dir).findings.some((f) => f.rule === 'conversation-url' && f.where === 'staged'), 'a staged secret hidden by a clean working copy must be caught');
    check(scanTree(dir, [rel]).findings.length === 0, 'explicit --files must scan only the working copy');
    let threw = false;
    try {
      scanTree(dir, ['nope.txt']);
    } catch {
      threw = true;
    }
    check(threw, '--files with a missing file must be an error, not "clean"');
    run('reset', '-q');

    // History: an added line beginning `++ `, a non-ASCII path and an evil merge must all be seen.
    const bad = j('<a href="', url, '">x</a>');
    writeFileSync(join(dir, 'a.txt'), 'first\n');
    run('add', 'a.txt');
    run('commit', '-q', '-m', 'base');
    run('checkout', '-q', '-b', 'side');
    writeFileSync(join(dir, 'b.txt'), 'side\n');
    run('add', 'b.txt');
    run('commit', '-q', '-m', 'side');
    run('checkout', '-q', 'main');
    writeFileSync(join(dir, 'a.txt'), `first\n++ not a header\n${bad}\n`);
    run('add', 'a.txt');
    run('commit', '-q', '-m', 'plus-plus line, then a secret');
    writeFileSync(join(dir, 'café notes.md'), `${bad}\n`);
    run('add', 'café notes.md');
    run('commit', '-q', '-m', 'non-ASCII path');
    run('merge', '--no-commit', '--no-ff', 'side');
    writeFileSync(join(dir, 'merged.txt'), `${j('reach me at ', 'jane.doe', '@', 'corp-mail.io')}\n`);
    run('add', 'merged.txt');
    run('commit', '-q', '-m', 'evil merge');
    const found = scanHistory(dir).findings;
    check(found.some((f) => f.rule === 'conversation-url' && f.path === 'a.txt'), 'history: a secret after a `++ ` line must be seen');
    check(found.some((f) => f.rule === 'conversation-url' && f.path === 'café notes.md'), 'history: a secret in a non-ASCII path must be seen');
    check(found.some((f) => f.rule === 'email-address' && f.path === 'merged.txt'), 'history: an evil-merge resolution must be seen');
  } catch (err) {
    if (!(err instanceof SkipGitChecks)) check(false, `git-backed checks could not run: ${err.message.split('\n')[0]}`);
  } finally {
    if (dir) rmSync(dir, { recursive: true, force: true });
  }

  const tier = full ? 'full, incl. git-backed checks' : 'fast; git-backed checks run in CI, with --full, or when this file is staged';
  console.log(failures ? `scan-secrets self-test: ${failures} failure(s)` : `scan-secrets self-test: ok (${RULES.length} rules; ${tier})`);
  return failures === 0;
}

class SkipGitChecks extends Error {}

// -------------------------------------------------------------------------- main
function main(argv) {
  const opt = { root: resolve(HERE, '..'), files: null, history: false, selfTest: false, full: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--self-test') opt.selfTest = true;
    else if (a === '--full') opt.full = true;
    else if (a === '--list-rules') {
      for (const r of [...RULES, { id: 'owner-term', why: 'a name from denyInFixtures appears inside a fixture' }]) console.log(`${r.id.padEnd(20)} ${r.why}`);
      for (const [id, why] of Object.entries(ENGINE_RULES)) console.log(`${id.padEnd(20)} ${why}`);
      return 0;
    }
    else if (a === '--history') opt.history = true;
    else if (a === '--root') opt.root = resolve(argv[++i] ?? '.');
    else if (a === '--files') {
      opt.files = argv.slice(i + 1);
      break;
    } else if (a === '--help' || a === '-h') {
      console.log('usage: node scripts/scan-secrets.mjs [--history] [--root DIR] [--files F...] | --self-test | --list-rules');
      return 0;
    } else {
      console.error(`unknown argument: ${a}`);
      return 2;
    }
  }

  if (opt.selfTest) return selfTest(needsFullSelfTest(opt.root, opt.full)) ? 0 : 1;

  const { allow, deny } = loadPolicy(opt.root);
  const rules = deny ? [...RULES, deny] : RULES;
  const { findings, scanned, skipped } = opt.history ? { ...scanHistory(opt.root, rules), skipped: null } : scanTree(opt.root, opt.files, rules);
  const live = findings.filter((f) => !isAllowed(allow, f));
  const what = opt.history ? 'commit(s)' : 'file(s)';
  const skips = skipped && (skipped.binary || skipped.oversize) ? `, skipped ${skipped.binary} binary + ${skipped.oversize} oversize` : '';
  if (live.length === 0) {
    console.log(`scan-secrets: clean (${scanned} ${what} scanned${skips}, ${findings.length - live.length} allowlisted)`);
    return 0;
  }
  console.error(`scan-secrets: ${live.length} finding(s) in ${scanned} ${what}${skips}:`);
  for (const f of live) {
    const place = `${f.where ? `${f.where}:` : ''}${f.path}:${f.line}:${f.col}`;
    console.error(`  ${place}  [${f.rule}]${f.decoded ? ' (after decoding)' : ''}  ${f.why}  -> ${mask(f)}`);
  }
  console.error('Fix the file (redact or use an obviously synthetic value), or add a justified entry to scripts/scan-secrets.allowlist.json.');
  return 1;
}

try {
  process.exitCode = main(process.argv.slice(2));
} catch (err) {
  console.error(`scan-secrets: ${err.message}`);
  process.exitCode = 2;
}
