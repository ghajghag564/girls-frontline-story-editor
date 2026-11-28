import fs from 'node:fs/promises';
import {createHash, randomUUID} from 'node:crypto';
import {LOCAL_AUDIO, isLocalAudioId, localWaveBytes, readLocalWaveHeader, validLocalAudioSamples} from '../core/local-audio.mjs';
import {fileDigest} from './file-hash.mjs';

const libraryPath = 'userdata/local-audio';
const wavePath = id => libraryPath + '/' + id + '.wav';
const recordPath = id => libraryPath + '/' + id + '.json';
const validName = name => typeof name === 'string' && name.trim().length > 0 &&
  name.length <= 100 && !/[\x00-\x1f\x7f]/.test(name);
const statusError = (message, status) => Object.assign(new Error(message), {status});

function uploadDetails(request) {
  if (request.headers['content-type']?.toLowerCase() !== 'audio/wav') {
    throw statusError('本地音频格式无效。', 415);
  }
  const declaredSize = request.headers['content-length'];
  const size = Number(declaredSize);
  if (size > localWaveBytes(LOCAL_AUDIO.sampleRate * LOCAL_AUDIO.maxSeconds)) {
    throw statusError('本地音频超过允许的时长。', 413);
  }
  if (!/^\d+$/.test(declaredSize ?? '') ||
      !validLocalAudioSamples((size - LOCAL_AUDIO.headerBytes) / LOCAL_AUDIO.bytesPerFrame)) {
    throw statusError('本地音频格式无效。', 400);
  }
  let name;
  try { name = decodeURIComponent(request.headers['x-gf2-audio-name'] ?? ''); }
  catch { throw statusError('音频名称无效。', 400); }
  if (!validName(name)) throw statusError('音频名称无效。', 400);
  return {name, size};
}

export class LocalAudioLibrary {
  constructor(files) {
    this.files = files;
    this.importing = false;
  }

  async list() {
    const directory = await this.files.resolve(libraryPath);
    let entries;
    try { entries = await fs.readdir(directory, {withFileTypes: true}); }
    catch (error) { if (error.code === 'ENOENT') return []; throw error; }

    const tracks = [];
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
      const id = entry.name.slice(0, -5);
      if (!isLocalAudioId(id)) continue;
      try { tracks.push(await this.readTrack(id)); }
      catch { /* A missing or damaged recording must not prevent the editor from opening. */ }
    }
    return tracks;
  }

  async readTrack(id) {
    const metadata = await this.files.resolve(recordPath(id));
    const stat = await fs.stat(metadata);
    if (!stat.isFile() || stat.size > 4096) throw new Error('本地音频格式无效。');
    const {name, samples} = JSON.parse(await fs.readFile(metadata, 'utf8'));
    if (!validName(name) || !validLocalAudioSamples(samples)) throw new Error('本地音频格式无效。');

    const path = wavePath(id);
    const handle = await fs.open(await this.files.resolve(path), 'r');
    try {
      const audio = await handle.stat();
      const header = Buffer.alloc(LOCAL_AUDIO.headerBytes);
      const {bytesRead} = await handle.read(header, 0, header.length, 0);
      if (!audio.isFile() || bytesRead !== header.length ||
          readLocalWaveHeader(header, audio.size) !== samples) throw new Error('本地音频格式无效。');
    } finally {
      await handle.close();
    }
    return {
      id, name, samples, path, source: 'local', sha256: id.slice('local_audio_'.length),
      sampleRate: LOCAL_AUDIO.sampleRate, channels: LOCAL_AUDIO.channels,
    };
  }

  async import(request) {
    if (this.importing) throw statusError('已有音频正在导入，请稍后再试。', 409);
    const {name, size} = uploadDetails(request);
    this.importing = true;
    let staged;
    try {
      await fs.mkdir(await this.files.resolve(libraryPath), {recursive: true});
      staged = await this.files.resolve(libraryPath + '/.upload-' + randomUUID() + '.wav');
      const digest = createHash('sha256');
      const header = Buffer.alloc(LOCAL_AUDIO.headerBytes);
      let received = 0;
      const handle = await fs.open(staged, 'wx');
      try {
        for await (const chunk of request) {
          if (received + chunk.length > size) throw new Error('本地音频格式无效。');
          if (received < header.length) chunk.copy(header, received, 0, Math.min(chunk.length, header.length - received));
          digest.update(chunk);
          await handle.writeFile(chunk);
          received += chunk.length;
        }
        if (received !== size) throw new Error('音频上传中断，请重试。');
        await handle.sync();
      } finally {
        await handle.close();
      }

      const samples = readLocalWaveHeader(header, size);
      const sha256 = digest.digest('hex');
      const id = 'local_audio_' + sha256;
      const target = await this.files.resolve(wavePath(id));
      // Identical imports reuse the original name. A new upload can repair a missing or damaged WAV.
      const previous = await this.readTrack(id).catch(() => null);
      if (previous && await fileDigest(target) === sha256) return previous;
      await fs.rename(staged, target);
      await this.files.atomicWrite(recordPath(id), JSON.stringify({name: previous?.name ?? name, samples}));
      return await this.readTrack(id);
    } catch (error) {
      if (error.code === 'ENOSPC') throw statusError('磁盘空间不足，无法导入音频。', 507);
      throw error;
    } finally {
      this.importing = false;
      if (staged) await fs.unlink(staged).catch(error => { if (error.code !== 'ENOENT') throw error; });
    }
  }
}
