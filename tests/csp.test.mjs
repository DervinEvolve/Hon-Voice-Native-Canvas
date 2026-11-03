import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';
import { buildCsp, SCRIPT_HOSTS, SECURITY_HEADERS } from '../csp.config.js';

const root = new URL('..', import.meta.url);
const read = path => readFileSync(new URL(path, root), 'utf8');
const directive = (policy, name) => policy.split(';').map(s => s.trim().split(/\s+/)).find(([n]) => n === name)?.slice(1) || [];
const covered = url => SCRIPT_HOSTS.some(host => {
  if (host.endsWith('/')) return url.startsWith(host);
  if (host.includes('*.')) return new URL(url).hostname.endsWith(host.split('*')[1]);
  return new URL(url).origin === host;
});

test('the page policy names its script hosts and blocks plugins and base changes', () => {
  for (const dev of [false, true]) {
    const policy = buildCsp({ dev });
    const scripts = directive(policy, 'script-src');
    assert.ok(scripts.length > 0);
    assert.ok(!scripts.includes('https:'), 'script-src must not allow every https host');
    assert.ok(!scripts.includes('*'));
    assert.deepEqual(directive(policy, 'object-src'), ["'none'"]);
    assert.deepEqual(directive(policy, 'base-uri'), ["'self'"]);
    assert.equal(directive(policy, 'connect-src').some(s => s.startsWith('ws://')), dev);
  }
  const narrowed = buildCsp({ connectSrc: 'https://media.example https://cdn.example' });
  assert.ok(!directive(narrowed, 'connect-src').includes('https:'));
  assert.ok(directive(narrowed, 'connect-src').includes('https://media.example'));
});

test('index.html loads only pinned external scripts with integrity hashes', () => {
  const html = read('index.html');
  assert.ok(html.includes('content="%HON_CSP%"'));
  const scripts = [...html.matchAll(/<script\b[^>]*\bsrc="(https:[^"]+)"[^>]*>/g)];
  assert.ok(scripts.length > 0);
  for (const [tag, src] of scripts) {
    assert.match(src, /@\d+\.\d+\.\d+\//, `${src} must name an exact version`);
    assert.match(tag, /integrity="sha384-[A-Za-z0-9+/]{64}"/, `${src} needs an integrity hash`);
    assert.match(tag, /crossorigin="anonymous"/);
    assert.ok(covered(src), `${src} is not in SCRIPT_HOSTS`);
  }
});

test('unpkg scripts used by the app are pinned and allowed by the policy', () => {
  const found = execFileSync('git', ['grep', '-ohE', "https://unpkg\\.com/[^'\"` )]+", '--', 'src', 'index.html'], { cwd: root, encoding: 'utf8' })
    .split('\n').filter(Boolean);
  assert.ok(found.length > 0);
  for (const url of found) {
    assert.match(url, /@\d+\.\d+\.\d+\//, url);
    assert.ok(covered(url), `${url} is not in SCRIPT_HOSTS`);
  }
});

test('deployed responses carry the same security headers as the local servers', () => {
  const vercel = JSON.parse(read('vercel.json'));
  const all = vercel.headers?.find(rule => rule.source === '/(.*)')?.headers || [];
  const actual = Object.fromEntries(all.map(h => [h.key, h.value]));
  assert.deepEqual(actual, SECURITY_HEADERS);
  assert.match(SECURITY_HEADERS['Content-Security-Policy'], /frame-ancestors 'none'/);
});
