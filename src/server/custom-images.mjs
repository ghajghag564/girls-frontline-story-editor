import {createHash} from 'node:crypto';
import {inflateSync} from 'node:zlib';
import {validateCustomImages,imageHeader} from '../core/custom-images.mjs';
const valid=new Set();
const crcTable=Uint32Array.from({length:256},(_,n)=>{for(let i=0;i<8;i++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
const crc=bytes=>{let n=0xffffffff;for(const b of bytes)n=crcTable[(n^b)&255]^(n>>>8);return (n^0xffffffff)>>>0;};
export function verifyProjectImages(project){
 validateCustomImages(project.customImages);
 for(const item of project.customImages??[]){
  const raw=Buffer.from(item.dataUrl.slice(22),'base64'),hash=createHash('sha256').update(raw).digest('hex');
  if(item.id!==`custom_${item.kind}_${hash}`)throw new Error('自定义图片内容校验失败');
  const header=imageHeader(raw);if(header.format!=='png'||header.width!==item.width||header.height!==item.height)throw new Error('自定义图片实际尺寸不匹配');
  if(valid.has(hash))continue;
  let pos=8,ended=false,ihdr=false,afterData=false,dataStarted=false,channels;const compressed=[];
  while(pos+12<=raw.length){
   const size=raw.readUInt32BE(pos),end=pos+12+size;if(end>raw.length)throw new Error('自定义 PNG 文件不完整');
   const type=raw.toString('ascii',pos+4,pos+8),data=raw.subarray(pos+8,pos+8+size);
   if(crc(raw.subarray(pos+4,pos+8+size))!==raw.readUInt32BE(pos+8+size))throw new Error('自定义 PNG 文件校验失败');
   if(!ihdr&&type!=='IHDR')throw new Error('PNG 缺少文件头');
   if(type==='IHDR'){
    if(ihdr||size!==13||data[8]!==8||![2,6].includes(data[9])||data[10]||data[11]||data[12])throw new Error('工程 PNG 编码不受支持，请使用软件的导入图片功能');
    ihdr=true;channels=data[9]===6?4:3;
   }else if(type==='IDAT'){if(afterData)throw new Error('PNG 数据块顺序无效');dataStarted=true;compressed.push(data);}
   else if(type==='IEND'){if(size||!dataStarted||end!==raw.length)throw new Error('PNG 结束位置无效');ended=true;break;}
   else {if(!['sRGB','gAMA','cHRM','pHYs'].includes(type)||size>64)throw new Error('工程 PNG 含不受支持的数据块，请重新导入图片');if(dataStarted)afterData=true;}
   pos=end;
  }
  if(!ended)throw new Error('PNG 缺少结束数据');
  const stride=item.width*channels+1,expected=stride*item.height;
  let pixels;try{pixels=inflateSync(Buffer.concat(compressed),{maxOutputLength:expected});}catch{throw new Error('PNG 像素数据损坏或超过尺寸上限');}
  if(pixels.length!==expected)throw new Error('PNG 像素长度不匹配');
  for(let y=0;y<item.height;y++)if(pixels[y*stride]>4)throw new Error('PNG 行过滤方式无效');
  valid.add(hash);if(valid.size>256)valid.delete(valid.values().next().value);
 }
 return project;
}
