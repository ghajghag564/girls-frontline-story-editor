import test from 'node:test';
import assert from 'node:assert/strict';
import {ProjectSaveQueue} from '../src/core/project-save-queue.mjs';
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
test('a delayed save keeps its snapshot and identity after a different project is activated',async()=>{
 const gate=deferred(),calls=[];
 const queue=new ProjectSaveQueue(async(route,args)=>{calls.push({route,...args});if(calls.length===1)await gate.promise;return {revision:(args.body.expectedRevision??0)+1,id:'created',project:args.body.project??args.body};});
 queue.activate('first',3);const project={title:'before'};const pending=queue.save(project,{manual:true});project.title='after';
 await Promise.resolve();queue.activate('second',8);const next=queue.save({title:'second'},{manual:true});gate.resolve();
 const first=await pending,last=await next;assert.equal(first.current,false);assert.equal(last.current,true);assert.equal(calls[0].body.project.title,'before');
 assert.equal(calls[0].route,'/projects/first');assert.equal(calls[1].route,'/projects/second');assert.equal(calls[1].body.expectedRevision,8);assert.equal(queue.session.revision,9);
});
test('overlapping initial saves create once and use the returned revision for later snapshots',async()=>{
 const gate=deferred(),calls=[];const queue=new ProjectSaveQueue(async(route,args)=>{calls.push({route,...args});if(calls.length===1){await gate.promise;return {id:'new-id',revision:1};}return {revision:2};});
 const first=queue.save({title:'first'},{manual:true}),next=queue.save({title:'new edit'},{manual:true});gate.resolve();await Promise.all([first,next]);
 assert.deepEqual(calls.map(c=>c.method),['POST','PUT']);assert.equal(calls[1].route,'/projects/new-id');assert.equal(calls[1].body.expectedRevision,1);assert.equal(calls[1].body.project.title,'new edit');
});
test('a failed request preserves revision and permits an explicit retry',async()=>{
 let attempt=0;const queue=new ProjectSaveQueue(async()=>{if(++attempt===1)throw new Error('disk');return {revision:5};});queue.activate('existing',4);
 await assert.rejects(queue.save({title:'keep'},{manual:true}),/disk/);assert.equal(queue.session.revision,4);await queue.save({title:'keep'},{manual:true});assert.equal(queue.session.revision,5);
});
