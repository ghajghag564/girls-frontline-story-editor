import test from 'node:test';
import assert from 'node:assert/strict';
import {compileProject,stateAt,musicAt,validateExport,frameTimes} from '../src/core/timeline.mjs';
const line=(id,extra={})=>({id,kind:'dialogue',text:'你好',transition:0,charactersPerSecond:2,hold:1,...extra});
const compile=entries=>compileProject({formatVersion:1,scenes:[{id:'scene',entries}]});
const audio={song:{sampleRate:48000,samples:480000,loop:{start:96000,end:384000}},second:{sampleRate:48000,samples:480000}};
test('inherited music stays sample-continuous across lines and range starts',()=>{
 const c=compile([line('a',{music:{op:'play',assetId:'song',fadeIn:0,volume:1}}),line('b'),line('c')]);
 assert.equal(musicAt(c,3,audio)[0].sample,144000);
 assert.equal(musicAt(c,2,audio)[0].sample,96000);
 const settings=validateExport({ratio:'16:9',resolution:2160,fps:60,bitrateMbps:100,codec:'h264',start:2.5,end:5},c.duration);
 assert.deepEqual([settings.width,settings.height],[3840,2160]);
 assert.equal(musicAt(c,frameTimes(settings).next().value.time,audio)[0].sample,120000);
});
test('loop respects original intro and sample endpoints',()=>{
 const c=compile([line('a',{hold:20,music:{op:'play',assetId:'song',fadeIn:0}})]);
 assert.equal(musicAt(c,8,audio)[0].sample,96000);
 assert.equal(musicAt(c,14,audio)[0].sample,96000);
});
test('crossfade restores both voices and stop preserves gain at interruption',()=>{
 const c=compile([line('a',{music:{op:'play',assetId:'song',fadeIn:4,volume:1}}),line('b',{music:{op:'play',assetId:'second',fadeIn:2,fadeOut:2,volume:1}}),line('c',{music:{op:'stop',fadeOut:1}})]);
 const at=musicAt(c,3,audio);assert.equal(at.length,2);assert.equal(at[0].gain,.25);assert.equal(at[1].gain,.5);
 assert.equal(musicAt(c,4.5,audio)[0].gain,.5);assert.equal(musicAt(c,5,audio).length,0);
});
test('actors inherit and transition from previous placement with movement',()=>{
 const c=compile([line('a',{stage:{actors:[{instanceId:'one',assetId:'original',x:.5}]}}),line('b',{transition:1,stage:{actors:[{instanceId:'one',assetId:'original',x:.25},{instanceId:'two',assetId:'original',x:.75}]}}),line('c')]);
 const s=stateAt(c,2.5);assert.equal(s.actors[0].x,.375);assert.equal(s.actors[1].opacity,.5);
 assert.equal(stateAt(c,5.5).actors.length,2);assert.deepEqual(stateAt(c,2.5),stateAt(c,2.5));
});
test('typewriter does not split emoji or combined graphemes',()=>{
 const c=compile([line('a',{text:'👩‍💻好',charactersPerSecond:1})]);assert.equal(stateAt(c,1).text,'👩‍💻');assert.equal(stateAt(c,2).complete,true);
});
test('invalid ranges, unsupported codecs and nonfinite values are rejected',()=>{
 const base={ratio:'16:9',resolution:1440,fps:60,bitrateMbps:60,codec:'h264'};
 assert.throws(()=>validateExport({...base,start:2,end:1},5));assert.throws(()=>validateExport({...base,codec:'h265'},5,['h264']));
 assert.throws(()=>compile([line('a',{hold:NaN})]));assert.throws(()=>compile([line('a'),line('a')]));
 assert.equal([...frameTimes(validateExport({...base,end:1},5))].length,60);
});

