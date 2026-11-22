import test from 'node:test';
import assert from 'node:assert/strict';
import {StageRenderer,wrapText} from '../src/core/stage.mjs';
import {compileProject} from '../src/core/timeline.mjs';
// Track the context transform at the world and text boundaries, including errors.
function recordingCanvas(){
 let matrix=[1,0,0,1,0,0],stack=[];const worlds=[];
 const ctx={resetTransform(){matrix=[1,0,0,1,0,0]},save(){stack.push([...matrix])},restore(){matrix=stack.pop()},
 scale(x,y){matrix[0]*=x;matrix[1]*=x;matrix[2]*=y;matrix[3]*=y},translate(x,y){matrix[4]+=matrix[0]*x+matrix[2]*y;matrix[5]+=matrix[1]*x+matrix[3]*y},
 fillRect(){},drawImage(){worlds.push([...matrix])},get matrix(){return [...matrix]},get depth(){return stack.length}};
 return {canvas:{width:2560,height:1440,getContext(){return ctx}},ctx,worlds};
}
const story=(actors=[])=>compileProject({formatVersion:1,scenes:[{id:'scene',entries:[{id:'line',kind:'dialogue',text:'测试',transition:0,hold:2,stage:{background:'room',actors},effects:{shake:{amount:.025,duration:2}}}]}]});
test('camera transforms background and actors together, while text stays in output coordinates',async()=>{
 const {canvas,ctx,worlds}=recordingCanvas();let actorMatrix,textMatrix;
 const renderer=new StageRenderer(canvas,{imageLoader:async()=>({width:1280,height:720}),actorRenderer:async c=>{actorMatrix=c.matrix}});
 renderer.drawText=c=>{textMatrix=c.matrix};
 await renderer.render(story([{instanceId:'a',assetId:'model'}]),.5);
 assert.deepEqual(actorMatrix,worlds.at(-1));assert.notDeepEqual(actorMatrix,[2,0,0,2,0,0]);
 assert.deepEqual(textMatrix,[2,0,0,2,0,0]);assert.equal(ctx.depth,0);
 await renderer.render(story(),2);assert.deepEqual(worlds.at(-1),[2,0,0,2,0,0]);
});
test('a character render error restores the camera context before another frame',async()=>{
 const {canvas,ctx,worlds}=recordingCanvas();const renderer=new StageRenderer(canvas,{imageLoader:async()=>({width:1280,height:720}),actorRenderer:async()=>{throw new Error('model unavailable')}});
 renderer.drawText=()=>{};
 await assert.rejects(renderer.render(story([{instanceId:'a',assetId:'model'}]),.5),/model unavailable/);assert.equal(ctx.depth,0);
 await renderer.render(story(),2);assert.deepEqual(worlds.at(-1),[2,0,0,2,0,0]);assert.equal(ctx.depth,0);
});

test('Chinese wrapping keeps closing punctuation with its text and opening brackets with the following text',()=>{
 const context={measureText:()=>({width:10})};
 for(const [text,expected] of [['甲乙丙，丁',['甲乙','丙，丁']],['甲乙（丙丁',['甲乙','（丙丁']],['甲乙丙。”丁',['甲乙','丙。”','丁']],['甲乙\n，丙',['甲乙','，丙']],['甲👩‍🚀乙丙',['甲👩‍🚀乙','丙']]]){
  const lines=wrapText(context,text,30);assert.deepEqual(lines.map(x=>x.join('')),expected);
 }
});
