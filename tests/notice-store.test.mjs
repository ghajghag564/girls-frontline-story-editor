import assert from 'node:assert/strict';
import test from 'node:test';
import {acceptNotice, hasAcceptedNotice, loadNoticeAgreement} from '../src/server/notice-store.mjs';

function fixture() {
  const documents = new Map([
    ['LICENSE.md', 'official terms'],
    ['docs/license-zh-CN.md', 'Simplified Chinese reading text'],
    ['docs/license-zh-TW.md', 'Traditional Chinese reading text'],
    ['docs/license-ja.md', 'Japanese reading text'],
  ]);
  return {
    documents,
    files: {
      async read(name) {
        if (!documents.has(name)) throw Object.assign(new Error('Missing file'), {code: 'ENOENT'});
        return Buffer.from(documents.get(name));
      },
      async atomicWrite(name, data) { documents.set(name, data); },
    },
  };
}

test('records the license and displayed text with explicit notice acceptance', async () => {
  const {files, documents} = fixture();
  const {disclosures} = await loadNoticeAgreement(files);
  assert.equal(await hasAcceptedNotice(files, disclosures), false);
  await assert.rejects(acceptNotice(files, {revision: 'local-materials-3', accepted: true}, disclosures), {status: 409});
  const reading = disclosures['zh-TW'];
  await assert.rejects(acceptNotice(files, {...reading, accepted: false}, disclosures), {status: 409});
  await assert.rejects(acceptNotice(files, {...reading, language: 'ja', accepted: true}, disclosures), {status: 409});
  await acceptNotice(files, {...reading, accepted: true}, disclosures);
  const record = JSON.parse(documents.get('userdata/rights-notice-acceptance.json'));
  assert.deepEqual({...record, acceptedAt: undefined}, {...reading, accepted: true, acceptedAt: undefined});
  assert.ok(Number.isFinite(Date.parse(record.acceptedAt)));
  assert.equal(await hasAcceptedNotice(files, disclosures), true);
});

test('requires confirmation again after the license or the accepted reading text changes', async () => {
  const {files, documents} = fixture();
  const {disclosures} = await loadNoticeAgreement(files);
  await acceptNotice(files, {...disclosures.ja, accepted: true}, disclosures);
  documents.set('docs/license-ja.md', 'updated reading text');
  const revised = (await loadNoticeAgreement(files)).disclosures;
  assert.equal(await hasAcceptedNotice(files, revised), false);
  await assert.rejects(acceptNotice(files, {...disclosures.ja, accepted: true}, revised), {status: 409});
  await acceptNotice(files, {...revised.ja, accepted: true}, revised);
  documents.set('LICENSE.md', 'updated official terms');
  assert.equal(await hasAcceptedNotice(files, (await loadNoticeAgreement(files)).disclosures), false);
});
