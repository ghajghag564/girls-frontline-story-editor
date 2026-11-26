import assert from 'node:assert/strict';
import test from 'node:test';
import {catalogCharacterNames,catalogCharacterSearchText,catalogExpressionName} from '../src/core/catalog-labels.mjs';
import {normalizeCatalog} from '../src/server/catalog.mjs';

test('character labels and search retain canonical IDs and accept optional local equivalents', () => {
  const hero = {id:'original-id', resourceId:'resource-id', name:'见习生', styleName:'实习服', aliases:['旧名'],
    displayNames:{en:{name:'Trainee',styleName:'Uniform'},'zh-TW':{name:'見習生',styleName:'實習服'},ja:{name:'見習い',styleName:'制服'}},
    textures:[{index:0}]};
  const metadata = normalizeCatalog({version:'test',backgrounds:[],music:[],characters:[hero]}).characters[0];
  assert.deepEqual(catalogCharacterNames(metadata,'zh-CN'),{name:'见习生',styleName:'实习服'});
  assert.deepEqual(catalogCharacterNames(metadata,'en'),{name:'Trainee',styleName:'Uniform'});
  assert.deepEqual(catalogCharacterNames(metadata,'zh-TW'),{name:'見習生',styleName:'實習服'});
  assert.deepEqual(catalogCharacterNames(metadata,'ja'),{name:'見習い',styleName:'制服'});
  for (const term of ['original-id','resource-id','见习生','旧名','trainee','實習服','見習い'])
    assert.ok(catalogCharacterSearchText(metadata).includes(term));
  assert.equal(catalogCharacterNames({name:'自訂名字'},'ja').name,'自訂名字');
  assert.equal(metadata.id, 'original-id');
});

test('expression presentation preserves variants, unknown labels, and saved IDs', () => {
  const pose = {id:'opaque-pose-id',name:'惊讶 · 3'};
  for (const language of ['zh-TW','en','ja']) {
    assert.notEqual(catalogExpressionName(pose,language),pose.name);
    assert.match(catalogExpressionName(pose,language),/ · 3$/);
  }
  assert.equal(catalogExpressionName(pose,'zh-CN'),'惊讶 · 3');
  assert.equal(catalogExpressionName({id:'local',name:'表情 2'},'en'),'Expression 2');
  assert.equal(catalogExpressionName({id:'x',name:'試作の表情'},'ja'),'試作の表情');
  assert.deepEqual(pose,{id:'opaque-pose-id',name:'惊讶 · 3'});
});
