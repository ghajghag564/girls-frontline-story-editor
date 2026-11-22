import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
/** Every read/write is restricted to a controlled relative name beneath this root. */
export class SafeDirectory {
 constructor(root){this.root=path.resolve(root);}
 async initialize(){
  await this.checkAncestors(this.root);
  await fs.mkdir(this.root,{recursive:true});
  await this.checkAncestors(this.root);
 }
 async checkAncestors(target){
  let current=target;
  while(true){
   try{const stat=await fs.lstat(current);if(stat.isSymbolicLink())throw new Error('不允许符号链接或目录联接');if(stat.isFile()&&stat.nlink>1)throw new Error('不允许硬链接文件');}
   catch(error){if(error.code!=='ENOENT')throw error;}
   const parent=path.dirname(current);if(parent===current)break;current=parent;
  }
 }
 async resolve(relative){
  if(typeof relative!=='string'||!relative||relative.includes('\\')||relative.includes(':')||path.isAbsolute(relative))throw new Error('文件路径无效');
  const parts=relative.split('/');
  if(parts.some(x=>!x||x==='.'||x==='..'||/[<>"|?*\x00-\x1f]/.test(x)||/[ .]$/.test(x)||/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(x)))throw new Error('文件路径无效');
  const target=path.join(this.root,...parts);
  if(!target.startsWith(this.root+path.sep))throw new Error('文件超出应用目录');
  await this.checkAncestors(target);
  return target;
 }
 async read(relative){return fs.readFile(await this.resolve(relative));}
 async atomicWrite(relative,bytes){
  const target=await this.resolve(relative);
  await fs.mkdir(path.dirname(target),{recursive:true});
  await this.resolve(relative);
  const tmp=await this.resolve(relative+'.'+randomUUID()+'.tmp');
  let handle;
  try{
   handle=await fs.open(tmp,'wx');await handle.writeFile(bytes);await handle.sync();await handle.close();handle=null;
   await this.resolve(relative);await fs.rename(tmp,target);
  }finally{
   await handle?.close();
   try{await fs.unlink(tmp);}catch(error){if(error.code!=='ENOENT')throw error;}
  }
 }
}
