import fs from 'node:fs/promises';
import {createHash, randomUUID} from 'node:crypto';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {isLocalAudioId} from '../core/local-audio.mjs';
import {
 VIDEO_LIMITS, isLocalVideoId, matchesVideoContainer, validVideoMetadata, videoTypes,
} from '../core/video.mjs';

const localDirectory = 'userdata/local-video';
const hashPattern = /^[a-f0-9]{64}$/;
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const fail = (message, status = 400) => Object.assign(new Error(message), {status});
const validName = name => typeof name === 'string' && name.trim().length > 0 && name.length <= 100 && !/[\x00-\x1f\x7f]/.test(name);
const validBytes = bytes => Number.isSafeInteger(bytes) && bytes >= 16 && bytes <= VIDEO_LIMITS.maxBytes;
const recordPath = id => localDirectory + '/' + id + '.json';
const mediaPath = (id, format) => localDirectory + '/' + id + '.' + format;

function validateRecord(record) {
 if (!isLocalVideoId(record.id) || !validName(record.name) || !Object.hasOwn(videoTypes, record.format) ||
     !validBytes(record.bytes) || !validVideoMetadata(record) || !Array.isArray(record.chunks) ||
     record.chunks.length !== Math.ceil(record.bytes / VIDEO_LIMITS.chunkBytes) ||
     record.chunks.some(hash => typeof hash !== 'string' || !hashPattern.test(hash))) {
  throw fail('视频素材记录无效。', 422);
 }
 return record;
}

export function publicVideo({path, chunks, ...record}) {
 return record;
}

async function readExact(file, offset, length) {
 const bytes = Buffer.alloc(length);
 let received = 0;
 while (received < length) {
  const {bytesRead} = await file.read(bytes, received, length - received, offset + received);
  if (!bytesRead) throw fail('视频文件不完整，请重新导入或恢复素材。', 422);
  received += bytesRead;
 }
 return bytes;
}

function byteRange(size, header) {
 if (!header) return {start: 0, end: size - 1, partial: false};
 const match = /^bytes=(\d*)-(\d*)$/.exec(header);
 if (!match || (!match[1] && !match[2])) return null;
 const start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
 const end = match[1] && match[2] ? Math.min(size - 1, Number(match[2])) : size - 1;
 if (!Number.isSafeInteger(start) || start >= size || start > end) return null;
 return {start, end, partial: true};
}

export class VideoLibrary {
 constructor(files) {
  this.files = files;
  this.importing = false;
  this.readers = 0;
 }

