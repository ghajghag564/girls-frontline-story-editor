import test from 'node:test';
import assert from 'node:assert/strict';
import {actorParameters,actorTransform} from '../src/core/actor-state.mjs';

test('expression crossfades remain stable when seeking backwards', () => {
  const definition = {
    parameters:[{id:'Angle',min:-1,max:1,default:0}],
    expressions:[
      {id:'up',fadeIn:0,fadeOut:1,parameters:[{id:'Angle',value:1}]},
      {id:'down',fadeIn:1,parameters:[{id:'Angle',value:-1}]},
    ],
  };
  const previous={assetId:'a',expression:'up',start:0};
  const actor={assetId:'a',instanceId:'a1',expression:'down',
    expressionTrack:{assetId:'a',expression:'down',start:2,previous}};
  const read=time=>actorParameters(actor,definition,{time}).Angle;
  assert.equal(read(2),1);
  assert.equal(read(3),-1);
  assert.equal(read(2.5),0);
  assert.equal(read(2),1);
});

test('the generated mouth motion follows the active speaker and stops on punctuation', () => {
  const definition={parameters:[{id:'ParamMouthOpenY',min:0,max:1,default:0}]};
  const actor={assetId:'a',instanceId:'a1'};
  const state={time:.07,mouthSpeaking:true,entry:{line:{speakerInstanceId:'a1'},start:0,transition:0}};
  assert.ok(actorParameters(actor,definition,state).ParamMouthOpenY>0);
  assert.equal(actorParameters(actor,definition,{...state,mouthSpeaking:false}).ParamMouthOpenY,undefined);
  assert.equal(actorParameters({...actor,instanceId:'a2'},definition,state).ParamMouthOpenY,undefined);
});

test('horizontal flip retains the configured actor anchor', () => {
  const canvas={size:[100,100],origin:[50,50],pixelsPerUnit:100};
  const actor={x:.25,y:.75,scale:.7};
  const normal=actorTransform(actor,{},canvas,1280,720);
  const flipped=actorTransform({...actor,flip:true},{},canvas,1280,720);
  assert.deepEqual(normal.origin,flipped.origin);
  assert.equal(normal.scale[0],-flipped.scale[0]);
  assert.equal(normal.scale[1],flipped.scale[1]);
});
