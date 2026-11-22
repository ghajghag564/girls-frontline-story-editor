import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {root, sourceFiles} from './source-files.mjs';

function run(args, cwd) {
  const result = spawnSync(process.execPath, args, {cwd, stdio: 'inherit'});
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error('检查失败：node ' + args.join(' '));
}

const files = sourceFiles();
const tests = files.filter(file => file.startsWith('tests/') && file.endsWith('.test.mjs'));
if (!tests.length) throw new Error('缺少独立测试文件');
if (!process.argv.includes('--tests-only')) {
  const modules = files.filter(file => file.endsWith('.mjs'));
  for (const file of modules) run(['--check', file], root);
  console.log(`已检查 ${modules.length} 个 JavaScript 模块的语法。`);
}

// Tests exercise file writes, hard links and junctions in an isolated copy per run.
const temporaryRoot = fs.realpathSync.native(os.tmpdir());
const fixture = fs.mkdtempSync(path.join(temporaryRoot, 'gfse-source-tests-'));
try {
  for (const name of ['src', 'tests']) {
    fs.cpSync(path.join(root, name), path.join(fixture, name), {recursive: true});
  }
  run(['--test', ...tests], fixture);
} finally {
  if (fs.realpathSync.native(fixture) !== fixture || path.dirname(fixture) !== temporaryRoot) {
    throw new Error('测试临时目录已变更：' + fixture);
  }
  fs.rmSync(fixture, {recursive: true, maxRetries: 3});
}
