import fs from 'node:fs/promises';
export const relevantVoices=(compiled,settings)=>compiled.voices.filter(v=>v.start<settings.end&&(v.stopAt===null||v.stopAt+v.fadeOut>settings.start));
export const pcmPath=asset=>`userdata/audio-cache/${asset.id}-${asset.sha256.slice(0,16)}.f32`;
const display=bytes=>(bytes/1024**3).toFixed(2)+' GB';
/** Count full uncached source tracks, not just the selected export interval. */
export async function exportSpacePlan(files,compiled,settings,catalog){
 const relevant=relevantVoices(compiled,settings),assets=new Map(catalog.music.map(a=>[a.id,a]));let sourceCacheBytes=0;
 for(const id of new Set(relevant.map(v=>v.assetId))){
  const asset=assets.get(id);if(!asset)throw new Error('缺少背景音乐');
  const bytes=asset.samples*8;if(!Number.isSafeInteger(bytes)||bytes<=0)throw new Error('音乐采样数量无效');
  let ready=false;try{const stat=await fs.stat(await files.resolve(pcmPath(asset)));ready=stat.isFile()&&stat.size===bytes;}catch(error){if(error.code!=='ENOENT')throw error;}
  if(!ready)sourceCacheBytes+=bytes;
 }
 const mixedAudioBytes=relevant.length?Math.ceil((settings.end-settings.start)*48000-1e-7)*8:0;
 const videoBytes=Math.ceil(settings.estimatedBytes),reserveBytes=Math.max(128*1024**2,Math.ceil(videoBytes*.1));
 return {sourceCacheBytes,mixedAudioBytes,videoBytes,reserveBytes,requiredBytes:sourceCacheBytes+mixedAudioBytes+videoBytes+reserveBytes};
}
export async function checkExportSpace(files,plan,{statfs=fs.statfs}={}){
 let disk;try{disk=await statfs(files.root);}catch(error){throw new Error('无法检查导出目录的剩余空间，请检查磁盘是否可用。',{cause:error});}
 const availableBytes=Number(disk.bavail)*Number(disk.bsize);
 if(!Number.isFinite(availableBytes)||availableBytes<0)throw new Error('无法读取有效的磁盘剩余空间');
 if(availableBytes<plan.requiredBytes){const error=new Error(`磁盘空间不足：预计需要 ${display(plan.requiredBytes)}，当前可用 ${display(availableBytes)}。其中新建音乐缓存 ${display(plan.sourceCacheBytes)}、临时混音 ${display(plan.mixedAudioBytes)}。请腾出空间后重试。`);error.code='ENOSPC';throw error;}
 return {...plan,availableBytes};
}
