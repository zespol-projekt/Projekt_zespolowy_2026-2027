import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { isSensitivePath, knownCredentialMatches, publicationFiles, scannerBinary } from '../scripts/check-secrets.mjs';

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
function scratch(t) {
  const base = fs.realpathSync(os.tmpdir());
  const directory = fs.mkdtempSync(path.join(base, 'smartcart-secret-test-'));
  t.after(() => {
    const resolved = fs.realpathSync(directory);
    assert.equal(resolved, directory);
    assert.ok(resolved.startsWith(base + path.sep + 'smartcart-secret-test-'));
    fs.rmSync(resolved, { recursive: true, force: true });
  });
  return directory;
}
function git(root, ...args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, 'Fixture Git operation failed');
}
test('publication blocks local credentials and generated artifacts, but allows templates and SQL schema', () => {
  for (const file of ['.env', '.env.production', 'smart_cart/.env.local', 'account.pem', 'service-account-prod.json', 'smart_cart/supabase/.temp/pooler-url', '.audit-local/report.json']) assert.equal(isSensitivePath(file), true, file);
  for (const file of ['smart_cart/.env.example', '.env.test.template', 'smart_cart/supabase-schema.sql', 'zadania/Kowal.md']) assert.equal(isSensitivePath(file), false, file);
});
test('publication detects a copied local credential without returning its value', () => {
  const value = randomBytes(30).toString('hex');
  assert.equal(knownCredentialMatches(Buffer.from('prefix:' + value), [value]), true);
  assert.equal(knownCredentialMatches(Buffer.from('different bytes'), [value]), false);
});
test('index scan reads staged bytes and excludes untracked and ignored files', t => {
  const root = scratch(t); git(root, 'init', '--quiet');
  fs.writeFileSync(path.join(root, '.gitignore'), '.env*\n!.env.example\n');
  fs.writeFileSync(path.join(root, 'published.txt'), 'staged bytes');
  git(root, 'add', '.gitignore', 'published.txt');
  fs.writeFileSync(path.join(root, 'published.txt'), 'unstaged bytes');
  fs.writeFileSync(path.join(root, 'new.txt'), 'untracked');
  fs.writeFileSync(path.join(root, '.env.local'), 'LOCAL_ONLY=yes');
  const staged = publicationFiles(root, true);
  assert.equal(staged.find(f => f.path === 'published.txt').bytes.toString(), 'staged bytes');
  assert.equal(staged.some(f => f.path === 'new.txt' || f.path === '.env.local'), false);
  const working = publicationFiles(root, false);
  assert.equal(working.find(f => f.path === 'published.txt').bytes.toString(), 'unstaged bytes');
  assert.equal(working.some(f => f.path === 'new.txt'), true);
  assert.equal(working.some(f => f.path === '.env.local'), false);
});
const binary = scannerBinary(repository);
const available = spawnSync(binary, ['version'], { encoding: 'utf8' }).status === 0;
test('Gitleaks rejects a generated Supabase-shaped value and accepts only the exact fake fixture', { skip: !available }, t => {
  const root = scratch(t);
  const file = path.join(root, 'example.txt');
  const report = path.join(root, 'report.json');
  const args = ['dir', file, '--config', path.join(repository, '.gitleaks.toml'), '--redact=100', '--no-banner', '--report-format', 'json', '--report-path', report];
  fs.writeFileSync(file, ['sb', 'publishable', randomBytes(30).toString('base64url')].join('_'));
  assert.equal(spawnSync(binary, args, { encoding: 'utf8' }).status, 1);
  assert.ok(JSON.parse(fs.readFileSync(report, 'utf8')).some(r => r.RuleID === 'smartcart-supabase-key'));
  fs.writeFileSync(file, 'sb_publishable_browser_test_only');
  assert.equal(spawnSync(binary, args, { encoding: 'utf8' }).status, 0);
});