 async list() {
  let entries;
  try { entries = await fs.readdir(await this.files.resolve(localDirectory), {withFileTypes: true}); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  const videos = [];
  for (const entry of entries) {
   if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
   const id = entry.name.slice(0, -5);
   if (!isLocalVideoId(id)) continue;
   const record = await this.read(id).catch(() => null);
   if (record) videos.push(record);
  }
  return videos;
 }

 async read(id) {
  const path = await this.files.resolve(recordPath(id));
  if ((await fs.stat(path)).size > 16 * 1024) throw fail('视频素材记录无效。', 422);
  const record = validateRecord({...JSON.parse(await fs.readFile(path, 'utf8')), id});
  if (record.audioId !== undefined && !isLocalAudioId(record.audioId)) throw fail('过场视频原声记录无效。', 422);
  const media = mediaPath(id, record.format);
  if ((await fs.stat(await this.files.resolve(media))).size !== record.bytes) throw fail('视频文件不完整，请重新导入或恢复素材。', 422);
  return {...record, source: 'local', path: media};
 }

 async import(request, tracks) {
  if (this.importing) throw fail('已有视频正在导入，请稍后再试。', 409);
  const declaredSize = request.headers['content-length'];
  const bytes = Number(declaredSize);
  if (bytes > VIDEO_LIMITS.maxBytes) throw fail('视频文件不得超过 128 MiB。', 413);
  if (!/^\d+$/.test(declaredSize ?? '') || !validBytes(bytes)) throw fail('视频文件大小无效。');
  let info;
  try { info = JSON.parse(decodeURIComponent(request.headers['x-gf2-video-info'] ?? '')); }
  catch { throw fail('视频素材记录无效。'); }
  if (!info || !validName(info.name) || !validVideoMetadata(info) || !Object.hasOwn(videoTypes, info.format) ||
      request.headers['content-type'] !== videoTypes[info.format]) throw fail('视频格式、分辨率或时长超出范围。', 415);
  const {name, format, width, height, seconds, audioId} = info;
  if (audioId !== undefined && (!isLocalAudioId(audioId) || !tracks.some(track => track.id === audioId))) {
   throw fail('过场视频原声记录无效。');
  }
  this.importing = true;
  let staged;
  try {
   await fs.mkdir(await this.files.resolve(localDirectory), {recursive: true});
   staged = await this.files.resolve(localDirectory + '/.upload-' + randomUUID() + '.part');
   const file = await fs.open(staged, 'wx+');
   const hash = createHash('sha256'), chunks = [];
   try {
    let received = 0;
    for await (const chunk of request) {
     received += chunk.length;
     if (received > bytes) throw fail('视频文件大小无效。');
     hash.update(chunk);
     await file.writeFile(chunk);
    }
    if (received !== bytes) throw fail('视频上传中断，请重试。');
    if (!matchesVideoContainer(await readExact(file, 0, 16), format)) throw fail('文件内容与所选视频格式不一致。', 415);
    for (let start = 0; start < bytes; start += VIDEO_LIMITS.chunkBytes) {
     chunks.push(digest(await readExact(file, start, Math.min(VIDEO_LIMITS.chunkBytes, bytes - start))));
    }
    await file.sync();
   } finally { await file.close(); }

   const id = 'video_local_' + hash.digest('hex');
   const previous = await this.read(id).catch(() => null);
   const path = await this.files.resolve(mediaPath(id, format));
   await fs.rename(staged, path);
   await this.files.atomicWrite(recordPath(id), JSON.stringify({
    name: previous?.name ?? name, format, width, height, seconds, audioId: audioId ?? previous?.audioId, bytes, chunks,
   }));
   return await this.read(id);
  } catch (error) {
   if (error.code === 'ENOSPC') throw fail('磁盘空间不足，无法导入视频。', 507);
   throw error;
  } finally {
   this.importing = false;
   if (staged) await fs.unlink(staged).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
 }

 async serve(asset, request, response) {
  const range = byteRange(asset.bytes, request.headers.range);
  if (!range) {
   response.writeHead(416, {'Content-Range': 'bytes */' + asset.bytes});
   return response.end();
  }
  if (this.readers >= 8) throw fail('视频读取繁忙，请稍后重试。', 429);
  this.readers++;
  let file;
  try {
   file = await fs.open(await this.files.resolve(asset.path), 'r');
   const stat = await file.stat();
   if (!stat.isFile() || stat.nlink !== 1 || stat.size !== asset.bytes) {
    throw fail('视频文件不完整，请重新导入或恢复素材。', 422);
   }
   const {start, end, partial} = range;
   const headers = {
    'Content-Type': videoTypes[asset.format], 'Content-Length': end - start + 1, 'Accept-Ranges': 'bytes',
   };
   if (partial) headers['Content-Range'] = 'bytes ' + start + '-' + end + '/' + asset.bytes;

   if (request.method === 'HEAD') {
    response.writeHead(partial ? 206 : 200, headers);
    return response.end();
   }
   const chunkBytes = VIDEO_LIMITS.chunkBytes;
   const readChunk = async offset => {
    const data = await readExact(file, offset, Math.min(chunkBytes, asset.bytes - offset));
    if (digest(data) !== asset.chunks[offset / chunkBytes]) throw fail('视频校验失败，请重新导入或恢复素材。', 422);
    return data.subarray(Math.max(0, start - offset), Math.min(data.length, end - offset + 1));
   };
   const first = Math.floor(start / chunkBytes) * chunkBytes;
   const head = await readChunk(first);
   response.writeHead(partial ? 206 : 200, headers);
   await pipeline(Readable.from((async function* () {
    yield head;
    for (let offset = first + chunkBytes; offset <= end; offset += chunkBytes) {
     yield await readChunk(offset);
    }
   })()), response);
  } finally {
   this.readers--;
   await file?.close();
  }
 }
}
