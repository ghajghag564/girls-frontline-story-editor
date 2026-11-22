import test from 'node:test';
import assert from 'node:assert/strict';
import {addLinearLayer,compositeLinearOverlay} from '../src/core/linear-overlay.mjs';
import {StoryInterfaceRenderer} from '../src/core/story-interface.mjs';
test('half white over black is mixed in linear light and keeps opaque scene alpha',()=>{
 const overlay=addLinearLayer(new Float32Array(4),new Uint8ClampedArray([255,255,255,128]));
 const pixel=compositeLinearOverlay(new Uint8ClampedArray([0,0,0,255]),overlay);
 assert.deepEqual([...pixel],[188,188,188,255]);
});
test('transparent and opaque UI retain exact scene or source values',()=>{
 const overlay=new Float32Array(8);addLinearLayer(overlay,new Uint8ClampedArray([255,255,255,0,13,29,26,255]));
 const pixel=compositeLinearOverlay(new Uint8ClampedArray([17,93,241,255,100,200,70,255]),overlay);
 assert.deepEqual([...pixel],[17,93,241,255,13,29,26,255]);
});
test('narration draws a caption and accent without loading any artwork',()=>{
 const calls=[],ctx={save:()=>calls.push('save'),restore:()=>calls.push('restore'),fillRect:(...args)=>calls.push(args)};
 new StoryInterfaceRenderer().narration(ctx,20,30,400,60);
 assert.deepEqual(calls,['save',[20,30,400,60],[20,30,4,60],'restore']);
});
