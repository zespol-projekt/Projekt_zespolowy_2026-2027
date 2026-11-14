import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';

const here = path.dirname(fileURLToPath(import.meta.url));
const defaultRoot = path.resolve(here, '../..');
function git(root, args, input) {
  const result = spawnSync('git', args, { cwd: root, input, maxBuffer: 128 * 1024 * 1024 });
  if (result.status !== 0) throw new Error('Cannot read Git publication snapshot.');
  return result.stdout;
}
export function isSensitivePath(file) {
  const parts = file.replaceAll('\\', '/').split('/');
  const name = parts.at(-1);
  if (/^\.env/i.test(name) && !/^\.env(?:\.[a-z0-9_-]+)?\.(?:example|template)$/i.test(name)) return true;
  return parts.some(p => ['.audit-local', '.ssh', '.aws', 'node_modules', '.expo', 'test-results', 'playwright-report'].includes(p))
    || /\.(?:pem|key|p8|p12|pfx|jks|keystore|mobileprovision)$/i.test(name)
    || /^(?:\.pypirc|google-services\.json|GoogleService-Info\.plist|service-account.*\.json|.*firebase-adminsdk.*\.json)$/i.test(name)
    || /(?:^|\/)supabase\/\.(?:temp|branches)(?:\/|$)/.test(file.replaceAll('\\', '/'));
}
export function knownCredentialMatches(bytes, values) {
  return values.some(value => value.length >= 8 && bytes.includes(Buffer.from(value)));
}
export function publicationFiles(root, staged = false) {
  if (!staged) {
    const names = [...new Set(git(root, ['ls-files', '-z', '--cached', '--others', '--exclude-standard']).toString('utf8').split('\0').filter(Boolean))];
    return names.flatMap(file => {
      const source = path.resolve(root, file);
      if (!source.startsWith(root + path.sep)) throw new Error('Publication path outside repository.');
      if (!fs.existsSync(source)) return [];
      const stat = fs.lstatSync(source);
      if (stat.isSymbolicLink()) return [{ path: file, bytes: Buffer.from(fs.readlinkSync(source)) }];
      if (!stat.isFile()) throw new Error('Nested repository/submodule requires a separate audit.');
      return [{ path: file, bytes: fs.readFileSync(source) }];
    });
  }
  const entries = git(root, ['ls-files', '--stage', '-z']).toString('utf8').split('\0').filter(Boolean).map(line => {
    const tab = line.indexOf('\t');
    const [mode, oid, stage] = line.slice(0, tab).split(' ');
    if (stage !== '0' || mode === '160000') throw new Error('Resolve conflicts/audit submodules before publication.');
    return { path: line.slice(tab + 1), oid };
  });
  if (!entries.length) throw new Error('Nothing in Git index to scan.');
  const blobs = git(root, ['cat-file', '--batch'], entries.map(e => e.oid + '\n').join(''));
  let offset = 0;
  return entries.map(entry => {
    const end = blobs.indexOf(10, offset);
    const [oid, type, sizeText] = blobs.subarray(offset, end).toString('ascii').split(' ');
    const size = Number(sizeText);
    if (end < 0 || oid !== entry.oid || type !== 'blob' || !Number.isSafeInteger(size)) throw new Error('Invalid Git object response.');
    offset = end + 1;
    const bytes = blobs.subarray(offset, offset + size); offset += size + 1;
    return { path: entry.path, bytes };
  });
}
function localCredentials(root) {
  const values = [];
  for (const file of ['.env.local', 'smart_cart/.env.local']) {
    const source = path.join(root, file); if (!fs.existsSync(source)) continue;
    for (const [key, value] of Object.entries(parseEnv(fs.readFileSync(source, 'utf8'))))
      if (/KEY|TOKEN|PASSWORD|SECRET/.test(key)) values.push(value);
  }
  return values;
}
export function scannerBinary(root = defaultRoot) {
  const local = path.join(root, '.audit-local/tools', process.platform === 'win32' ? 'gitleaks.exe' : 'gitleaks');
  return process.env.GITLEAKS_BIN || (fs.existsSync(local) ? local : 'gitleaks');
}
export function checkSecrets({ root = defaultRoot, staged = false, history = false } = {}) {
  root = fs.realpathSync(root);
  const binary = scannerBinary(root);
  if (spawnSync(binary, ['version'], { encoding: 'utf8' }).status !== 0) throw new Error('Install Gitleaks 8.30.1+ or set GITLEAKS_BIN. Scan has NOT passed.');
  const files = history ? [] : publicationFiles(root, staged);
  const credentials = localCredentials(root);
  const violations = files.flatMap(file => isSensitivePath(file.path) ? [{ path: file.path, rule: 'sensitive-path' }]
    : knownCredentialMatches(file.bytes, credentials) ? [{ path: file.path, rule: 'local-credential-copy' }] : []);
  if (violations.length) return { ok: false, mode: staged ? 'index' : 'working-tree', files: files.length, findings: violations };
  const privateRoot = path.join(root, '.audit-local');
  fs.mkdirSync(privateRoot, { recursive: true });
  if (fs.realpathSync(privateRoot) !== privateRoot) throw new Error('Audit directory must not be a symlink.');
  const temporary = fs.mkdtempSync(path.join(privateRoot, 'scan-'));
  const target = path.join(temporary, 'tree');
  const report = path.join(temporary, 'redacted-report.json');
  try {
    fs.mkdirSync(target);
    for (const file of files) {
      const destination = path.resolve(target, file.path);
      if (!destination.startsWith(target + path.sep)) throw new Error('Export outside audit tree.');
      fs.mkdirSync(path.dirname(destination), { recursive: true }); fs.writeFileSync(destination, file.bytes);
    }
    const args = history ? ['git', root, '--log-opts=--all --no-textconv --no-ext-diff'] : ['dir', target];
    args.push('--config', path.join(root, '.gitleaks.toml'), '--redact=100', '--no-banner', '--no-color', '--report-format', 'json', '--report-path', report);
    const scan = spawnSync(binary, args, { cwd: root, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
    if (![0, 1].includes(scan.status) || /\bERR\b/.test(scan.stderr ?? '')) throw new Error('Gitleaks did not finish a complete scan.');
    const rows = fs.existsSync(report) ? JSON.parse(fs.readFileSync(report, 'utf8')) : [];
    const findings = rows.map(row => ({ path: history ? row.File : path.relative(target, path.resolve(root, row.File)).replaceAll('\\', '/'),
      line: row.StartLine, rule: row.RuleID, ...(history ? { commit: row.Commit.slice(0, 12) } : {}) }));
    return { ok: scan.status === 0 && findings.length === 0, mode: history ? 'all-local-history' : staged ? 'index' : 'working-tree', files: files.length, findings };
  } finally {
    const resolved = fs.realpathSync(temporary);
    if (resolved !== temporary || !resolved.startsWith(privateRoot + path.sep + 'scan-')) throw new Error('Unsafe audit cleanup target.');
    fs.rmSync(resolved, { recursive: true, force: true });
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const allowed = new Set(['--staged', '--history']);
    if (process.argv.slice(2).some(arg => !allowed.has(arg))) throw new Error('Usage: check-secrets.mjs [--staged | --history]');
    if (process.argv.includes('--staged') && process.argv.includes('--history')) throw new Error('Choose one scan mode.');
    const result = checkSecrets({ staged: process.argv.includes('--staged'), history: process.argv.includes('--history') });
    console.log(JSON.stringify(result, null, 2)); process.exitCode = result.ok ? 0 : 1;
  } catch (error) { console.error(error.message); process.exitCode = 2; }
}
