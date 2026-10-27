// GET-only live verification of a published static release against its manifest.
// Reads the private access file in code only; never logs token/browserUrl.
import fs from 'node:fs';
import crypto from 'node:crypto';
const [manifestPath, outPath] = process.argv.slice(2);
const acc = JSON.parse(fs.readFileSync('/tmp/last-line-live-access.json', 'utf8'));
const m = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const base = acc.url.endsWith('/') ? acc.url : acc.url + '/';
const redact = s => String(s).split(acc.token).join('[REDACTED]').split(acc.browserUrl).join('[REDACTED-URL]').split(base).join('<internal-base>/');
const results = [];
let expired = false;
for (const f of m.files) {
  const r = {path: f.path, expectedBytes: f.bytes, expectedSha256: f.sha256};
  try {
    const res = await fetch(new URL(f.path, base), {headers: {Authorization: `Bearer ${acc.token}`}, redirect: 'manual'});
    r.status = res.status; r.contentType = res.headers.get('content-type');
    if (res.status === 401 || res.status === 403) expired = true;
    const buf = Buffer.from(await res.arrayBuffer());
    r.bytes = buf.length; r.sha256 = crypto.createHash('sha256').update(buf).digest('hex');
    r.ok = res.status === 200 && r.bytes === f.bytes && r.sha256 === f.sha256;
  } catch (e) { r.ok = false; r.error = redact(e.message); }
  results.push(r);
}
// Root entry (directory index) check
let root = {};
try { const res = await fetch(base, {headers: {Authorization: `Bearer ${acc.token}`}, redirect: 'manual'}); const b = Buffer.from(await res.arrayBuffer()); root = {status: res.status, bytes: b.length, sha256: crypto.createHash('sha256').update(b).digest('hex')}; } catch (e) { root = {error: redact(e.message)}; }
const pass = results.filter(r => r.ok).length;
const out = {checkedAt: new Date().toISOString(), method: 'GET with Authorization header (value redacted)', base: '<internal artifact base, redacted>', fileCount: results.length, passed: pass, failed: results.length - pass, totalBytes: results.reduce((a, r) => a + (r.bytes || 0), 0), expectedTotalBytes: m.totalBytes, authRejected: expired, rootIndex: root, files: results};
fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
console.log(JSON.stringify({fileCount: out.fileCount, passed: pass, failed: out.failed, totalBytes: out.totalBytes, expected: m.totalBytes, authRejected: expired, root, failures: results.filter(r => !r.ok).map(r => ({p: r.path, s: r.status, b: r.bytes, e: r.error}))}));
