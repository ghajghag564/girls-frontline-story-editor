export const VIDEO_LIMITS = Object.freeze({
 maxBytes: 128 * 1024 ** 2,
 maxSeconds: 600,
 maxDimension: 4096,
 maxPixels: 4096 * 2160,
 chunkBytes: 1024 ** 2,
});

export const videoTypes = Object.freeze({mp4: 'video/mp4', webm: 'video/webm'});
export const videoUrl = id => '/assets/video/' + encodeURIComponent(id) + '/full';
export const isVideoId = value => typeof value === 'string' && /^video_[a-z0-9_]{1,94}$/.test(value);
export const isLocalVideoId = value => typeof value === 'string' && /^video_local_[a-f0-9]{64}$/.test(value);

export function validVideoMetadata({width, height, seconds} = {}) {
 return [width, height].every(n => Number.isInteger(n) && n >= 1 && n <= VIDEO_LIMITS.maxDimension) &&
  width * height <= VIDEO_LIMITS.maxPixels && Number.isFinite(seconds) && seconds > 0 && seconds <= VIDEO_LIMITS.maxSeconds;
}

export function cutsceneVideo(value) {
 if (!value || !isVideoId(value.assetId) || !Number.isFinite(value.seconds) ||
     value.seconds <= 0 || value.seconds > VIDEO_LIMITS.maxSeconds ||
     (value.audioId !== undefined && (typeof value.audioId !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(value.audioId)))) {
  throw new Error('过场视频引用无效。');
 }
 return value;
}

export function matchesVideoContainer(bytes, format) {
 if (format === 'mp4') {
  if (bytes.length < 16 || bytes[4] !== 0x66 || bytes[5] !== 0x74 || bytes[6] !== 0x79 || bytes[7] !== 0x70) return false;
  const firstBoxSize = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0);
  return firstBoxSize >= 16;
 }
 return format === 'webm' && bytes.length >= 4 && bytes[0] === 0x1a && bytes[1] === 0x45 &&
  bytes[2] === 0xdf && bytes[3] === 0xa3;
}
