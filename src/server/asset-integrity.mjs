import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {SafeDirectory} from './safe-files.mjs';
const hashPattern=/^[a-f0-9]{64}$/;
const fail=message=>Object.assign(new Error(message),{status:422,code:'ASSET_INTEGRITY'});
const stamp=s=>[s.dev,s.ino,s.size,s.mtimeNs,s.ctimeNs].join(':');
export class AssetIntegrity {
 constructor(root,{cacheBytes=64*1024*1024,maxFileBytes=64*1024*1024}={}){this.files=new SafeDirectory(root);this.limit=cacheBytes;this.maxFile=maxFileBytes;this.hashes=new Map();this.cache=new Map();this.used=0;this.active=0;this.waiters=[];}
 async initialize(){
  try{
   const file=await this.files.resolve('assets/asset-hashes.json');if((await fs.stat(file)).size>16*1024*1024)throw fail('素材校验清单过大');
   const data=JSON.parse(await fs.readFile(file,'utf8'));
   if(data.format!=='gf2-asset-hashes-v1'||!Array.isArray(data.files)||!data.files.length||data.files.length>20000)throw fail('素材校验清单无效');
   for(const r of data.files){if(!r||typeof r.path!=='string'||!r.path.startsWith('assets/')||!hashPattern.test(r.sha256)||!Number.isSafeInteger(r.bytes)||r.bytes<1||this.hashes.has(r.path))throw fail('素材校验条目无效');this.hashes.set(r.path,r);}
  }catch(error){
   if(error.code==='ENOENT')throw fail('找不到素材校验清单。请检查本地素材目录并参阅 docs/LOCAL_ASSETS.md。');
   throw error;
  }
 }
 async acquire(){
  if(this.active<2){this.active++;return;}
  if(this.waiters.length>=128)throw Object.assign(new Error('素材读取繁忙，请稍后重试'),{status:429});
  await new Promise(resolve=>this.waiters.push(resolve));
 }
 release(){const next=this.waiters.shift();if(next)next();else this.active--;}
 async read(relative,catalogHash){
  await this.acquire();let released=false;const release=()=>{if(!released){released=true;this.release();}};
  try{
   const record=this.hashes.get(relative),expected=catalogHash??record?.sha256;
   if(expected!==undefined&&!hashPattern.test(expected))throw fail('素材目录哈希无效：'+relative);
   if(record&&catalogHash&&record.sha256!==catalogHash)throw fail('素材目录与校验清单不一致：'+relative);
   if(!expected)throw fail('素材缺少校验值：'+relative);
   const filename=await this.files.resolve(relative),stat=await fs.stat(filename,{bigint:true});
   if(!stat.isFile()||stat.nlink!==1n||stat.size<1n||stat.size>BigInt(this.maxFile))throw fail('素材大小或文件类型无效：'+relative);
   if(record&&BigInt(record.bytes)!==stat.size)throw fail('素材内容已改变：'+relative);
   const key=relative+'|'+expected,previous=this.cache.get(key),fingerprint=stamp(stat);
   // Cache verified bytes, never a boolean authorizing a later unverified disk stream.
   if(previous?.stamp===fingerprint){this.cache.delete(key);this.cache.set(key,previous);return {bytes:previous.bytes,release};}
   if(previous){this.used-=previous.bytes.length;this.cache.delete(key);}
   const handle=await fs.open(filename,'r');let bytes;
   try{
    const before=await handle.stat({bigint:true});if(stamp(before)!==fingerprint||before.nlink!==1n)throw fail('素材读取期间发生变化：'+relative);
    const buffer=Buffer.alloc(Number(stat.size)+1);let size=0;
    while(size<buffer.length){const r=await handle.read(buffer,size,buffer.length-size,size);if(!r.bytesRead)break;size+=r.bytesRead;}
    const after=await handle.stat({bigint:true});await this.files.resolve(relative);
    if(size!==Number(stat.size)||stamp(after)!==fingerprint)throw fail('素材读取期间发生变化：'+relative);
    bytes=buffer.subarray(0,size);
   }finally{await handle.close();}
   if(createHash('sha256').update(bytes).digest('hex')!==expected)throw fail('素材内容校验失败，请恢复该素材：'+relative);
   if(bytes.length<=this.limit){
    while(this.used+bytes.length>this.limit&&this.cache.size){const oldest=this.cache.keys().next().value;this.used-=this.cache.get(oldest).bytes.length;this.cache.delete(oldest);}
    this.cache.set(key,{stamp:fingerprint,bytes});this.used+=bytes.length;
   }
   return {bytes,release};
  }catch(e){release();throw e;}
 }
}
