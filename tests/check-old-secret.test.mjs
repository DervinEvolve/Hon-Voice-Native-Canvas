import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const script = fileURLToPath(new URL('../scripts/check-old-secret.sh', import.meta.url));

test('the old-secret check reports where a value is without printing it', t => {
  const dir = mkdtempSync(join(tmpdir(), 'hon-old-secret-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', ['-c', 'user.name=fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', ...args], { cwd: dir });
  git('init', '-q');
  writeFileSync(join(dir, 'old.env'), 'KEY=fixture-history-only-value\n');
  git('add', 'old.env'); git('commit', '-qm', 'add');
  git('rm', '-q', 'old.env'); git('commit', '-qm', 'remove');
  writeFileSync(join(dir, 'notes.txt'), 'fixture-working-tree-value\n');
  const run = input => spawnSync('bash', [script], { cwd: dir, input, encoding: 'utf8' });

  let result = run('fixture-history-only-value\n');
  assert.equal(result.status, 1);
  assert.match(result.stdout, /^found in commit [0-9a-f]{40}$/m);
  assert.equal(result.stdout.includes('fixture-history-only-value'), false);

  result = run('fixture-working-tree-value');
  assert.equal(result.status, 1);
  assert.equal(result.stdout.trim(), 'found in notes.txt');

  result = run('fixture-absent-value\n');
  assert.equal(result.status, 0);
  assert.equal(result.stdout.trim(), 'not found');
  assert.equal(result.stderr.includes('fixture-absent-value'), false);

  assert.equal(run('short\n').status, 2);
});
