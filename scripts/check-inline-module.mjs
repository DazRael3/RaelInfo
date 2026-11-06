import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const htmlPath = new URL('../public/index.html', import.meta.url);
const html = fs.readFileSync(htmlPath, 'utf8');
const match = html.match(/<script type="module">([\s\S]*?)<\/script>/i);
if (!match) {
  console.error('Could not find the inline module script in public/index.html');
  process.exit(1);
}
const tempPath = path.join(os.tmpdir(), `raelinfo-inline-${process.pid}.mjs`);
try {
  fs.writeFileSync(tempPath, match[1]);
  const result = spawnSync(process.execPath, ['--check', tempPath], { stdio: 'inherit' });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} finally {
  try { fs.unlinkSync(tempPath); } catch {}
}
