import {verifyProjectImages} from './custom-images.mjs';
import {ExportEncoder} from './export-encoder.mjs';
import {fileDigest} from './file-hash.mjs';
import fs from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {randomUUID,createHash} from 'node:crypto';
import {SafeDirectory} from './safe-files.mjs';
import {validateProject,missingResources} from '../core/project.mjs';
import {compileProject,validateExport} from '../core/timeline.mjs';
import {mixRange} from '../core/audio-mixer.mjs';
import {exportSpacePlan,checkExportSpace,relevantVoices,pcmPath} from './export-space.mjs';
const ACTIVE=new Set(['preparing','rendering','encoding']);
const MAX_JOBS=24;
export class ExportService {
 constructor(config,catalog){
  this.files=new SafeDirectory(config.workspaceDirectory);
  this.materials=new SafeDirectory(config.materialsDirectory);
  this.catalog=catalog;this.jobs=new Map();
  this.encoders=new ExportEncoder(config);
 }
 get codecs(){return this.encoders.capabilities.codecs;}
 async initialize(){
  await this.restoreHistory();
  await this.encoders.initialize();
 }
 async restoreHistory(){
  const directory=await this.files.resolve('userdata/exports');let entries;
  try{entries=await fs.readdir(directory,{withFileTypes:true});}catch(error){if(error.code==='ENOENT')return;throw error;}
  for(const entry of entries){
   if(!entry.isDirectory()||!/^[a-f0-9-]+$/.test(entry.name))continue;
   try{
    const saved=JSON.parse(await this.files.read(`userdata/exports/${entry.name}/job.json`));
    if(saved.id!==entry.name||!saved.settings||!Number.isSafeInteger(saved.settings.frames)||saved.settings.frames<1||!Number.isSafeInteger(saved.completedFrames))continue;
    const job={...saved,output:`exports/${saved.id}.mp4`};
    if(job.state==='completed'){
     const stat=await fs.stat(await this.files.resolve(job.output));if(!stat.isFile()||stat.size<100)continue;
    }else if(ACTIVE.has(job.state)){
     job.state='failed';job.error='上次导出被中断，请重新导出。';await this.saveStatus(job);
    }else if(!['cancelled','failed'].includes(job.state))continue;
    await this.cleanupTemporary(job);this.jobs.set(job.id,job);
   }catch(error){if(error.code!=='ENOENT')console.warn('无法恢复导出记录：'+entry.name);}
  }
  this.prune();
 }
 // Only recent job statuses are kept in memory.
 prune(){for(const [id,job] of this.jobs){if(this.jobs.size<=MAX_JOBS)break;if(!ACTIVE.has(job.state))this.jobs.delete(id);}}
 status(job){return {id:job.id,state:job.state,frames:job.settings.frames,completedFrames:job.completedFrames,settings:job.settings,progress:job.completedFrames/job.settings.frames,error:job.error??null,output:job.state==='completed'?job.output:null,hasMusic:job.hasMusic,backend:job.backend??null,createdAt:job.createdAt,spacePlan:job.spacePlan,cleanupWarning:job.cleanupWarning};}
 get(id){const job=this.jobs.get(id);if(!job)throw new Error('导出任务不存在');return job;}
 async saveStatus(job){await this.files.atomicWrite(`userdata/exports/${job.id}/job.json`,JSON.stringify({...this.status(job),frameHashes:job.frameHashes},null,2));}
 async create(input,settings){
  if([...this.jobs.values()].some(j=>ACTIVE.has(j.state)))throw new Error('已有导出任务，请等待完成或取消');
  if(!this.codecs.length)throw new Error('没有可用的视频编码器');
  const project=verifyProjectImages(validateProject(input)),compiled=compileProject(project,{budgetChecked:true}),options=validateExport(settings,compiled.duration,this.codecs),missing=missingResources(project,this.catalog);
  if(missing.length)throw new Error(`工程缺少 ${missing.length} 项素材，无法导出`);
  const job={id:randomUUID(),settings:options,state:'preparing',completedFrames:0,frameBusy:false,frameHashes:[],createdAt:new Date().toISOString(),abort:new AbortController(),hasMusic:compiled.voices.some(v=>v.start<options.end&&(v.stopAt===null||v.stopAt+v.fadeOut>options.start))};
  this.jobs.set(job.id,job);this.prune();
  try{await this.saveStatus(job);}catch(error){this.jobs.delete(job.id);job.abort.abort();throw error;}
  job.preparation=this.prepare(job,compiled).catch(error=>this.fail(job,error)).finally(async()=>{if(!ACTIVE.has(job.state)&&!job.encoder)await this.cleanupTemporary(job);});return this.status(job);
 }
 async prepare(job,compiled){
  const s=job.settings,jobBase=`userdata/exports/${job.id}`;
  job.spacePlan=await checkExportSpace(this.files,await exportSpacePlan(this.files,compiled,s,this.catalog));await this.saveStatus(job);
  const signal=job.abort.signal;
  const probe=await this.files.resolve(jobBase+'/encoder-probe.mp4');
  const backend=await this.encoders.choose(s,job.hasMusic,probe,signal);
  job.backend=backend.id;
  let mixed;
  if(job.hasMusic){
   const relevant=relevantVoices(compiled,s);const assets=Object.fromEntries(this.catalog.music.map(a=>[a.id,a]));const handles=new Map();
   try{
    for(const id of new Set(relevant.map(v=>v.assetId))){
     job.abort.signal.throwIfAborted();const asset=assets[id];
     const source=asset&&await this.materials.resolve('assets/'+asset.path);
     if(!asset||!/^[a-f0-9]{64}$/.test(asset.sha256)||await fileDigest(source)!==asset.sha256)throw new Error('本地 BGM 与素材目录的 SHA-256 不符');
     const pcm=pcmPath(asset),target=await this.files.resolve(pcm);let ready=false;
     try{
      const cached=await fs.stat(target);ready=cached.isFile()&&cached.size===asset.samples*8;
     }catch(error){if(error.code!=='ENOENT')throw error;}
     if(!ready){
      await fs.mkdir(await this.files.resolve('userdata/audio-cache'),{recursive:true});const part=await this.files.resolve(pcm+'.'+job.id+'.part');
      try{
       await this.encoders.decode(backend,source,part,signal);
       if((await fs.stat(part)).size!==asset.samples*8)throw new Error('BGM 解码后的采样数量不匹配');
       await this.files.resolve(pcm);await fs.rename(part,target);
      }finally{await fs.unlink(part).catch(error=>{if(error.code!=='ENOENT')throw error;});}
     }
     handles.set(id,await fs.open(target,'r'));
    }
    mixed=await this.files.resolve(jobBase+'/music.f32');const out=await fs.open(mixed,'w');
    try{
     const read=async(id,start,count)=>{const buffer=Buffer.alloc(count*8);const handle=handles.get(id);if(!handle)throw new Error('音乐样本未准备');const result=await handle.read(buffer,0,buffer.length,start*8);if(result.bytesRead!==buffer.length)throw new Error('音乐数据不完整');return new Float32Array(buffer.buffer,buffer.byteOffset,count*2);};
     for await(const block of mixRange(compiled,assets,s.start,s.end,read,{signal:job.abort.signal})){await out.write(Buffer.from(block.buffer,block.byteOffset,block.byteLength));}
     await out.sync();
    }finally{await out.close();}
   }finally{await Promise.all([...handles.values()].map(h=>h.close()));}
  }
  job.abort.signal.throwIfAborted();
  job.output=`exports/${job.id}.mp4`;job.partial=jobBase+'/video.partial.mp4';
  const output=await this.files.resolve(job.partial);
  const {executable,args}=await this.encoders.command(backend,s,output,mixed,signal);
  signal.throwIfAborted();
  job.encoder=spawn(executable,args,{cwd:this.files.root,windowsHide:true,stdio:['pipe','ignore','pipe']});job.stderr='';
  job.encoder.stderr.on('data',chunk=>{job.stderr=(job.stderr+chunk).slice(-32000);});
  job.encoder.stdin.on('error',error=>{if(ACTIVE.has(job.state))void this.fail(job,error);});
  job.encoder.on('error',error=>this.fail(job,error));job.encoderClosed=new Promise(resolve=>job.encoder.on('close',async code=>{try{await this.finish(job,code);}catch(error){await this.fail(job,error);await this.cleanupTemporary(job);}finally{resolve();}}));
  job.state='rendering';job.lastFrameAt=Date.now();job.watchdog=setInterval(()=>{if(job.state==='rendering'&&!job.frameBusy&&Date.now()-job.lastFrameAt>120000)this.fail(job,new Error('超过两分钟未收到渲染帧，浏览器可能已经关闭，请重试'));},10000);job.watchdog.unref();await this.saveStatus(job);
 }
 async frame(id,index,request){
  const job=this.get(id),s=job.settings;
  if(job.state!=='rendering'||job.frameBusy||index!==job.completedFrames)throw new Error('渲染帧顺序或任务状态无效');
  const size=s.width*s.height*4;if(Number(request.headers['content-length'])!==size)throw new Error('渲染帧尺寸不匹配');
  job.frameBusy=true;let received=0;
  // Only the first and last frame digests are recorded in the export history.
  const hash=index===0||index===s.frames-1?createHash('sha256'):null;
  const deadline=setTimeout(()=>{const error=new Error('渲染帧传输超时，请重试');request.destroy(error);void this.fail(job,error);},120000);deadline.unref();
  try{
   for await(const chunk of request){job.abort.signal.throwIfAborted();received+=chunk.length;if(received>size)throw new Error('渲染帧过大');hash?.update(chunk);await new Promise((resolve,reject)=>job.encoder.stdin.write(chunk,error=>error?reject(error):resolve()));}
   if(received!==size)throw new Error('渲染帧传输中断');
   if(hash)job.frameHashes.push({index,time:s.start+index/s.fps,sha256:hash.digest('hex')});
   job.completedFrames++;job.lastFrameAt=Date.now();
   if(job.completedFrames===s.frames){job.state='encoding';clearInterval(job.watchdog);job.encoder.stdin.end();}
   if(job.completedFrames%30===0||job.state==='encoding')await this.saveStatus(job);
   return this.status(job);
  }catch(error){await this.fail(job,error);throw error;}finally{clearTimeout(deadline);job.frameBusy=false;}
 }
 async finish(job,code){
  clearInterval(job.watchdog);if(!ACTIVE.has(job.state)){await this.cleanupTemporary(job);return;}
  if(code!==0||job.completedFrames!==job.settings.frames)throw new Error('视频编码未完成：'+job.stderr.slice(-1800));
  const source=await this.files.resolve(job.partial),target=await this.files.resolve(job.output);const stat=await fs.stat(source);if(stat.size<100)throw new Error('编码器没有生成有效视频');
  await fs.mkdir(await this.files.resolve('exports'),{recursive:true});await fs.rename(source,target);job.state='completed';job.bytes=stat.size;await this.cleanupTemporary(job);await this.saveStatus(job);
 }
 async cleanupTemporary(job){
  if(!/^[a-f0-9-]+$/.test(job.id))throw new Error('导出任务编号无效');
  for(const name of ['music.f32','video.partial.mp4','encoder-probe.mp4'])try{await fs.unlink(await this.files.resolve(`userdata/exports/${job.id}/${name}`));}catch(error){if(error.code!=='ENOENT'){job.cleanupWarning='部分导出临时文件未能清理，请检查文件是否被其他程序占用。';console.warn(job.cleanupWarning);}}
 }
 async fail(job,error){
  if(!ACTIVE.has(job.state))return;job.state='failed';job.error=error.code==='ENOSPC'&&!error.message.includes('预计需要')?'磁盘空间已用尽，导出未完成。请腾出空间后重试。':error.message;job.abort.abort();clearInterval(job.watchdog);job.encoder?.kill();try{await this.saveStatus(job);}catch{job.error+='；任务记录写入失败，请检查磁盘空间';}
 }
 async cancel(id){const job=this.get(id);if(!ACTIVE.has(job.state))return this.status(job);job.state='cancelled';job.abort.abort();clearInterval(job.watchdog);job.encoder?.kill();await this.saveStatus(job);await job.preparation;await job.encoderClosed;return this.status(job);}
 async close(){for(const job of this.jobs.values())if(ACTIVE.has(job.state))await this.cancel(job.id);}
}
