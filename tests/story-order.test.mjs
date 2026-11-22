import test from 'node:test';
import assert from 'node:assert/strict';
import {moveScene,moveLine,duplicateScene} from '../src/core/story-order.mjs';
const fixture=()=>({scenes:[{id:'a',title:'场景甲',entries:[{id:'1',text:'一',music:{op:'play',assetId:'bgm'}},{id:'2',text:'二',music:{op:'inherit'}}]},{id:'b',title:'场景乙',entries:[{id:'3',text:'三'}]},{id:'c',title:'空场景',entries:[]}]});
const ids=p=>p.scenes.map(s=>s.entries.map(l=>l.id));
test('lines move before, after, to scene end, and into empty scenes without rewriting content',()=>{
 const p=fixture(),original=structuredClone(p.scenes.flatMap(s=>s.entries));
 assert.equal(moveLine(p,'1','a','2',true),true);assert.deepEqual(ids(p),[['2','1'],['3'],[]]);
 assert.equal(moveLine(p,'3','c'),true);assert.deepEqual(ids(p),[['2','1'],[],['3']]);
 assert.equal(moveLine(p,'1','b'),true);assert.deepEqual(ids(p),[['2'],['1'],['3']]);
 assert.equal(moveLine(p,'3','a','2'),true);assert.deepEqual(ids(p),[['3','2'],['1'],[]]);
 for(const entry of original)assert.deepEqual(p.scenes.flatMap(s=>s.entries).find(l=>l.id===entry.id),entry);
});
test('scene moves and invalid or redundant drops do not lose entries',()=>{
 const p=fixture();assert.equal(moveScene(p,'a','c',true),true);assert.deepEqual(p.scenes.map(s=>s.id),['b','c','a']);
 assert.equal(moveScene(p,'a','b'),true);assert.deepEqual(p.scenes.map(s=>s.id),['a','b','c']);const before=structuredClone(p);
 for(const args of [['1','a','1'],['1','a','2'],['2','a'],['missing','a'],['1','missing'],['1','b','missing']])assert.equal(moveLine(p,...args),false);
 assert.equal(moveScene(p,'a','a'),false);assert.equal(moveScene(p,'a','b'),false);assert.equal(moveScene(p,'missing','b'),false);assert.deepEqual(p,before);
});
test('scene duplication creates independent content and new scene/line IDs',()=>{
 const p=fixture();let id=0;const copy=duplicateScene(p,'a',()=> 'new-'+(++id));assert.equal(copy.id,'new-1');assert.deepEqual(copy.entries.map(l=>l.id),['new-2','new-3']);assert.equal(p.scenes[1],copy);
 copy.entries[0].music.assetId='changed';assert.equal(p.scenes[0].entries[0].music.assetId,'bgm');assert.equal(duplicateScene(p,'absent',()=>{throw new Error('must not allocate')}),null);
});