test('shake is reproducible after seeks, covers frame edges, and settles at short line boundaries',()=>{
 const c=compile([line('a',{hold:0,text:'',kind:'pause',transition:.4,effects:{shake:{amount:.03,duration:2}}}),line('b')]);
 const expected=stateAt(c,.17).camera;assert.notEqual(expected.x,0);
 stateAt(c,1);stateAt(c,0);assert.deepEqual(stateAt(c,.17).camera,expected);
 for(let i=0;i<=400;i++){const camera=stateAt(c,i/1000).camera;assert.ok(Math.abs(camera.x)<=(camera.zoom-1)/2+1e-12);assert.ok(Math.abs(camera.y)<=(camera.zoom-1)/2+1e-12);}
 assert.deepEqual(stateAt(c,0).camera,{x:0,y:0,zoom:1});
 assert.ok(Math.abs(stateAt(c,.399999).camera.x)<1e-10);
 assert.deepEqual(stateAt(c,.4).camera,{x:0,y:0,zoom:1});
 const restored=compileProject(JSON.parse(JSON.stringify({formatVersion:1,scenes:[{id:'s',entries:c.entries.map(e=>e.line)}]})));
 assert.deepEqual(stateAt(restored,.17).camera,expected);
});
test('pause inherits stage and music; black clears actors and transitions without resetting music',()=>{
 const c=compile([line('a',{stage:{background:'room',actors:[{instanceId:'one',assetId:'original'}]},music:{op:'play',assetId:'song',fadeIn:0}}),line('pause',{kind:'pause',text:'',hold:1}),line('black',{kind:'pause',text:'',transition:.5,hold:1,stage:{background:null,color:'#000000',actors:[]}})]);
 assert.equal(stateAt(c,2.5).background,'room');assert.equal(stateAt(c,2.5).actors.length,1);
 const fade=stateAt(c,3.25);assert.equal(fade.previousBackground,'room');assert.equal(fade.background,null);assert.equal(fade.transitionProgress,.5);assert.equal(fade.actors[0].opacity,.5);
 assert.equal(stateAt(c,3.5).actors.length,0);assert.equal(musicAt(c,3.5,audio)[0].sample,168000);
});


test('speaker highlight fades in absolute time, inherits without restarting, and survives reverse seeking',()=>{
 const actors=[{instanceId:'a',assetId:'one'},{instanceId:'b',assetId:'two'}];
 const c=compile([line('a',{text:'',hold:1,speakerInstanceId:'a',stage:{actors}}),line('b',{text:'',hold:.1,speakerInstanceId:'b'}),line('inherit',{text:'',hold:1,speakerInstanceId:'b'}),line('narration',{kind:'narration',text:'',hold:1})]);
 const brightness=t=>stateAt(c,t).actors.map(a=>a.brightness),close=(actual,expected)=>actual.forEach((v,i)=>assert.ok(Math.abs(v-expected[i])<1e-10));
 close(brightness(1),[1,.45]);close(brightness(1.1),[.725,.725]);close(brightness(1.2),[.45,1]);
 close(brightness(2.2),[.45,.725]);close(brightness(2.3),[.45,.45]);
 assert.equal(brightness(2.2)[0],brightness(2)[0],'narration must not brighten the already non-speaking actor');
 const reference=brightness(1.075);brightness(3);brightness(0);assert.deepEqual(brightness(1.075),reference);
});

test('interrupted highlight reverses continuously; exit retains lighting and re-entry resets it',()=>{
 const a={instanceId:'a',assetId:'one'},b={instanceId:'b',assetId:'two'};
 const c=compile([line('first',{text:'',hold:1,speakerInstanceId:'a',stage:{actors:[a,b]}}),line('second',{text:'',hold:.1,speakerInstanceId:'b'}),line('back',{text:'',hold:.1,speakerInstanceId:'a'}),line('exit',{kind:'pause',text:'',transition:.3,hold:.1,stage:{actors:[b]}}),line('reenter',{text:'',hold:1,speakerInstanceId:'a',stage:{actors:[a,b]}})]);
 const actor=(t,id)=>stateAt(c,t).actors.find(a=>a.instanceId===id);
 assert.ok(Math.abs(actor(1.1,'a').brightness-.725)<1e-10);
 assert.ok(Math.abs(actor(1.2,'a').brightness-.8625)<1e-10);
 assert.ok(Math.abs(actor(1.3,'a').brightness-1)<1e-10);
 assert.equal(actor(1.6,'a').brightness,1);assert.equal(actor(1.6,'a').opacity,1);
});


test('an offstage speaker dims every onstage actor and keeps continuous handovers',()=>{
 const actors=[{instanceId:'a',assetId:'one'},{instanceId:'b',assetId:'two'}];
 for(const speakerInstanceId of [null,undefined]){
  const c=compile([line('first',{text:'',hold:1,speakerInstanceId:'a',stage:{actors}}),line('outside',{text:'',hold:1,speaker:'画外播报员',speakerInstanceId}),line('return',{text:'',hold:1,speakerInstanceId:'b'})]);
  const values=t=>stateAt(c,t).actors.map(a=>a.brightness),close=(t,want)=>values(t).forEach((v,i)=>assert.ok(Math.abs(v-want[i])<1e-10));
  close(.9,[1,.45]);close(1,[1,.45]);close(1.1,[.725,.45]);close(1.2,[.45,.45]);close(1.9,[.45,.45]);close(2,[.45,.45]);close(2.1,[.45,.725]);close(2.2,[.45,1]);
  const midpoint=values(1.1);values(2.8);values(0);assert.deepEqual(values(1.1),midpoint);
  assert.equal(stateAt(c,1.5).speaker,'画外播报员');
 }
});
