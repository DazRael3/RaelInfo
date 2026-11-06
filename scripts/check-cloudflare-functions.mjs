import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await walk(path));
    else if (entry.isFile() && path.endsWith('.js')) files.push(path);
  }
  return files;
}

const targets = [...await walk('functions'), ...await walk('functions-shared')];
if (!targets.length) throw new Error('No Cloudflare function source files found.');
for (const file of targets) {
  const result = spawnSync(process.execPath, ['--check', file], { stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status || 1);
}
console.log(`Syntax check passed for ${targets.length} Cloudflare function/helper files.`);
