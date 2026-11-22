import {IMAGE_LIMITS} from '../core/custom-images.mjs';
import {verifyProjectImages} from './custom-images.mjs';
import fs from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {SafeDirectory} from './safe-files.mjs';
import {validateProject} from '../core/project.mjs';
const projectIdPattern=/^\w{8}-\w{4}-\w{4}-\w{4}-\w{12}$/;
const validId=id=>{if(typeof id!=='string'||!projectIdPattern.test(id))throw new Error('工程编号无效');return id;};
const recoveryMarker='.deleting-recovery.json';
async function unlinkOptional(file){
 try{await fs.unlink(file);}
 catch(error){if(error.code!=='ENOENT')throw error;}
}
export class ProjectStore {
 constructor(root){this.files=new SafeDirectory(root);this.pending=new Map();}
 async initialize(){
  await this.files.initialize();
  // A crash before the saved file is unlinked leaves its recovery draft restorable.
  for(const name of await fs.readdir(this.files.root)){
   if(!name.endsWith(recoveryMarker))continue;
   const id=name.slice(0,-recoveryMarker.length);
   if(!projectIdPattern.test(id))continue;
   await this.finishDeletion(id);
  }
 }
 async finishDeletion(id){
  const marker=await this.files.resolve(id+recoveryMarker);
  try{await fs.access(await this.files.resolve(id+'.gf2story.json'));}
  catch(error){
   if(error.code!=='ENOENT')throw error;
   try{await unlinkOptional(marker);}
   catch(cleanup){if(!['EPERM','EBUSY','EACCES'].includes(cleanup.code))throw cleanup;}
   return;
  }
  const draft=await this.files.resolve(id+'.recovery.json');
  try{await fs.access(draft);}
  catch(error){if(error.code!=='ENOENT')throw error;await fs.rename(marker,draft);return;}
  // Another recovery may already have been written after a failed rollback.
  // Preserve the newer live file and discard the older staged copy.
  await unlinkOptional(marker);
 }
 async recoveryToken(id){
  const file=await this.files.resolve(id+'.recovery.json');
  try{
   const info=await fs.stat(file,{bigint:true});
   // Each autosave replaces the file atomically, including same-revision writes.
   return [info.ino,info.ctimeNs,info.mtimeNs,info.size].join(':');
  }catch(error){if(error.code==='ENOENT')return null;throw error;}
 }
 async serial(id,action){
  id=id.toLowerCase();
  const before=this.pending.get(id)??Promise.resolve();
  const next=before.catch(()=>{}).then(action);this.pending.set(id,next);
  try{return await next;}finally{if(this.pending.get(id)===next)this.pending.delete(id);}
 }
 async readRecord(name){const file=await this.files.resolve(name);if((await fs.stat(file)).size>IMAGE_LIMITS.projectBytes+4096)throw new Error('工程记录超过48 MB预算');const bytes=await this.files.read(name);if(bytes.length>IMAGE_LIMITS.projectBytes+4096)throw new Error('工程记录超过48 MB预算');return JSON.parse(bytes);}
 async list(){
  const result=[];
  for(const name of await fs.readdir(this.files.root)){
   if(!name.endsWith('.gf2story.json'))continue;
   const id=name.slice(0,-14);
   // A damaged or foreign record must not break the whole list: skip it instead.
   try{
    validId(id);
    const row=await this.serial(id,async()=>{
     const record=await this.readRecord(name);
     if(!record||typeof record.savedAt!=='string'||typeof record.project?.title!=='string')return null;
     return {id,title:record.project.title,savedAt:record.savedAt,revision:record.revision,recoveryToken:await this.recoveryToken(id)};
    });
    if(row)result.push(row);
   }catch{}
  }
  return result.sort((a,b)=>b.savedAt.localeCompare(a.savedAt));
 }
 async open(id,{recovery=false}={}){
  validId(id);const suffix=recovery?'.recovery.json':'.gf2story.json';
  const record=await this.readRecord(id+suffix);record.project=verifyProjectImages(validateProject(record.project));return record;
 }
 async create(project){
  const id=randomUUID();const result=await this.save(id,project,{create:true});return {id,...result};
 }
 async save(id,input,{create=false,recovery=false,expectedRevision}={}){
  validId(id);const project=verifyProjectImages(validateProject(input));
  return this.serial(id,async()=>{
   let current;
   try{current=await this.open(id);}catch(error){if(error.code!=='ENOENT'||!create)throw error;}
   if(create&&current)throw new Error('工程已经存在');
   if(expectedRevision!==undefined&&expectedRevision!==(current?.revision??0)){const error=new Error('工程已被另一窗口修改，请重新打开或另存');error.code='CONFLICT';throw error;}
   const record={format:'gf2story-storage',revision:(current?.revision??0)+(recovery?0:1),savedAt:new Date().toISOString(),project};
   await this.files.atomicWrite(id+(recovery?'.recovery.json':'.gf2story.json'),JSON.stringify(record,null,2));
   return record;
  });
 }
 async delete(id,{expectedRevision,expectedRecovery}={}){
  validId(id);
  if(!Number.isSafeInteger(expectedRevision)||expectedRevision<1||
     (expectedRecovery!==null&&typeof expectedRecovery!=='string'))throw new Error('请刷新工程列表再确认删除');
  return this.serial(id,async()=>{
   const saved=await this.readRecord(id+'.gf2story.json');
   const token=await this.recoveryToken(id);
   if(saved.revision!==expectedRevision||token!==expectedRecovery){
    const error=new Error('工程或自动恢复副本已更新，请重新确认删除');error.code='CONFLICT';throw error;
   }
   const savedPath=await this.files.resolve(id+'.gf2story.json');
   if(token===null){await fs.unlink(savedPath);return {deleted:true};}
   // The saved file is the commit point. Stage the draft first, so a failed
   // unlink can restore it and a restart can finish either side of the commit.
   const draft=await this.files.resolve(id+'.recovery.json');
   const marker=await this.files.resolve(id+recoveryMarker);
   await fs.rename(draft,marker);
   try{await fs.unlink(savedPath);}
   catch(error){await fs.rename(marker,draft);throw error;}
   try{await fs.unlink(marker);}
   catch(error){
    if(error.code!=='ENOENT')return {deleted:true,cleanupPending:true};
   }
   return {deleted:true};
  });
 }
 async openWithRecovery(id){
  validId(id);
  return this.serial(id,async()=>{
   const saved=await this.open(id);
   return {...saved,recovery:await this.recovery(id,saved)};
  });
 }
 async recovery(id,saved){
  saved??=await this.open(id);
  let recovered;
  // The draft is optional: a damaged or unreadable one must not block opening the saved project.
  try{recovered=await this.open(id,{recovery:true});}catch{return null;}
  return recovered.revision===saved.revision&&JSON.stringify(recovered.project)!==JSON.stringify(saved.project)?recovered:null;
 }
}
