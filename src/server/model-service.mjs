import {fork} from 'node:child_process';
import {fileURLToPath} from 'node:url';
/** Serial bounded IPC; the child holds all native pointers and can fail independently. */
export class ModelService {
 constructor(config,{timeoutMs=15000,maxPending=4}={}){this.config=config;this.timeoutMs=timeoutMs;this.maxPending=maxPending;this.pending=new Map();this.sequence=0;this.child=null;this.closed=false;}
 start(){
  if(this.closed)throw new Error('人物计算服务已关闭');if(this.child)return;
  const {materialsDirectory,workspaceDirectory,purism}=this.config;
  const child=fork(fileURLToPath(new URL('./model-worker.mjs',import.meta.url)),[materialsDirectory,JSON.stringify(purism)],{cwd:workspaceDirectory,execPath:process.execPath,execArgv:[],stdio:['ignore','ignore','pipe','ipc'],windowsHide:true});this.child=child;
  child.stderr.on('data',()=>{});
  child.on('message',reply=>{const entry=this.pending.get(reply.id);if(!entry||entry.child!==child)return;clearTimeout(entry.timer);this.pending.delete(reply.id);if(reply.error)entry.reject(new Error(reply.error));else entry.resolve(reply.result);});
  const fail=()=>{if(this.child===child)this.child=null;for(const [id,entry] of this.pending){if(entry.child!==child)continue;clearTimeout(entry.timer);this.pending.delete(id);entry.reject(new Error('人物计算进程已停止；工程仍可保存，请重试加载人物'));}};
  child.on('error',fail);child.on('exit',fail);
 }
 request(command,payload){
  if(this.closed)return Promise.reject(new Error('人物计算服务已关闭'));
  if(this.pending.size>=this.maxPending)return Promise.reject(new Error('人物计算队列已满，请稍后重试'));
  try{this.start();}catch(error){return Promise.reject(error);}
  const id=++this.sequence,child=this.child;
  return new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>{if(this.pending.has(id)){this.pending.delete(id);reject(new Error('人物计算超时'));child.kill();}},this.timeoutMs);
   this.pending.set(id,{resolve,reject,timer,child});
   child.send({id,command,...payload},error=>{if(error){const entry=this.pending.get(id);if(entry){clearTimeout(timer);this.pending.delete(id);reject(new Error('无法发送人物计算请求'));}}});
  });
 }
 describe(assetId){return this.request('describe',{assetId});}
 evaluate(instances){return this.request('evaluate',{instances});}
 async close(){
  this.closed=true;const child=this.child;this.child=null;
  for(const entry of this.pending.values()){clearTimeout(entry.timer);entry.reject(new Error('人物计算服务已关闭'));}this.pending.clear();
  if(child&&child.exitCode===null&&child.signalCode===null)await new Promise(resolve=>{child.once('exit',resolve);child.kill();});
 }
}
