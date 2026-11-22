import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {SafeDirectory} from '../src/server/safe-files.mjs';
import {exportSpacePlan,checkExportSpace,pcmPath} from '../src/server/export-space.mjs';
const options={start:100,end:101,estimatedBytes:2000000};
const track=(id,samples)=>({id,samples,sha256:'a'.repeat(64)});
const voice=(assetId,start=0,stopAt=null)=>({assetId,start,stopAt,fadeOut:1});
test('one-second export reserves full uncached hour of music once, plus mix and video, while excluding unrelated tracks',async()=>{
 const files=new SafeDirectory(fileURLToPath(new URL('../.source-checks/space-tests/'+randomUUID(),import.meta.url)));await files.initialize();
 const music=[track('long',48000*3600),track('ready',10),track('later',48000*600)];await files.atomicWrite(pcmPath(music[1]),Buffer.alloc(80));
 const compiled={voices:[voice('long'),voice('long',50),voice('ready'),voice('later',102)]};
 const plan=await exportSpacePlan(files,compiled,options,{music});assert.equal(plan.sourceCacheBytes,48000*3600*8);assert.equal(plan.mixedAudioBytes,48000*8);
 assert.equal(plan.requiredBytes,plan.sourceCacheBytes+plan.mixedAudioBytes+plan.videoBytes+plan.reserveBytes);
 // The old check accepted this capacity, despite an uncached hour-long source.
 const free=plan.videoBytes+plan.mixedAudioBytes+plan.reserveBytes;
 await assert.rejects(()=>checkExportSpace(files,plan,{statfs:async()=>({bavail:free,bsize:1})}),e=>e.code==='ENOSPC'&&e.message.includes('新建音乐缓存'));
 assert.equal((await checkExportSpace(files,plan,{statfs:async()=>({bavail:plan.requiredBytes,bsize:1})})).availableBytes,plan.requiredBytes);
 await files.atomicWrite(pcmPath(music[1]),Buffer.alloc(8));const invalid=await exportSpacePlan(files,compiled,options,{music});assert.equal(invalid.sourceCacheBytes,plan.sourceCacheBytes+80);
});
test('silent exports do not reserve audio, and inaccessible disk information never silently passes',async()=>{
 const files=new SafeDirectory(fileURLToPath(new URL('../.source-checks/space-tests/'+randomUUID(),import.meta.url)));await files.initialize();
 const plan=await exportSpacePlan(files,{voices:[]},options,{music:[]});assert.equal(plan.sourceCacheBytes,0);assert.equal(plan.mixedAudioBytes,0);
 await assert.rejects(()=>checkExportSpace(files,plan,{statfs:async()=>{throw new Error('unavailable')}}),/无法检查/);
 await assert.rejects(()=>checkExportSpace(files,plan,{statfs:async()=>({bavail:NaN,bsize:4096})}),/有效的磁盘剩余空间/);
});
