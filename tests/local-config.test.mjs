import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {readLocalConfig,checkDependency} from '../src/server/local-config.mjs';

test('local config keeps project writes separate and detects changed dependencies', async t => {
  const temporaryRoot=await fs.realpath(os.tmpdir());
  const base=await fs.mkdtemp(path.join(temporaryRoot,'gfse-config-test-'));
  t.after(async()=>{
    const target=await fs.realpath(base);
    assert.equal(target,base);
    assert.equal(path.dirname(target),temporaryRoot);
    await fs.rm(target,{recursive:true});
  });
  await fs.mkdir(path.join(base,'materials'));
  await fs.writeFile(path.join(base,'library.dll'),'Test identity only');
  await fs.writeFile(path.join(base,'ffmpeg.exe'),'Test identity only');
  await fs.writeFile(path.join(base,'media-foundation.exe'),'Test helper identity only');
  const configFile=path.join(base,'local.json');
  const values={materialsDirectory:'./materials',workspaceDirectory:'./work',
    purismCore:'./library.dll',ffmpeg:'./ffmpeg.exe'};
  await fs.writeFile(configFile,JSON.stringify(values));
  const source=path.join(base,'source');
  const config=await readLocalConfig(configFile,source);
  assert.equal(config.workspaceDirectory,path.join(base,'work'));
  assert.equal(await checkDependency(config.ffmpeg),config.ffmpeg.filename);
  assert.equal(config.mediaFoundation,null);
  const {ffmpeg,...minimal}=values;
  await fs.writeFile(configFile,JSON.stringify({...minimal,mediaFoundation:'./media-foundation.exe'}));
  const withWindows=await readLocalConfig(configFile,source);
  assert.equal(withWindows.ffmpeg,null);
  assert.equal(await checkDependency(withWindows.mediaFoundation),withWindows.mediaFoundation.filename);
  await fs.writeFile(path.join(base,'media-foundation.exe'),'Modified helper identity');
  await assert.rejects(()=>checkDependency(withWindows.mediaFoundation),/已更改/);
  await fs.writeFile(configFile,JSON.stringify(minimal));
  const editingOnly=await readLocalConfig(configFile,source);
  assert.equal(editingOnly.ffmpeg,null);
  assert.equal(editingOnly.mediaFoundation,null);
  await fs.writeFile(config.ffmpeg.filename,'different');
  await assert.rejects(()=>checkDependency(config.ffmpeg),/已更改/);
  await fs.writeFile(configFile,JSON.stringify({...values,workspaceDirectory:'./materials/data'}));
  await assert.rejects(()=>readLocalConfig(configFile,source),/必须与源码目录和素材目录分开/);
});
