import { readFile, writeFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
// CLI 3.1.53 advertises a loopback URL but omits the host in listen().
// Keep this narrow compatibility patch until upgrading to a verified release.
const directory = resolve(import.meta.dirname, '../node_modules/@wp-playground/cli');
const pkg = JSON.parse(await readFile(resolve(directory, 'package.json')));
if (pkg.version !== '3.1.53') throw new Error('Re-evaluate the loopback patch when upgrading Playground CLI.');
let count = 0;
for (const name of await readdir(directory)) {
  if (!name.startsWith('run-cli-') || !name.endsWith('.js')) continue;
  const file = resolve(directory, name); const source = await readFile(file, 'utf8');
  const before = 't.listen(e.port, () => {';
  const after = 't.listen(e.port, "127.0.0.1", () => {';
  if (source.includes(after)) { count++; continue; }
  if (source.split(before).length !== 2) throw new Error('Playground listener changed; inspect before patching.');
  await writeFile(file, source.replace(before, after)); count++;
}
if (count !== 1) throw new Error('Could not verify the Playground loopback listener.');
