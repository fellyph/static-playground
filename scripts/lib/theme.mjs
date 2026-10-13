import { readFile, readdir } from 'node:fs/promises';
import { resolve, relative, posix, basename } from 'node:path';
import { root, sha256 } from './config.mjs';
import { php } from './runtime.mjs';

export const themeSource = resolve(root, 'themes/southbound');

export async function readTheme(source = themeSource) {
  const files = [];
  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const file = resolve(directory, entry.name);
      if (entry.isDirectory()) await walk(file);
      else if (entry.isFile()) files.push({ path: relative(source, file).split('\\').join('/'), contents: new Uint8Array(await readFile(file)) });
      else throw new Error(`Theme source must contain only regular files: ${file}`);
    }
  }
  await walk(source);
  files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  for (const required of ['style.css', 'theme.json', 'templates/index.html']) {
    if (!files.some(file => file.path === required)) throw new Error(`Theme source is missing ${required}.`);
  }
  return { files, sha256: sha256(JSON.stringify(files.map(file => [file.path, sha256(file.contents)]))) };
}

// Only the disposable runtime is replaced; the checkpoint and local source stay intact.
export async function applyTheme(runtime, source = themeSource, slug = basename(source)) {
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(slug)) throw new Error('Theme slug must contain only lowercase letters, numbers, hyphens, and underscores.');
  const theme = await readTheme(source);
  const destination = '/wordpress/wp-content/themes/' + slug;
  // Remove deleted files too, so stale templates cannot survive from the checkpoint.
  if (await runtime.playground.isDir(destination)) await runtime.playground.rmdir(destination, { recursive: true });
  for (const file of theme.files) {
    const target = posix.join(destination, file.path);
    await runtime.playground.mkdir(posix.dirname(target));
    await runtime.playground.writeFile(target, file.contents);
  }
  await php(runtime, `
    wp_clean_themes_cache();
    $theme = wp_get_theme('${slug}');
    if ($theme->errors()) throw new Exception($theme->errors()->get_error_message());
    if (get_stylesheet() !== '${slug}') switch_theme('${slug}');
  `);
  return { slug, sha256: theme.sha256 };
}
