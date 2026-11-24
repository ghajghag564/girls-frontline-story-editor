import fs from 'node:fs/promises';
import path from 'node:path';
import {SafeDirectory} from './safe-files.mjs';
import {fileDigest} from './file-hash.mjs';

const pathKey = value => process.platform === 'win32' ? value.toLowerCase() : value;
const contains = (parent, child) => {
  const relative = path.relative(pathKey(parent), pathKey(child));
  return relative === '' || (relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative));
};

async function regularFile(filename, label) {
  const files = new SafeDirectory(path.dirname(filename));
  await files.checkAncestors(filename);
  const stat = await fs.stat(filename);
  if (!stat.isFile() || stat.nlink !== 1) throw new Error(label + '必须是本地普通文件');
  return stat;
}

async function dependency(filename, label, extension) {
  if (path.extname(filename).toLowerCase() !== extension) throw new Error(label + '路径格式无效');
  await regularFile(filename, label);
  return {filename, label, sha256: await fileDigest(filename)};
}

export async function checkDependency(dependency) {
  await regularFile(dependency.filename, dependency.label);
  if (await fileDigest(dependency.filename) !== dependency.sha256) {
    throw new Error(dependency.label + '自启动后已更改，请检查依赖并重新启动');
  }
  return dependency.filename;
}

export async function readLocalConfig(filename, sourceRoot) {
  const file = path.resolve(filename);
  const stat = await regularFile(file, '本地配置');
  if (stat.size > 64 * 1024) throw new Error('本地配置超过 64 KiB');
  const settings = JSON.parse(await fs.readFile(file, 'utf8'));
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) throw new Error('本地配置格式无效');
  const configPath = (key) => {
    if (typeof settings[key] !== 'string' || !settings[key].trim()) throw new Error('缺少本地配置项 ' + key);
    return path.resolve(path.dirname(file), settings[key]);
  };
  const materialsDirectory = configPath('materialsDirectory');
  const workspaceDirectory = configPath('workspaceDirectory');
  // The editor writes only to the workspace. Protect the source and supplied materials.
  for (const protectedDirectory of [sourceRoot, materialsDirectory]) {
    if (contains(protectedDirectory, workspaceDirectory) || contains(workspaceDirectory, protectedDirectory)) {
      throw new Error('workspaceDirectory 必须与源码目录和素材目录分开');
    }
  }
  const materialFiles = new SafeDirectory(materialsDirectory);
  const workspaceFiles = new SafeDirectory(workspaceDirectory);
  await materialFiles.checkAncestors(materialsDirectory);
  if (!(await fs.stat(materialsDirectory)).isDirectory()) throw new Error('materialsDirectory 必须是目录');
  await workspaceFiles.checkAncestors(workspaceDirectory);
  const optionalEncoder = (key, label) => settings[key] === undefined
    ? null
    : dependency(configPath(key), label, '.exe');
  const [purism, mediaFoundation, ffmpeg] = await Promise.all([
    dependency(configPath('purismCore'), 'Purism Core', '.dll'),
    optionalEncoder('mediaFoundation', 'Windows 导出调用程序'),
    optionalEncoder('ffmpeg', 'FFmpeg'),
  ]);
  const example = settings.exampleProject === undefined ? null : configPath('exampleProject');
  if (example) await regularFile(example, '本地示例工程');
  return {sourceRoot, materialsDirectory, workspaceDirectory, purism, mediaFoundation, ffmpeg, example};
}
