import {token} from '/bootstrap.mjs';
import {VIDEO_LIMITS, matchesVideoContainer, validVideoMetadata, videoTypes, videoUrl} from '/core/video.mjs';
import {t, translateMessage} from './i18n.mjs';
import {releaseVideo, waitForMedia} from './video-frames.mjs';
import {decodeLocalAudio, uploadLocalAudio} from './audio-import.mjs';

async function uploadVideo(info, file) {
 const response = await fetch('/api/local-video', {
  method: 'POST',
  headers: {
   'x-gf2-token': token, 'content-type': videoTypes[info.format],
   'x-gf2-video-info': encodeURIComponent(JSON.stringify(info)),
  },
  body: file,
 });
 const result = await response.json();
 if (!response.ok) throw new Error(result.error ?? t('视频导入失败。'));
 return result;
}

export function setupVideoLibrary({getVideos, onPause, onImport, onAudio}) {
 const get = id => document.getElementById(id);
 const dialog = get('video-library-dialog'), list = get('video-library-list'), title = get('video-library-title');
 const search = get('video-library-search'), input = get('video-library-file');
 const chooseFile = get('choose-video-library-file'), fileName = get('video-library-file-name');
 const preview = get('video-library-preview'), status = get('video-library-status');
 const close = get('close-video-library'), confirm = get('apply-library-video');
 let mode, apply, selection, previewWork, objectUrl, saving = false;

 function renderCopy() {
  title.textContent = t(mode === 'background' ? '选择视频背景' : '选择过场视频');
  confirm.textContent = t(mode === 'background' ? '用作背景' : '应用过场视频');
  fileName.textContent = input.files[0]?.name ?? t('未选择文件');
 }

 function updateControls() {
  search.disabled = input.disabled = chooseFile.disabled = close.disabled = saving;
  confirm.disabled = saving || !selection?.ready;
  for (const row of list.querySelectorAll('button')) row.disabled = saving;
 }

 function clearPreview() {
  previewWork?.abort();
  previewWork = null;
  releaseVideo(preview);
  preview.hidden = true;
  if (objectUrl) URL.revokeObjectURL(objectUrl);
  objectUrl = null;
  selection = null;
  updateControls();
 }

 function renderList() {
  const query = search.value.trim().toLocaleLowerCase();
  const videos = getVideos();
  search.hidden = !videos.length;
  const fragment = document.createDocumentFragment();
  for (const video of videos) {
   if (query && !video.name.toLocaleLowerCase().includes(query) && !video.id.includes(query)) continue;
   const row = document.createElement('button');
   row.type = 'button';
   row.className = 'video-library-row';
   row.setAttribute('aria-pressed', String(selection?.asset?.id === video.id));
   const label = document.createElement('strong');
   label.textContent = video.name;
   const info = document.createElement('small');
   info.textContent = t('{0} 秒', video.seconds.toFixed(1));
   row.append(label, info);
   row.onclick = () => { input.value = ''; renderCopy(); void choose({asset: video}); };
   fragment.append(row);
  }
  if (!fragment.childNodes.length) {
   const empty = document.createElement('p');
   empty.className = 'muted';
   empty.textContent = t(videos.length ? '没有匹配的视频。' : '尚未导入视频。');
   fragment.append(empty);
  }
  list.replaceChildren(fragment);
  updateControls();
 }

 async function choose(candidate) {
  if (saving) return;
  clearPreview();
  const work = new AbortController();
  previewWork = work;
  selection = candidate;
  renderList();
  status.textContent = t('正在读取视频…');
  try {
   let source;
   if (candidate.file) {
    const file = candidate.file;
    const format = file.name.toLowerCase().match(/\.(mp4|webm)$/)?.[1];
    if (!format) throw new Error(t('请选择 MP4 或 WebM 视频。'));
    if (file.size > VIDEO_LIMITS.maxBytes) throw new Error(t('视频文件不得超过 128 MiB。'));
    const header = new Uint8Array(await file.slice(0, 16).arrayBuffer());
    if (work.signal.aborted) return;
    if (!matchesVideoContainer(header, format)) throw new Error(t('文件内容与所选视频格式不一致。'));
    candidate.info = {
     format,
     name: file.name.replace(/\.[^.]+$/, '').replace(/[\x00-\x1f\x7f]/g, '').trim().slice(0, 100).toWellFormed() || t('本地视频'),
    };
    source = objectUrl = URL.createObjectURL(file);
   } else source = videoUrl(candidate.asset.id);
   preview.src = source;
   await waitForMedia(preview, 'loadeddata', () => preview.readyState >= 2, work.signal);
   if (work.signal.aborted) return;
   const metadata = {width: preview.videoWidth, height: preview.videoHeight, seconds: preview.duration};
   if (!validVideoMetadata(metadata)) throw new Error(t('视频格式、分辨率或时长超出范围。'));
   if (candidate.info) Object.assign(candidate.info, metadata);
   candidate.ready = true;
   preview.hidden = false;
   status.textContent = t('{0} × {1} · {2} 秒', metadata.width, metadata.height, metadata.seconds.toFixed(1));
  } catch (error) {
   if (!work.signal.aborted) status.textContent = translateMessage(error.message);
  } finally {
   if (previewWork === work) updateControls();
  }
 }

 search.oninput = renderList;
 chooseFile.onclick = () => input.click();
 input.onchange = () => {
  renderCopy();
  if (input.files[0]) void choose({file: input.files[0]});
 };
 close.onclick = () => dialog.close();
 dialog.addEventListener('cancel', event => { if (saving) event.preventDefault(); });
 dialog.addEventListener('close', () => { input.value = ''; clearPreview(); });
 confirm.onclick = async () => {
  if (!selection?.ready || saving) return;
  saving = true;
  updateControls();
  preview.pause();
  const selected = selection;
  try {
   let asset = selected.asset;
   if (!asset) {
    status.textContent = t('正在保存到本地素材库…');
    const sound = await decodeLocalAudio(selected.file).catch(() => null);
    const track = sound && await uploadLocalAudio(selected.info.name, sound.wave, {videoOnly: true});
    if (track) onAudio(track);
    asset = await uploadVideo({...selected.info, audioId: track?.id}, selected.file);
    onImport(asset);
   }
   apply(asset);
   dialog.close();
  } catch (error) {
   status.textContent = translateMessage(error.message);
  } finally {
   saving = false;
   updateControls();
  }
 };

 return {
  open({purpose, selectedId, onUse}) {
   onPause();
   clearPreview();
   mode = purpose;
   apply = onUse;
   search.value = input.value = '';
   renderCopy();
   preview.muted = mode === 'background';
   status.textContent = '';
   renderList();
   dialog.showModal();
   const previous = getVideos().find(asset => asset.id === selectedId);
   if (previous) void choose({asset: previous});
  },
  refresh() { if (dialog.open) { renderCopy(); renderList(); } },
 };
}
