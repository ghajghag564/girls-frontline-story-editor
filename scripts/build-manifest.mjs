import fs from 'node:fs';
import path from 'node:path';
import {manifestName, root, snapshot} from './source-files.mjs';

const manifest = snapshot();
fs.writeFileSync(path.join(root, manifestName), JSON.stringify(manifest, null, 2) + '\n');
console.log(`已为 ${manifest.files.length} 个文件记录 SHA-256。`);
