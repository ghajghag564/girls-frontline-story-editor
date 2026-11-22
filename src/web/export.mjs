import {withProjectImages,cloneProject} from '/core/custom-images.mjs';
import {loadBackgroundImage} from '/image-import.mjs';
import {token} from '/bootstrap.mjs';
import {compileProject,validateExport} from '/core/timeline.mjs';
import {StageRenderer,loadStoryFonts} from '/core/stage.mjs';
import {ActorRenderer} from '/actors.mjs';
let current;
async function api(route,{method='GET',body}={}){const response=await fetch('/api'+route,{method,headers:{'x-gf2-token':token,'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});const result=await response.json();if(!response.ok)throw new Error(result.error??'导出请求失败');return result;}
export async function exportCapabilities(){return api('/capabilities');}
export async function cancelExport(){const control=current;if(!control)return;await api('/exports/'+control.id+'/cancel',{method:'POST'});control.abort.abort();}
export async function exportVideo(project,settings,onProgress){
 if(current)throw new Error('导出仍在进行中');
 const snapshot=cloneProject(project),compiled=compileProject(snapshot),capabilities=await exportCapabilities(),options=validateExport(settings,compiled.duration,capabilities.codecs);
 const job=await api('/exports',{method:'POST',body:{project:snapshot,settings:options}});const control={id:job.id,abort:new AbortController()};current=control;
 let renderer;
 try{
  let status=job;onProgress(status);
  while(status.state==='preparing'){control.abort.signal.throwIfAborted();await new Promise(r=>setTimeout(r,300));status=await api('/exports/'+job.id);onProgress(status);}
  if(status.state!=='rendering')throw new Error(status.error??'导出准备未完成');
 await loadStoryFonts();const canvas=document.createElement('canvas');canvas.width=options.width;canvas.height=options.height;const catalog=withProjectImages(await api('/catalog'),snapshot);renderer=new StageRenderer(canvas,{imageLoader:id=>loadBackgroundImage(catalog,id),actorRenderer:new ActorRenderer(catalog).draw});
  for(let index=0;index<options.frames;index++){
   control.abort.signal.throwIfAborted();await renderer.render(compiled,options.start+index/options.fps,{ratio:options.ratio,watermark:options.watermark});
   const pixels=renderer.context.getImageData(0,0,options.width,options.height).data;
   const response=await fetch(`/api/exports/${job.id}/frame/${index}`,{method:'POST',headers:{'x-gf2-token':token,'content-type':'application/octet-stream'},body:pixels,signal:control.abort.signal});status=await response.json();if(!response.ok)throw new Error(status.error??'视频帧传输失败');onProgress(status);
  }
  while(status.state==='encoding'){control.abort.signal.throwIfAborted();await new Promise(r=>setTimeout(r,500));status=await api('/exports/'+job.id);onProgress(status);}
  if(status.state!=='completed')throw new Error(status.error??'导出已取消');return status;
 }catch(error){
  await api('/exports/'+job.id+'/cancel',{method:'POST'}).catch(()=>{});
  // A deliberate cancel is a normal outcome, not a failure: mark it so the UI can differ.
  if(control.abort.signal.aborted){onProgress?.({state:'cancelled',completedFrames:0,frames:0,progress:0});const cancelled=new Error('导出已取消，未生成视频');cancelled.code='EXPORT_CANCELLED';throw cancelled;}
  throw error;
 }
 finally{renderer?.dispose();if(current===control)current=null;}
}
