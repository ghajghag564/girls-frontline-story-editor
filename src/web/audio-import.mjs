import {t, translateMessage} from './i18n.mjs';
import {token} from '/bootstrap.mjs';
import {LOCAL_AUDIO, encodeLocalWave, validLocalAudioSamples} from '/core/local-audio.mjs';

const supportedExtension = /\.(mp3|wav|m4a|aac|flac|ogg|opus)$/i;

async function audioDuration(file) {
  const audio = document.createElement('audio');
  const url = URL.createObjectURL(file);
  try {
    return await new Promise((resolve, reject) => {
      const failed = () => reject(new Error(t('无法读取此音频，请尝试 MP3 或 WAV 文件。')));
      const timer = setTimeout(failed, 12000);
      audio.preload = 'metadata';
      audio.onloadedmetadata = () => { clearTimeout(timer); resolve(audio.duration); };
      audio.onerror = () => { clearTimeout(timer); failed(); };
      audio.src = url;
    });
  } finally {
    audio.onloadedmetadata = audio.onerror = null;
    audio.removeAttribute('src');
    audio.load();
    URL.revokeObjectURL(url);
  }
}

export async function prepareAudioFile(file) {
  if (!supportedExtension.test(file.name)) throw new Error(t('请选择支持的音频文件。'));
  if (!file.size) throw new Error(t('无法读取此音频，请尝试 MP3 或 WAV 文件。'));
  const {sampleRate, channels, maxSeconds, maxInputBytes} = LOCAL_AUDIO;
  if (file.size > maxInputBytes) throw new Error(t('音频文件不得超过 {0} MiB。', maxInputBytes / 1024 ** 2));
  const duration = await audioDuration(file);
  if (!Number.isFinite(duration) || duration <= 0) throw new Error(t('无法读取此音频，请尝试 MP3 或 WAV 文件。'));
  if (duration > maxSeconds) throw new Error(t('单段音频不得超过 {0} 分钟。', maxSeconds / 60));

  let decoded;
  try {
    const decoder = new OfflineAudioContext(channels, 1, sampleRate);
    decoded = await decoder.decodeAudioData(await file.arrayBuffer());
  } catch {
    throw new Error(t('无法读取此音频，请尝试 MP3 或 WAV 文件。'));
  }
  if (!validLocalAudioSamples(decoded.length)) throw new Error(t('单段音频不得超过 {0} 分钟。', maxSeconds / 60));
  if (decoded.numberOfChannels > channels) {
    const context = new OfflineAudioContext(channels, decoded.length, sampleRate);
    const source = context.createBufferSource();
    source.buffer = decoded;
    source.connect(context.destination);
    source.start();
    decoded = await context.startRendering();
  }
  const name = file.name.replace(supportedExtension, '').replace(/[\x00-\x1f\x7f]/g, '').trim().slice(0, 100).toWellFormed() || t('本地音频');
  const wave = new Blob([encodeLocalWave(decoded)], {type: 'audio/wav'});
  return {name, wave, seconds: decoded.length / sampleRate};
}

export function setupAudioImport({onPause, onImport}) {
  const get = id => document.getElementById(id);
  const dialog = get('audio-import-dialog');
  const input = get('audio-file');
  const preview = get('audio-import-preview');
  const confirm = get('confirm-audio-import');
  const close = get('cancel-audio-import');
  const status = get('audio-import-status');
  let prepared, url, version = 0, preparing = false, saving = false;

  function updateControls() {
    input.disabled = preparing || saving;
    confirm.disabled = !prepared || preparing || saving;
    close.disabled = saving;
  }

  function clearPreview() {
    prepared = null;
    preview.pause();
    preview.hidden = true;
    preview.removeAttribute('src');
    preview.load();
    if (url) URL.revokeObjectURL(url);
    url = null;
  }

  function reset() {
    version++;
    input.value = '';
    clearPreview();
    updateControls();
  }

  close.onclick = () => dialog.close();
  dialog.addEventListener('close', reset);
  dialog.addEventListener('cancel', event => { if (saving) event.preventDefault(); });
  input.onchange = async () => {
    clearPreview();
    const file = input.files[0];
    if (!file) { updateControls(); return; }
    const selection = ++version;
    preparing = true;
    updateControls();
    status.textContent = t('正在读取音频…');
    try {
      const result = await prepareAudioFile(file);
      if (selection !== version || !dialog.open) return;
      prepared = result;
      url = URL.createObjectURL(result.wave);
      preview.src = url;
      preview.hidden = false;
      status.textContent = t('{0} · {1} 秒', result.name, result.seconds.toFixed(1));
    } catch (error) {
      if (selection === version && dialog.open) status.textContent = translateMessage(error.message);
    } finally {
      preparing = false;
      updateControls();
    }
  };

  confirm.onclick = async () => {
    if (!prepared || saving) return;
    saving = true;
    preview.pause();
    updateControls();
    status.textContent = t('正在保存到本地素材库…');
    try {
      const response = await fetch('/api/local-audio', {
        method: 'POST',
        headers: {
          'x-gf2-token': token, 'content-type': 'audio/wav',
          'x-gf2-audio-name': encodeURIComponent(prepared.name),
        },
        body: prepared.wave,
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? t('音频导入失败。'));
      onImport(result);
      dialog.close();
    } catch (error) {
      status.textContent = translateMessage(error.message);
    } finally {
      saving = false;
      updateControls();
    }
  };

  return () => {
    onPause();
    reset();
    status.textContent = t('单段音频最长 {0} 分钟，文件最大 {1} MiB。', LOCAL_AUDIO.maxSeconds / 60, LOCAL_AUDIO.maxInputBytes / 1024 ** 2);
    dialog.showModal();
  };
}
