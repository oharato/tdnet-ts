// Only browser-safe search modules. No DB, parser, acquisition or model dependency.
import { mkdir, copyFile } from 'node:fs/promises';
await mkdir('web/search', { recursive: true });
for (const name of ['search-browser', 'search-query', 'search-date', 'search-normalize']) {
    await copyFile(`dist/${name}.js`, `web/search/${name}.js`);
}
