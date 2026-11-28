import fs from 'node:fs/promises';
import {SafeDirectory} from '../src/server/safe-files.mjs';
import {normalizeCatalog} from '../src/server/catalog.mjs';
import {fileDigest} from '../src/server/file-hash.mjs';
import {localFonts} from '../src/server/local-fonts.mjs';

const [directory] = process.argv.slice(2);
if (!directory) throw new Error('用法  node scripts/index-materials.mjs <本地素材根目录>');
const files = new SafeDirectory(directory);
const catalogFile = 'assets/catalog.json';
const catalog = normalizeCatalog(JSON.parse((await files.read(catalogFile)).toString('utf8').replace(/^\uFEFF/, '')));
const references = new Map([[catalogFile, undefined]]);

function add(relative, extension, expected) {
  if (typeof relative !== 'string' || !relative.toLowerCase().endsWith(extension)) {
    throw new Error('素材文件后缀必须为 ' + extension + '  ' + relative);
  }
  const location = 'assets/' + relative;
  const previous = references.get(location);
  if (previous && expected && previous !== expected) throw new Error('素材目录的哈希冲突 ' + relative);
  references.set(location, expected ?? previous);
}

for (const item of catalog.backgrounds) {
  add(item.path,'.png',item.sha256);
  if (item.thumbnail) add(item.thumbnail,'.png');
}
for (const item of catalog.music) add(item.path,'.flac',item.sha256);
for (const item of catalog.characters) {
  add(item.modelPath,'.moc3',item.sha256);
  if (item.thumbnail) add(item.thumbnail,'.png');
  for (const texture of item.textures) add(texture.path,'.png',texture.sha256);
}
for (const {file,format} of localFonts) {
  const relative='fonts/'+file;
  try { await fs.stat(await files.resolve('assets/'+relative)); }
  catch (error) { if (error.code==='ENOENT') continue; throw error; }
  add(relative,format==='woff2'?'.woff2':'.ttf');
}
if (references.size > 20000) throw new Error('素材校验清单最多容纳 20000 个文件');

const index = [];
for (const relative of [...references.keys()].sort()) {
  const filename = await files.resolve(relative);
  const stat = await fs.stat(filename);
  if (!stat.isFile() || stat.size < 1 || stat.size > 64 * 1024 * 1024) {
    throw new Error('素材类型或大小无效 ' + relative);
  }
  const sha256 = await fileDigest(filename);
  const after = await fs.stat(await files.resolve(relative));
  if (after.size !== stat.size || after.mtimeMs !== stat.mtimeMs) throw new Error('素材在校验期间发生变化 ' + relative);
  const expected = references.get(relative);
  if (expected && sha256 !== expected) throw new Error('素材与目录中的哈希不一致 ' + relative);
  index.push({path:relative,bytes:stat.size,sha256});
}
await files.atomicWrite('assets/asset-hashes.json',JSON.stringify({format:'gf2-asset-hashes-v1',files:index},null,2)+'\n');
console.log('已核对并索引 ' + index.length + ' 个本地文件。');
