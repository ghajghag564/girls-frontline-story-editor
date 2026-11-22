import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';

export const root = fileURLToPath(new URL('../', import.meta.url));
export const manifestName = 'source-manifest.json';

const rootFiles = new Set([
  '.gitattributes', '.gitignore', 'ASSET_RIGHTS.md', 'AUTHORS', 'LICENSE.md',
  'LICENSE_SCOPE.md', 'NOTICE', 'README.md', 'README.en.md', 'THIRD_PARTY_NOTICES.md',
  'package.json', 'package-lock.json', 'local-config.example.json', manifestName,
]);
const directories = new Set([
  'src', 'src/core', 'src/server', 'src/web', 'branding', 'tests', 'scripts',
  'docs', 'docs/images', '.github', '.github/workflows', 'third-party', 'third-party/purism-core',
]);
const allowedPaths = [
  /^src\/(?:core|server|web)\/[\w-]+\.mjs$/,
  /^src\/web\/(?:index\.html|style\.css)$/,
  /^tests\/[\w-]+\.test\.mjs$/,
  /^scripts\/(?:check|build-manifest|verify-manifest|source-files|index-materials)\.mjs$/,
  /^docs\/[\w-]+\.md$/,
  /^docs\/images\/editor\.png$/,
  /^branding\/author\.json$/,
  /^\.github\/workflows\/checks\.yml$/,
  /^third-party\/purism-core\/(?:LICENSE|single-key-compat\.patch)$/,
];

export function sourceFiles() {
  const files = [];
  function walk(relativeDirectory) {
    for (const entry of fs.readdirSync(path.join(root, relativeDirectory), {withFileTypes: true})) {
      const relative = path.posix.join(relativeDirectory, entry.name);
      if (relative === '.git' || (relative === 'node_modules' && entry.isDirectory())) continue;
      if (entry.isDirectory() && directories.has(relative)) {
        walk(relative);
        continue;
      }
      if (!entry.isFile() || !(rootFiles.has(relative) || allowedPaths.some(pattern => pattern.test(relative)))) {
        throw new Error('文件超出本次源码发布范围：' + relative);
      }
      if (relative !== manifestName) files.push(relative);
    }
  }
  walk('');
  return files.sort();
}

export function snapshot() {
  const files = sourceFiles().map(relative => {
    const bytes = fs.readFileSync(path.join(root, relative));
    return {path: relative, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex')};
  });
  const {version} = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  return {formatVersion: 1, version, completeApplicationSource: true, files};
}
