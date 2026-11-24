import assert from 'node:assert/strict';
import test from 'node:test';
import {createStarterExample, localizeStarterExample} from '../src/core/starter-example.mjs';
import {endsWithSpeechPause, hasSpeechPause} from '../src/core/timeline.mjs';
import {setInterfaceLanguage, t} from '../src/web/i18n.mjs';

const punctuationHint = '请在需要停口的地方加标点，例如“收到，现在出发。”逗号让角色稍停，句号让角色收口。';

test('Traditional Chinese UI uses halfwidth punctuation in built-in copy only', () => {
  globalThis.document = {documentElement: {}};
  try {
    setInterfaceLanguage('zh-TW');
    assert.equal(t(punctuationHint), '請在需要停口的地方加標點, 例如 "收到, 現在出發." 逗號讓角色稍停, 句號讓角色收口.');
    assert.equal(t('停留（秒）'), '停留 (秒)');
    assert.ok(t('{0} · 可直接播放或编辑', '我的作品，第二幕。').startsWith('我的作品，第二幕。'));
    assert.equal(t('自寫句子，請保留。'), '自寫句子，請保留。');
    setInterfaceLanguage('zh-CN');
    assert.equal(t(punctuationHint), punctuationHint);
  } finally {
    setInterfaceLanguage('zh-CN');
    delete globalThis.document;
  }
});

test('Traditional Chinese stock examples keep switching languages and retain custom dialogue', () => {
  const stock = createStarterExample('local', 'zh-TW');
  const line = project => project.scenes[0].entries[0];
  assert.equal(line(stock).text, '先看一遍, 再換成你的台詞.');
  assert.equal(line(localizeStarterExample(stock, 'en')).text, 'Watch this once, then replace it with your own line.');

  const previous = structuredClone(stock);
  previous.scenes[0].id = 'saved-scene';
  line(previous).id = 'saved-line';
  line(previous).text = '先看一遍，再換成你的台詞。';
  const updated = localizeStarterExample(previous, 'zh-TW');
  assert.equal(line(updated).text, line(stock).text);
  assert.equal(line(localizeStarterExample(updated, 'en')).text, 'Watch this once, then replace it with your own line.');

  const edited = structuredClone(stock);
  line(edited).text = '我自己寫的臺詞，請原樣保留。';
  assert.equal(line(localizeStarterExample(edited, 'zh-TW')).text, line(edited).text);
  assert.ok(hasSpeechPause('收到, 現在出發'));
  assert.ok(endsWithSpeechPause('收到, 現在出發.'));
});
