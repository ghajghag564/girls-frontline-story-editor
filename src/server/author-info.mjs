import fs from 'node:fs/promises';
import {SafeDirectory} from './safe-files.mjs';
// Attribution is editable metadata, never a source-authenticity or startup gate.
export async function readAuthorInfo(root){
 try{
  const files=new SafeDirectory(root),file=await files.resolve('branding/author.json');
  if((await fs.stat(file)).size>16384)throw new Error('署名文件过大');
  const input=JSON.parse(await fs.readFile(file,'utf8'));
  const valid=x=>x&&typeof x.name==='string'&&x.name.trim()&&x.name.length<=80&&!/[\x00-\x1f]/.test(x.name)&&typeof x.douyin==='string'&&/^[A-Za-z0-9_.-]{1,30}$/.test(x.douyin)&&typeof x.bilibiliUid==='string'&&/^\d{1,30}$/.test(x.bilibiliUid);
  const co=input?.coAuthors??[];if(!valid(input)||!Array.isArray(co)||co.length>8||!co.every(valid))throw new Error('署名格式无效');
  const pick=x=>({name:x.name,douyin:x.douyin,bilibiliUid:x.bilibiliUid});
  return {author:pick(input),coAuthors:co.map(pick),authorInfoMissing:false};
 }catch{return {author:null,coAuthors:[],authorInfoMissing:true};}
}
