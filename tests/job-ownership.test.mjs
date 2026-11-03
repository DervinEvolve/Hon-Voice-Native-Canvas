import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { jobTokenIssuer, readJobToken, ownedProviderId, JobOwnershipError } from '../api/_lib/job-ownership.js';
import { checkedModelName } from '../api/_lib/model-names.js';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const withSecret = value => { delete process.env.HON_JOB_ID_SECRET; process.env.HON_OAUTH_STATE_SECRET = value; };

test('a job token reads back only for the user who started the job', () => {
  withSecret('fixture-only-' + 'x'.repeat(40));
  const providerId = '0b7f6c1e-1d2a-4c55-9a51-3f3f0c9d1a22';
  const token = jobTokenIssuer('user-a', 'veo31')(providerId);
  assert.equal(readJobToken('user-a', 'veo31', token), providerId);
  assert.equal(readJobToken('user-a', 'kling/video', token), null, 'a token from one route family does not open another');
  assert.equal(readJobToken('user-b', 'veo31', token), null);
  assert.equal(readJobToken('user-a', 'veo31', providerId), null, 'a bare provider ID is not accepted');
  assert.equal(readJobToken('user-a', 'veo31', token.slice(0, -1) + (token.endsWith('A') ? 'B' : 'A')), null);
  assert.equal(readJobToken('user-a', 'veo31', `../other.${token.split('.')[1]}`), null);
  process.env.HON_JOB_ID_SECRET = 'another-fixture-' + 'y'.repeat(40);
  assert.equal(readJobToken('user-a', 'veo31', token), null, 'rotating the secret invalidates old tokens');
});

test('job tokens fail closed without a signing secret or a safe provider ID', () => {
  withSecret('short');
  assert.throws(() => jobTokenIssuer('user-a', 'veo31'), error => error instanceof JobOwnershipError && error.status === 503);
  withSecret('fixture-only-' + 'x'.repeat(40));
  assert.throws(() => jobTokenIssuer('', 'veo31')('id'), JobOwnershipError);
  assert.throws(() => jobTokenIssuer('user-a', 'Bad Family'), error => error.status === 500);
  assert.throws(() => ownedProviderId('user-a', 'veo31', 'missing'), error => error.status === 404);
  assert.throws(() => jobTokenIssuer('user-a', 'veo31')('a/b?c'), error => error.status === 502);
});

test('Veo 3.1 routes hand out owner tokens and check them before any provider lookup', () => {
  for (const route of ['text-to-video', 'image-to-video', 'reference-to-video', 'first-last-frame']) {
    const source = read(`api/veo31/${route}.js`);
    assert.match(source, /request_id: issueJobToken\(/, route);
    assert.ok(source.indexOf('jobTokenIssuer(') < source.indexOf('fal.'), `${route} must check signing before the provider call`);
  }
  const status = read('api/veo31/status.js');
  const check = status.indexOf('readJobToken(');
  assert.ok(check > 0);
  assert.ok(check < status.indexOf('fal.queue.status'));
  assert.ok(check < status.indexOf('queue.fal.run'));
});

test('game edit model names must belong to the chosen provider family', () => {
  assert.equal(checkedModelName('gemini', undefined, 'gemini-3-pro-preview'), 'gemini-3-pro-preview');
  assert.equal(checkedModelName('gemini', 'gemini-2.5-flash', 'x'), 'gemini-2.5-flash');
  assert.equal(checkedModelName('claude', 'claude-opus-4-5-20251101', 'x'), 'claude-opus-4-5-20251101');
  for (const bad of ['../../v1/files', 'gemini-3:generateContent?key=x', 'claude-opus', 'gemini-x/y', 7]) {
    assert.equal(checkedModelName(bad === 'claude-opus' ? 'gemini' : 'gemini', bad, 'x'), null, String(bad));
  }
  for (const file of ['api/game/edit.js', 'api/game/edit-stream.js']) {
    const source = read(file);
    assert.doesNotMatch(source, /\?key=\$\{geminiKey\}/, `${file} must not put the key in the URL`);
    assert.match(source, /'x-goog-api-key': geminiKey/);
  }
});
