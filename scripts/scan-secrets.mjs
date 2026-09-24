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
// real id, session cookies and tokens, e-mail addresses, and personal numbers, plus the
// usual credential shapes.
//
// Usage:
//   node scripts/scan-secrets.mjs                scan the working tree
//   node scripts/scan-secrets.mjs --history      scan every line ever added on any ref
//   node scripts/scan-secrets.mjs --self-test    prove every rule still fires and stays quiet
//   node scripts/scan-secrets.mjs --list-rules
//   node scripts/scan-secrets.mjs --root DIR     scan another checkout
//   node scripts/scan-secrets.mjs --files A B..  scan exactly these files
//
// A justified exception goes in scripts/scan-secrets.allowlist.json (rule + path +
// reason, optionally the matched text). Findings never print the full secret.
//
// This file must itself pass the scan, so the self-test samples below are assembled
// from pieces at run time and no credential-shaped literal appears in the source.
// =============================================================================

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const MAX_BYTES = 2 * 1024 * 1024;
const HERE = dirname(fileURLToPath(import.meta.url));

// Words that mean "this is not a real value".
const PLACEHOLDER =
  /(?:REDACTED|EXAMPLE|PLACEHOLDER|CHANGEME|CHANGE_ME|YOUR[_-]|<[^>]+>|\$\{|\{\{|x{4,}|\*{4,}|dummy|sample|fake)/i;

// File extensions that make `name@2x.png` look like an address.
const ASSET_TLD = /\.(?:png|jpe?g|gif|svg|webp|ico|css|m?js|ts|json|map|md|html?)$/i;

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

const mask = (s) => (s.length <= 8 ? '*'.repeat(s.length) : `${s.slice(0, 4)}…${s.slice(-2)} (${s.length} chars)`);

// Each rule: id, why, re (global), optional scope(path) and skip(match).
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
    re: /\bsk-(?:ant-|proj-|live-|test-)?[A-Za-z0-9_-]{20,}/g,
  },
  {
    id: 'jwt',
    why: 'JSON web token',
    re: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
  },
  {
    id: 'bearer-token',
    why: 'bearer credential',
    re: /\bBearer\s+([A-Za-z0-9._~+/-]{20,}=*)/g,
    skip: (m) => PLACEHOLDER.test(m[1]),
  },
  {
    id: 'session-cookie',
    why: 'session cookie / auth token value',
    re: /\b(?:cf_clearance|sessionKey|sessionid|__Secure-[A-Za-z0-9._-]*(?:session|token)[A-Za-z0-9._-]*|__Host-[A-Za-z0-9._-]+|SAPISID|APISID|HSID|SSID)\s*[=:]\s*["']?([A-Za-z0-9._%~+/-]{16,})/g,
    skip: (m) => PLACEHOLDER.test(m[1]),
  },
  {
    id: 'email-address',
    why: 'e-mail address',
    re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g,
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
    scope: (path) => path.startsWith('test/fixtures/'),
    re: /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,
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
  },
  {
    id: 'secret-assignment',
    why: 'high-entropy value assigned to a secret-like name',
    re: /\b(?:api[_-]?key|secret(?:[_-]?key)?|access[_-]?token|auth[_-]?token|token|password|passwd|client[_-]?secret|private[_-]?key)\b["']?\s*[:=]\s*["']([^"'\s]{12,})["']/gi,
    skip: (m) => PLACEHOLDER.test(m[1]) || shannon(m[1]) < 3.5,
  },
];

// ---------------------------------------------------------------- allowlist
function globToRegExp(glob) {
  const body = glob
    .split('**')
    .map((part) => part.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]'))
    .join('.*');
  return new RegExp(`^${body}$`);
}

function parseAllowlist(parsed) {
  const entries = Array.isArray(parsed?.allow) ? parsed.allow : [];
  const ids = new Set(RULES.map((r) => r.id));
  return entries.map((e, i) => {
    if (!ids.has(e.rule) || !e.path || !String(e.reason ?? '').trim()) {
      throw new Error(`scan-secrets.allowlist.json entry ${i}: needs a known "rule", a "path" and a non-empty "reason"`);
    }
    return { rule: e.rule, path: globToRegExp(e.path), contains: e.contains ?? null };
  });
}

function loadAllowlist(root) {
  const file = join(root, 'scripts', 'scan-secrets.allowlist.json');
  return existsSync(file) ? parseAllowlist(JSON.parse(readFileSync(file, 'utf8'))) : [];
}

const isAllowed = (allowlist, finding) =>
  allowlist.some(
    (a) => a.rule === finding.rule && a.path.test(finding.path) && (a.contains === null || finding.text.includes(a.contains)),
  );

// ------------------------------------------------------------------- scanning
function scanText(text, path) {
  const findings = [];
  const lines = text.split(/\r?\n/);
  for (const rule of RULES) {
    if (rule.scope && !rule.scope(path)) continue;
    for (let i = 0; i < lines.length; i++) {
      const re = new RegExp(rule.re.source, rule.re.flags);
      let m;
      while ((m = re.exec(lines[i])) !== null) {
        if (m[0] === '') re.lastIndex++;
        if (rule.skip && rule.skip(m)) continue;
        findings.push({ path, line: i + 1, col: m.index + 1, rule: rule.id, why: rule.why, text: m[0] });
      }
    }
  }
  return findings;
}

const git = (root, ...args) =>
  execFileSync('git', args, { cwd: root, maxBuffer: 512 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });

function scanTree(root, explicitFiles) {
  let files = explicitFiles;
  if (!files) {
    try {
      files = git(root, 'ls-files', '-z', '--cached', '--others', '--exclude-standard').toString('utf8').split('\0').filter(Boolean);
    } catch (err) {
      throw new Error(`cannot list files: ${root} is not a git checkout (${err.message.split('\n')[0]})`);
    }
  }
  const findings = [];
  let scanned = 0;
  for (const rel of new Set(files)) {
    const abs = resolve(root, rel);
    if (!existsSync(abs)) continue;
    const st = statSync(abs);
    if (!st.isFile() || st.size > MAX_BYTES) continue;
    const buf = readFileSync(abs);
    if (buf.subarray(0, 8192).includes(0)) continue; // binary
    scanned++;
    findings.push(...scanText(buf.toString('utf8'), rel.split('\\').join('/')));
  }

  // A commit holds the INDEX, not the working tree. A file staged with a secret and then
  // edited clean in the working tree passes the loop above yet would still be committed, so
  // scan the staged copy of every staged file too. Findings identical to one already found in
  // the working copy are not reported twice.
  if (!explicitFiles) {
    const seen = new Set(findings.map((f) => `${f.rule}|${f.path}|${f.line}|${f.col}|${f.text}`));
    const staged = git(root, 'diff', '--cached', '--name-only', '-z', '--diff-filter=ACMR').toString('utf8').split('\0').filter(Boolean);
    for (const rel of staged) {
      const blob = git(root, 'show', `:${rel}`);
      if (blob.length > MAX_BYTES || blob.subarray(0, 8192).includes(0)) continue;
      for (const f of scanText(blob.toString('utf8'), rel)) {
        if (!seen.has(`${f.rule}|${f.path}|${f.line}|${f.col}|${f.text}`)) findings.push({ ...f, where: 'staged' });
      }
    }
  }
  return { findings, scanned };
}

function scanHistory(root) {
  const log = git(root, 'log', '--all', '--no-color', '--no-ext-diff', '-p', '-U0', '--format=@@commit %h').toString('utf8');
  const findings = [];
  let commit = '';
  let path = '';
  let line = 0;
  let commits = 0;
  for (const raw of log.split('\n')) {
    if (raw.startsWith('@@commit ')) {
      commit = raw.slice(9).trim();
      commits++;
    } else if (raw.startsWith('+++ ')) {
      path = raw.startsWith('+++ b/') ? raw.slice(6) : '';
    } else if (raw.startsWith('@@ ')) {
      line = Number(/\+(\d+)/.exec(raw)?.[1] ?? 1);
    } else if (raw.startsWith('+') && path) {
      for (const f of scanText(raw.slice(1), path)) findings.push({ ...f, line, where: commit });
      line++;
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
  ['session-cookie', 'a.txt', [j('cf_clearance', '=', 'abcdefghijklmnopqrstuvwxyz0123456789')], ['cf_clearance=REDACTED', 'the cf_clearance cookie']],
  [
    'email-address',
    'a.txt',
    [j('jane.doe', '@', 'corp-mail.io'), j('name', '@', 'gmail.com')],
    [j('you', '@', 'example.com'), j('noreply', '@', 'anthropic.com'), j('12345+user', '@', 'users.noreply.github.com'), j('git', '@', 'github.com'), j('logo', '@', '2x.png'), j('vite', '@', '5.0.0')],
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
  ['us-ssn', 'a.txt', [j('123-45-', '6789')], ['2026-06-05', '000-12-3456', j('id 1234-', '123-45-6789-abcd')]],
  ['payment-card', 'a.txt', [j('4111 1111 ', '1111 1111'), j('378282246310', '005')], ['1234 5678 9012 3456', '4111 1111 1111 1112', '9111 1111 1111 1110', j('id 11111111-2222-3333', '-4444-555555555555')]],
  ['phone-number', 'a.txt', [j('(555) ', '867-5309'), j('415-', '867-5309')], ['2026-06-05T00:00:00', 'v10.200.3000']],
  [
    'secret-assignment',
    'a.txt',
    [j('api_key = "', 'Zq8Xv2Lm9Rt4Wb7Nc3Hd6Ks1', '"')],
    ['api_key = "your-api-key-here"', 'token = process.env.TOKEN', 'password: "aaaaaaaaaaaaaaaa"', 'secret = "${SECRET_FROM_VAULT}"'],
  ],
];

function selfTest() {
  let failures = 0;
  const seen = new Set();
  for (const [rule, path, positives, negatives] of CASES) {
    seen.add(rule);
    for (const sample of positives) {
      if (!scanText(sample, path).some((f) => f.rule === rule)) {
        failures++;
        console.error(`self-test FAIL  ${rule}: should have flagged: ${mask(sample)}`);
      }
    }
    for (const sample of negatives) {
      if (scanText(sample, path).some((f) => f.rule === rule)) {
        failures++;
        console.error(`self-test FAIL  ${rule}: should NOT have flagged: ${sample}`);
      }
    }
  }
  for (const rule of RULES) {
    if (!seen.has(rule.id)) {
      failures++;
      console.error(`self-test FAIL  ${rule.id}: rule has no test case`);
    }
  }
  const check = (ok, what) => {
    if (!ok) {
      failures++;
      console.error(`self-test FAIL  ${what}`);
    }
  };

  // Path globs: ** crosses folders, * does not.
  check(globToRegExp('a/**/b.txt').test('a/x/y/b.txt'), 'glob ** should cross folders');
  check(!globToRegExp('a/*.txt').test('a/b/c.txt'), 'glob * must not cross a slash');

  // Allowlist: must be scoped by rule, path and text, and must refuse an entry with no reason.
  const email = { rule: 'email-address', path: 'docs/a/b.md', text: j('someone', '@', 'corp-mail.io') };
  const allow = parseAllowlist({ allow: [{ rule: 'email-address', path: 'docs/**', contains: j('someone', '@'), reason: 'test' }] });
  check(isAllowed(allow, email), 'allowlist should cover a matching finding');
  check(!isAllowed(allow, { ...email, path: 'test/a.md' }), 'allowlist must not cover another path');
  check(!isAllowed(allow, { ...email, rule: 'jwt' }), 'allowlist must not cover another rule');
  check(!isAllowed(allow, { ...email, text: j('other', '@', 'corp-mail.io') }), 'allowlist must not cover other text');
  check(isAllowed(allow, { ...email, where: 'abc1234' }), 'a history finding (with a commit) must still be allowlistable by path');
  for (const bad of [{ rule: 'email-address', path: 'docs/**' }, { rule: 'email-address', path: 'docs/**', reason: '  ' }, { rule: 'nope', path: 'x', reason: 'r' }]) {
    let threw = false;
    try {
      parseAllowlist({ allow: [bad] });
    } catch {
      threw = true;
    }
    check(threw, `allowlist must refuse ${JSON.stringify(bad)}`);
  }

  // A commit holds the index: a file staged with a secret and then edited clean in the
  // working tree must still be caught.
  const dir = mkdtempSync(join(tmpdir(), 'scan-secrets-'));
  try {
    git(dir, 'init', '-q');
    mkdirSync(join(dir, 'test', 'fixtures'), { recursive: true });
    const rel = 'test/fixtures/x.html';
    writeFileSync(join(dir, rel), j('<a href="https://claude.ai/chat/', 'abcdef01-2345-6789-abcd-ef0123456789', '">x</a>\n'));
    git(dir, 'add', rel);
    writeFileSync(join(dir, rel), '<p>clean</p>\n');
    const { findings } = scanTree(dir);
    check(findings.some((f) => f.rule === 'conversation-url' && f.where === 'staged'), 'a staged secret hidden by a clean working copy must be caught');
    check(scanTree(dir, [rel]).findings.length === 0, 'explicit --files must scan only the working copy');
  } catch (err) {
    check(false, `staged-copy check could not run: ${err.message.split('\n')[0]}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  console.log(failures ? `scan-secrets self-test: ${failures} failure(s)` : `scan-secrets self-test: ok (${RULES.length} rules)`);
  return failures === 0;
}

// -------------------------------------------------------------------------- main
function main(argv) {
  const opt = { root: resolve(HERE, '..'), files: null, history: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--self-test') return selfTest() ? 0 : 1;
    if (a === '--list-rules') {
      for (const r of RULES) console.log(`${r.id.padEnd(20)} ${r.why}`);
      return 0;
    }
    if (a === '--history') opt.history = true;
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

  const allowlist = loadAllowlist(opt.root);
  const { findings, scanned } = opt.history ? scanHistory(opt.root) : scanTree(opt.root, opt.files);
  const live = findings.filter((f) => !isAllowed(allowlist, f));
  const what = opt.history ? 'commit(s)' : 'file(s)';
  if (live.length === 0) {
    console.log(`scan-secrets: clean (${scanned} ${what} scanned, ${findings.length - live.length} allowlisted)`);
    return 0;
  }
  console.error(`scan-secrets: ${live.length} finding(s) in ${scanned} ${what}:`);
  for (const f of live) {
    console.error(`  ${f.where ? `${f.where}:` : ''}${f.path}:${f.line}:${f.col}  [${f.rule}]  ${f.why}  -> ${mask(f.text)}`);
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
