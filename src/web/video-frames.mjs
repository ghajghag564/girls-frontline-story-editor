import {t} from './i18n.mjs';
import {videoUrl} from '/core/video.mjs';

export function waitForMedia(video, event, ready, signal) {
 if (signal?.aborted) return Promise.reject(signal.reason);
 if (video.error) return Promise.reject(new Error(t('无法读取此视频，请检查编码格式或重新导入。')));
 if (ready()) return Promise.resolve();
 return new Promise((resolve, reject) => {
  const fail = () => finish(new Error(t('无法读取此视频，请检查编码格式或重新导入。')));
  const aborted = () => finish(signal.reason);
  const loaded = () => { if (ready()) finish(); };
  const timer = setTimeout(fail, 15000);
  function finish(error) {
   clearTimeout(timer);
   video.removeEventListener(event, loaded);
   video.removeEventListener('error', fail);
   signal?.removeEventListener('abort', aborted);
   if (error) reject(error); else resolve();
  }
  video.addEventListener(event, loaded);
  video.addEventListener('error', fail);
  signal?.addEventListener('abort', aborted, {once: true});
 });
}

export function releaseVideo(video) {
 video.pause();
 video.removeAttribute('src');
 video.load();
}

/** One decoder for each visible video, with a separate instance for export. */
export class VideoFrames {
 constructor(catalog) {
  this.catalog = catalog;
  this.sources = new Map();
  this.generation = 0;
 }

 has(id) {
  return Boolean(id && this.catalog.videos?.some(asset => asset.id === id));
 }

 retain(ids) {
  for (const [id, video] of this.sources) {
   if (ids.includes(id)) continue;
   releaseVideo(video);
   this.sources.delete(id);
  }
 }

 pause() {
  this.generation++;
  for (const video of this.sources.values()) video.pause();
 }

 async frame(id, elapsed, {loop = false, playing = false, signal} = {}) {
  if (!this.has(id)) throw new Error(t('视频素材不存在。'));
  const generation = this.generation;
  let video = this.sources.get(id);
  try {
   if (!video) {
    video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    video.src = videoUrl(id);
    this.sources.set(id, video);
   }
   await waitForMedia(video, 'loadeddata', () => video.readyState >= 2, signal);
   if (!Number.isFinite(video.duration) || !video.videoWidth || !video.videoHeight) {
    throw new Error(t('无法读取此视频，请检查编码格式或重新导入。'));
   }
   const at = Math.max(0, elapsed);
   const target = Math.min(loop ? at % video.duration : at, Math.max(0, video.duration - .001));
   video.loop = loop;
   const play = playing && generation === this.generation;
   if (!play) video.pause();
   if (Math.abs(video.currentTime - target) > (play && !video.paused ? .135 : .0005)) {
    video.currentTime = target;
   }
   await waitForMedia(video, 'seeked', () => !video.seeking && video.readyState >= 2, signal);
   if (play && generation === this.generation && video.paused && (loop || at < video.duration - .001)) {
    await video.play();
   }
   return video;
  } catch (error) {
   if (video && this.sources.get(id) === video) {
    releaseVideo(video);
    this.sources.delete(id);
   }
   throw error;
  }
 }

 dispose() {
  this.pause();
  this.retain([]);
 }
}
