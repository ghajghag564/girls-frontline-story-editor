import {createHash} from 'node:crypto';
import {rightsNotice} from '../core/rights-notice.mjs';

const recordPath = 'userdata/rights-notice-acceptance.json';
const licensePaths = {
  en: 'LICENSE.md',
  'zh-CN': 'docs/license-zh-CN.md',
  'zh-TW': 'docs/license-zh-TW.md',
  ja: 'docs/license-ja.md',
};
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

export async function loadNoticeAgreement(files) {
  const documents = new Map(await Promise.all(Object.entries(licensePaths).map(async ([language, file]) =>
    [language, await files.read(file)])));
  const licenseSha256 = sha256(documents.get('en'));
  const disclosures = Object.fromEntries([...documents].map(([language, bytes]) => [language, {
    revision: rightsNotice.revision,
    language,
    licenseSha256,
    displayedTextSha256: sha256(bytes),
  }]));
  return {documents, disclosures};
}

function currentDisclosure(record, disclosures) {
  const language = record?.language;
  if (record?.accepted !== true || typeof language !== 'string' || !Object.hasOwn(disclosures, language)) return null;
  const disclosure = disclosures[language];
  return Object.entries(disclosure).every(([key, value]) => record[key] === value) ? disclosure : null;
}

export async function hasAcceptedNotice(files, disclosures) {
  try {
    return currentDisclosure(JSON.parse((await files.read(recordPath)).toString('utf8')), disclosures) !== null;
  } catch (error) {
    if (error.code === 'ENOENT' || error instanceof SyntaxError) return false;
    throw error;
  }
}

export async function acceptNotice(files, body, disclosures) {
  const disclosure = currentDisclosure(body, disclosures);
  if (!disclosure) throw Object.assign(new Error('请先阅读并同意创作须知和软件许可。'), {status: 409});
  const record = {...disclosure, accepted: true, acceptedAt: new Date().toISOString()};
  await files.atomicWrite(recordPath, JSON.stringify(record, null, 2) + '\n');
  return {accepted: true, revision: disclosure.revision};
}
