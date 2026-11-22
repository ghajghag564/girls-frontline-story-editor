export const IMAGE_LIMITS=Object.freeze({inputBytes:20*1024*1024,imageBytes:8*1024*1024,totalBytes:32*1024*1024,projectBytes:48*1024*1024,maxImages:128,totalPixels:32000000,totalDecodedBytes:120*1024*1024,maxDimension:4096,inputDimension:8192,inputPixels:32000000});
const fail=message=>{throw new Error(message);};
const pngMagic=[137,80,78,71,13,10,26,10];
export function imageHeader(bytes){
 if(bytes.length>=33&&pngMagic.every((v,i)=>bytes[i]===v)){
  const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  if(v.getUint32(8)!==13||String.fromCharCode(...bytes.subarray(12,16))!=='IHDR')fail('PNG 文件头无效');
  return {format:'png',width:v.getUint32(16),height:v.getUint32(20)};
 }
 if(bytes[0]===255&&bytes[1]===216){
  let pos=2;
  while(pos+4<=bytes.length){
   if(bytes[pos++]!==255)fail('JPG 文件结构无效');while(bytes[pos]===255)pos++;const marker=bytes[pos++];
   if(marker===217||marker===218)break;if(marker===1||(marker>=208&&marker<=215))continue;
   const length=(bytes[pos]<<8)|bytes[pos+1];if(length<2||pos+length>bytes.length)fail('JPG 文件不完整');
   if([192,193,194].includes(marker)){if(length<8)fail('JPG 尺寸无效');return {format:'jpg',width:(bytes[pos+5]<<8)|bytes[pos+6],height:(bytes[pos+3]<<8)|bytes[pos+4]};}pos+=length;
  }
 }
 fail('图片内容不是受支持的 JPG 或 PNG');
}
export function inspectImageInput(bytes,filename){
 const extension=String(filename).toLowerCase().match(/\.(jpg|png)$/)?.[1];if(!extension)fail('仅支持 .jpg 和 .png 图片');
 if(!bytes.length||bytes.length>IMAGE_LIMITS.inputBytes)fail('单张导入图片不得超过 20 MB');
 const header=imageHeader(bytes);if(header.format!==extension)fail('图片扩展名与实际格式不一致');
 if(header.width<1||header.height<1||header.width>IMAGE_LIMITS.inputDimension||header.height>IMAGE_LIMITS.inputDimension||header.width*header.height>IMAGE_LIMITS.inputPixels)fail('原图过大：每边不超过8192像素，总像素不超过3200万');
 return header;
}
export function validateCustomImages(images=[]){
 if(!Array.isArray(images)||images.length>IMAGE_LIMITS.maxImages)fail('工程自定义图片数量超出范围');
 let total=0,pixels=0,decoded=0;const ids=new Set();
 for(const item of images){
  if(!item||typeof item!=='object'||!['actor','background'].includes(item.kind)||typeof item.name!=='string'||!item.name.trim()||item.name.length>100)fail('自定义图片说明无效');
  if(!new RegExp('^custom_'+item.kind+'_[a-f0-9]{64}$').test(item.id)||ids.has(item.id))fail('自定义图片编号无效或重复');ids.add(item.id);
  if(!Number.isInteger(item.width)||!Number.isInteger(item.height)||Math.min(item.width,item.height)<1||Math.max(item.width,item.height)>IMAGE_LIMITS.maxDimension)fail('自定义图片尺寸无效');
  pixels+=item.width*item.height;decoded+=(item.width*4+1)*item.height;
  if(pixels>IMAGE_LIMITS.totalPixels)fail('一个工程的自定义图片合计不得超过3200万像素');
  if(decoded>IMAGE_LIMITS.totalDecodedBytes)fail('一个工程的自定义图片解压总量不得超过120 MiB');
  if(typeof item.dataUrl!=='string'||!item.dataUrl.startsWith('data:image/png;base64,'))fail('工程内的自定义图片必须是本机处理后的 PNG');
  const data=item.dataUrl.slice(22);if(data.length>Math.ceil(IMAGE_LIMITS.imageBytes/3)*4||!data.length||data.length%4||!/^[A-Za-z0-9+/]+={0,2}$/.test(data))fail('自定义图片数据无效或超过8 MB');
  total+=data.length/4*3-(data.endsWith('==')?2:data.endsWith('=')?1:0);if(total>IMAGE_LIMITS.totalBytes)fail('一个工程的自定义图片合计不得超过32 MB');
  if(item.bounds!==undefined){const b=item.bounds;if(!Array.isArray(b)||b.length!==4||!b.every(v=>Number.isFinite(v)&&v>=0&&v<=1)||b[0]>=b[2]||b[1]>=b[3])fail('人物图片可见区域无效');}
 }
 return total;
}
/** Large immutable image strings are shared by undo/save snapshots; descriptors are copied. */
export function cloneProject(project){const {customImages,...rest}=project;return {...structuredClone(rest),...(customImages?{customImages:customImages.map(i=>({...i,...(i.bounds?{bounds:[...i.bounds]}:{})}))}:{})};}
export function withProjectImages(catalog,project){
 const images=project.customImages??[];
 const custom=(kind)=>images.filter(i=>i.kind===kind).map(i=>({...i,source:'custom',imageUrl:i.dataUrl,thumbnailUrl:i.dataUrl,...(kind==='actor'?{styleName:'自定义立绘',expressions:[],parameters:[],expressionsComplete:true,nameVerified:true,framing:{bounds:i.bounds??[0,0,1,1],canvasAspect:i.width/i.height}}:{})}));
 return {...catalog,characters:[...(catalog.characters??[]),...custom('actor')],backgrounds:[...(catalog.backgrounds??[]),...custom('background')]};
}
