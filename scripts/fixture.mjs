import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { zipWpContent } from '@wp-playground/blueprints';
import { PNG } from 'pngjs';
import { startRuntime, php } from './lib/runtime.mjs';
import { root, saveJson } from './lib/config.mjs';
import { importSnapshot } from './snapshot-import.mjs';

export const fixtureConfig = { productionUrl: 'https://fixture.example', spacefastSpace: 'fixture', additionalRoutes: [], wordpressVersion: '6.8.3', phpVersion: '8.3' };
export async function fixture(destination = resolve(root, '.cache/fixture')) {
  await mkdir(destination, { recursive: true });
  const r = await startRuntime({ ...fixtureConfig, fixtureSourceUrl: 'https://playground.wordpress.net/scope:fixture/' });
  const archive = resolve(destination, 'export.zip');
  try {
    const pic = new PNG({ width: 1200, height: 600 });
    for (let y = 0; y < pic.height; y++) for (let x = 0; x < pic.width; x++) {
      const i = (y * pic.width + x) * 4;
      pic.data[i] = 25 + Math.floor(x / 12); pic.data[i + 1] = 100 + Math.floor(y / 6); pic.data[i + 2] = 130; pic.data[i + 3] = 255;
    }
    await r.playground.writeFile('/tmp/fixture.png', PNG.sync.write(pic));
    const result = await r.playground.run({ code: await readFile(resolve(root, 'test/fixture.php'), 'utf8') });
    if (result.exitCode) throw new Error(result.errors || result.text);
    await writeFile(archive, await zipWpContent(r.playground));
  } finally { await r[Symbol.asyncDispose](); }
  await importSnapshot(archive, fixtureConfig, resolve(destination, 'snapshots'));
  await saveJson(resolve(destination, 'site.config.json'), fixtureConfig);
  console.log(`Fixture: ${destination}`);
  return destination;
}
if (process.argv[1] === import.meta.filename) {
  try { await fixture(); } catch (error) { console.error(error.stack); process.exitCode = 1; }
}
