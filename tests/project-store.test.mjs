import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {ProjectStore} from '../src/server/project-store.mjs';
import {SafeDirectory} from '../src/server/safe-files.mjs';
import {validateExport,compileProject} from '../src/core/timeline.mjs';
import {validateProject,missingResources} from '../src/core/project.mjs';
const base=fileURLToPath(new URL('../.source-checks/store-tests/',import.meta.url));
const fixture=()=>({formatVersion:1,title:'离线工程',catalogVersion:'test',scenes:[{id:'scene',title:'场景一',entries:[{id:'line',kind:'narration',text:'暂存之后仍可继续。',hold:1}]}]});
test('save, reopen, recovery and optimistic concurrency preserve user edits',async()=>{
 const store=new ProjectStore(path.join(base,randomUUID()));await store.initialize();
 const created=await store.create(fixture());assert.equal(created.revision,1);
 assert.equal((await store.list())[0].id,created.id);
 const changed=fixture();changed.title='恢复中的作品';
 await store.save(created.id,changed,{recovery:true,expectedRevision:1});
 assert.equal((await store.open(created.id)).project.title,'离线工程');
 assert.equal((await store.open(created.id,{recovery:true})).project.title,'恢复中的作品');
 assert.equal((await store.recovery(created.id)).project.title,'恢复中的作品');
 await store.save(created.id,changed,{expectedRevision:1});
 await assert.rejects(store.save(created.id,fixture(),{expectedRevision:1}),e=>e.code==='CONFLICT');
 assert.equal((await store.open(created.id)).revision,2);
 assert.equal(await store.recovery(created.id),null);
});
test('serialized competing saves accept one expected revision',async()=>{
 const store=new ProjectStore(path.join(base,randomUUID()));await store.initialize();const item=await store.create(fixture());
 const results=await Promise.allSettled([store.save(item.id,fixture(),{expectedRevision:1}),store.save(item.id,fixture(),{expectedRevision:1})]);
 assert.equal(results.filter(x=>x.status==='fulfilled').length,1);
});

test('deletion requires confirmation for the current recovery draft and preserves other projects', async () => {
  const store = new ProjectStore(path.join(base, randomUUID()));
  await store.initialize();
  const selected = await store.create(fixture());
  const other = await store.create(fixture());
  const draft = {...fixture(), title: '尚未保存的草稿'};
  await store.save(selected.id, draft, {recovery: true, expectedRevision: selected.revision});

  await assert.rejects(
    store.delete(selected.id, {expectedRevision: selected.revision, expectedRecovery: null}),
    error => error.code === 'CONFLICT',
  );
  const record = (await store.list()).find(item => item.id === selected.id);
  await store.delete(selected.id, {expectedRevision: record.revision, expectedRecovery: record.recoveryToken});
  await assert.rejects(store.open(selected.id), {code: 'ENOENT'});
  await assert.rejects(store.open(selected.id, {recovery: true}), {code: 'ENOENT'});
  assert.equal((await store.open(other.id)).project.title, other.project.title);
});
test('rejects traversal, Windows streams and reserved devices',async()=>{
 const safe=new SafeDirectory(path.join(base,randomUUID()));await safe.initialize();
 for(const value of ['../escape','x/../../escape','C:/outside-workspace/file','x:y','CON','nested/NUL.txt','folder\\file','x.','x/'])await assert.rejects(safe.resolve(value));
});
test('rejects junctions and hardlinks without changing their targets',async()=>{
 const root=path.join(base,randomUUID());const safe=new SafeDirectory(root);await safe.initialize();
 const outside=path.join(base,randomUUID());await fs.mkdir(outside,{recursive:true});const original=path.join(outside,'original.txt');await fs.writeFile(original,'unchanged');
 await fs.link(original,path.join(root,'linked.txt'));
 await assert.rejects(safe.atomicWrite('linked.txt','overwrite'));
 await fs.symlink(outside,path.join(root,'junction'),'junction');
 await assert.rejects(safe.atomicWrite('junction/original.txt','overwrite'));
 assert.equal(await fs.readFile(original,'utf8'),'unchanged');
});
test('invalid project cannot overwrite a saved project',async()=>{
 const store=new ProjectStore(path.join(base,randomUUID()));await store.initialize();const item=await store.create(fixture());const bad=fixture();bad.scenes[0].entries[0].stage={background:'../../outside'};
 await assert.rejects(store.save(item.id,bad));assert.equal((await store.open(item.id)).revision,1);
});
test('missing assets are reported without substituting another asset',()=>{
 const p=fixture();p.scenes[0].entries[0].stage={background:'missing',actors:[{instanceId:'one',assetId:'absent'}]};
 const checked=validateProject(p);assert.equal(missingResources(checked,{backgrounds:[],characters:[],music:[]}).length,2);assert.equal(checked.scenes[0].entries[0].stage.background,'missing');
});

test('shortening a story preserves its saved export range while export rejects the stale range',async()=>{
 const p=fixture();p.exportSettings={ratio:'16:9',resolution:1080,fps:30,bitrateMbps:16,codec:'h264',start:10,end:20};
 const store=new ProjectStore(path.join(base,randomUUID()));await store.initialize();const saved=await store.create(p);
 assert.deepEqual((await store.open(saved.id)).project.exportSettings,p.exportSettings);
 assert.throws(()=>validateExport(p.exportSettings,compileProject(p).duration),/区间/);
 assert.throws(()=>validateProject({...p,exportSettings:{...p.exportSettings,start:NaN}}));
 assert.throws(()=>validateProject({...p,exportSettings:{...p.exportSettings,codec:'unsupported'}}));
});
