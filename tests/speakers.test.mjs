import test from 'node:test';
import assert from 'node:assert/strict';
import {characterDisplayRecord, localizeLegacySpeakers} from '../src/core/speakers.mjs';

test('catalog-provided names, aliases and expression names are preserved', () => {
  const character = {
    id: 'asset-a', name: '甲', aliases: ['A'],
    expressions: [{id: 'pose-1', name: '第一姿态'}],
  };
  assert.deepEqual(characterDisplayRecord(character), character);
});

test('migration updates generated captions and preserves author-entered text', () => {
  const characters = [{id: 'asset-a', name: '甲', legacySpeakerName: 'old-a'}];
  const actor = {instanceId: 'actor-a', assetId: 'asset-a'};
  const line = {kind: 'dialogue', speakerInstanceId: actor.instanceId, speaker: 'old-a'};
  const custom = {...line, speaker: '我写的称呼'};
  const project = {scenes: [{entries: [{...line, stage: {actors: [actor]}}, custom]}]};
  const migrated = localizeLegacySpeakers(project, characters);

  assert.equal(migrated.scenes[0].entries[0].speaker, '甲');
  assert.equal(project.scenes[0].entries[0].speaker, 'old-a');
  assert.equal(migrated.scenes[0].entries[1].speaker, custom.speaker);
  assert.equal(localizeLegacySpeakers(migrated, characters), migrated);
});
