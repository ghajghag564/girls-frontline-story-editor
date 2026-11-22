import test from 'node:test';
import assert from 'node:assert/strict';
import {compileProject} from '../src/core/timeline.mjs';
import {mixBlock,mixRange} from '../src/core/audio-mixer.mjs';
const assets={a:{sampleRate:48000,channels:2,samples:8,loop:{start:2,end:6}}};
const read=async(id,start,count)=>Float32Array.from({length:count*2},(_,i)=>(start+Math.floor(i/2))/10);
const project=()=>compileProject({formatVersion:1,scenes:[{id:'s',entries:[{id:'a',kind:'pause',text:'',transition:0,hold:1,music:{op:'play',assetId:'a',volume:1,fadeIn:0,loop:true}}]}]});
test('mixes loop intro and exact loop endpoints',async()=>{
 const data=await mixBlock(project(),assets,0,10,read);
 assert.deepEqual([...data.filter((_,i)=>i%2===0)].map(x=>Math.round(x*10)),[0,1,2,3,4,5,2,3,4,5]);
});
test('range mix exactly matches continuous mix with fade and arbitrary block boundaries',async()=>{
 const compiled=project();compiled.voices[0].fadeIn=.001;compiled.voices[0].stopAt=.0015;compiled.voices[0].stopGain=1;compiled.voices[0].fadeOut=.001;
 const full=await mixBlock(compiled,assets,0,160,read);
 const parts=[];
 for await(const block of mixRange(compiled,assets,37/48000,137/48000,read,{blockFrames:13}))parts.push(...block);
 assert.equal(parts.length,200);
 for(let i=0;i<parts.length;i++)assert.ok(Math.abs(parts[i]-full[74+i])<1e-6);
});
test('nonlooping source becomes silent at the end',async()=>{
 const compiled=project();compiled.voices[0].loop=false;
 const data=await mixBlock(compiled,assets,6/48000,5,read);
 assert.deepEqual([...data.filter((_,i)=>i%2===0)].map(x=>Math.round(x*10)),[6,7,0,0,0]);
});
test('rejects wrong sample rate and truncated reader result',async()=>{
 await assert.rejects(mixBlock(project(),{a:{...assets.a,sampleRate:44100}},0,5,read));
 await assert.rejects(mixBlock(project(),assets,0,5,async()=>new Float32Array(1)));
});
test('range cancellation is observed between bounded chunks',async()=>{
 const abort=new AbortController();let count=0;
 await assert.rejects(async()=>{for await(const block of mixRange(project(),assets,0,.01,read,{blockFrames:10,signal:abort.signal})){count++;abort.abort();}});
 assert.equal(count,1);
});
