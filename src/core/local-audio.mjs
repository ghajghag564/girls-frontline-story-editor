export const LOCAL_AUDIO = Object.freeze({
  sampleRate: 48000,
  channels: 2,
  bytesPerFrame: 4,
  headerBytes: 44,
  maxSeconds: 600,
  maxInputBytes: 128 * 1024 ** 2,
});

const maxSamples = LOCAL_AUDIO.sampleRate * LOCAL_AUDIO.maxSeconds;
export const localWaveBytes = samples => LOCAL_AUDIO.headerBytes + samples * LOCAL_AUDIO.bytesPerFrame;
export const isLocalAudioId = id => typeof id === 'string' && /^local_audio_[a-f0-9]{64}$/.test(id);
export const validLocalAudioSamples = samples => Number.isSafeInteger(samples) && samples > 0 && samples <= maxSamples;

function writeWaveHeader(view, samples) {
  const {sampleRate, channels, bytesPerFrame} = LOCAL_AUDIO;
  view.setUint32(0, 0x52494646); // RIFF
  view.setUint32(4, localWaveBytes(samples) - 8, true);
  view.setUint32(8, 0x57415645); // WAVE
  view.setUint32(12, 0x666d7420); // fmt
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // Linear PCM
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * bytesPerFrame, true);
  view.setUint16(32, bytesPerFrame, true);
  view.setUint16(34, 16, true);
  view.setUint32(36, 0x64617461); // data
  view.setUint32(40, samples * bytesPerFrame, true);
}

/** The uploader accepts only the exact WAV layout produced by the browser. */
export function readLocalWaveHeader(header, size) {
  const {headerBytes, bytesPerFrame} = LOCAL_AUDIO;
  const samples = (size - headerBytes) / bytesPerFrame;
  if (header.length !== headerBytes || !validLocalAudioSamples(samples)) throw new Error('本地音频格式无效。');
  const expected = new Uint8Array(headerBytes);
  writeWaveHeader(new DataView(expected.buffer), samples);
  if (!expected.every((byte, index) => byte === header[index])) throw new Error('本地音频格式无效。');
  return samples;
}

export function encodeLocalWave(audio) {
  const {length, sampleRate, numberOfChannels} = audio;
  if (!validLocalAudioSamples(length) || sampleRate !== LOCAL_AUDIO.sampleRate ||
      ![1, LOCAL_AUDIO.channels].includes(numberOfChannels)) {
    throw new Error('本地音频格式无效。');
  }
  const wave = new ArrayBuffer(localWaveBytes(length));
  const view = new DataView(wave);
  writeWaveHeader(view, length);
  const left = audio.getChannelData(0);
  const right = numberOfChannels === 1 ? left : audio.getChannelData(1);
  const pcm16 = value => Math.max(-32768, Math.min(32767, Math.round(value * 32768)));
  for (let i = 0, offset = LOCAL_AUDIO.headerBytes; i < length; i++, offset += LOCAL_AUDIO.bytesPerFrame) {
    view.setInt16(offset, pcm16(left[i]), true);
    view.setInt16(offset + 2, pcm16(right[i]), true);
  }
  return wave;
}
