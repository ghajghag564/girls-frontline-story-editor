import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {manifestName, root, snapshot} from './source-files.mjs';

const actual = snapshot();
const recorded = JSON.parse(fs.readFileSync(path.join(root, manifestName), 'utf8'));
assert.deepEqual(actual, recorded, '源码文件、大小、SHA-256 或版本与 source-manifest.json 不符');
console.log(`已核对 ${actual.files.length} 个文件的范围、大小与 SHA-256。`);
