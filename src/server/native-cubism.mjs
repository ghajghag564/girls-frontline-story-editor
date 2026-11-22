import koffi from 'koffi';
import {checkDependency} from './local-config.mjs';
import {systemDirectory} from './windows-system.mjs';
import path from 'node:path';
import {createHash} from 'node:crypto';
const bounded=(n,max,label)=>{if(!Number.isSafeInteger(n)||n<0||n>max)throw new Error(`${label}数量无效`);return n};
/** Used only in a separate worker process: malformed native data must not terminate the editor. */
export async function createNativeCore(dependency){
 if(process.platform!=='win32'||process.arch!=='x64')throw new Error('此本地模型组件需要 Windows x64');
 // Call signatures follow Sakura Motion Purism Core's public v6 ABI.
 const lib=koffi.load(await checkDependency(dependency));
 const crt=koffi.load(path.win32.join(systemDirectory(),'ucrtbase.dll'));
 const allocate=crt.func('void *_aligned_malloc(size_t size, size_t alignment)'),free=crt.func('void _aligned_free(void *ptr)');
 const get=(name,result='void *',args=['void *'])=>lib.func(name,result,args);
 const version=get('csmGetVersion','uint32_t',[])();
 const implementation=get('csmGetExtendedVersionString','str',[])();
 if(!/^1\.1\.0(?:\s|$)/.test(implementation??'')||version!==0x06000001)throw new Error('请配置 Purism Core 1.1.0 的 v6 ABI');
 const hasConsistency=get('csmHasMocConsistency','int',['void *','uint32_t']);
 const revive=get('csmReviveMocInPlace','void *',['void *','uint32_t']);
 const sizeOf=get('csmGetSizeofModel','uint32_t'),initialize=get('csmInitializeModelInPlace','void *',['void *','void *','uint32_t']);
 const update=get('csmUpdateModel','void'),offscreenCount=get('csmGetOffscreenCount','int');
 const canvas=get('csmReadCanvasInfo','void',['void *','_Out_ float *','_Out_ float *','_Out_ float *']);
 const f={};for(const suffix of ['ParameterCount','PartCount','DrawableCount'])f[suffix]=get('csmGet'+suffix,'int');
 for(const suffix of ['ParameterIds','ParameterMinimumValues','ParameterMaximumValues','ParameterDefaultValues','ParameterValues','PartIds','PartOpacities','DrawableIds','DrawableConstantFlags','DrawableDynamicFlags','DrawableTextureIndices','RenderOrders','DrawableOpacities','DrawableMaskCounts','DrawableMasks','DrawableVertexCounts','DrawableVertexPositions','DrawableVertexUvs','DrawableIndexCounts','DrawableIndices'])f[suffix]=get('csmGet'+suffix);
 const decode=(ptr,type,count)=>count?Array.from(koffi.decode(ptr,type,count)):[];
 return {version,implementation,create(raw,expectedHash){
  if(!Buffer.isBuffer(raw)||raw.length<64||raw.length>64*1024*1024||raw.subarray(0,4).toString()!=='MOC3'||!expectedHash||createHash('sha256').update(raw).digest('hex')!==expectedHash)throw new Error('人物模型校验失败');
  let moc=null,model=null,mocMemory=null,modelMemory=null,closed=false;
  const dispose=()=>{if(closed)return;closed=true;if(modelMemory)free(modelMemory);if(mocMemory)free(mocMemory);model=modelMemory=moc=mocMemory=null;};
  try{
   mocMemory=allocate(raw.length,64);if(!mocMemory)throw new Error('人物模型内存不足');new Uint8Array(koffi.view(mocMemory,raw.length)).set(raw);
   if(hasConsistency(mocMemory,raw.length)!==1)throw new Error('人物模型结构校验失败，已阻止加载');
   moc=revive(mocMemory,raw.length);if(!moc)throw new Error('人物模型版本不受支持');
   const size=bounded(sizeOf(moc),128*1024*1024,'模型内存');if(!size)throw new Error('人物模型为空');
   modelMemory=allocate(size,16);if(!modelMemory)throw new Error('人物模型内存不足');
   model=initialize(moc,modelMemory,size);if(!model)throw new Error('人物模型初始化失败');update(model);
   if(offscreenCount(model)!==0)throw new Error('此人物使用了未接入的离屏绘制功能');
   const array=(name,type,count)=>decode(f[name](model),type,count);
   const parameterCount=bounded(f.ParameterCount(model),10000,'参数'),partCount=bounded(f.PartCount(model),10000,'部件'),count=bounded(f.DrawableCount(model),10000,'绘制片段');
   const ids=array('ParameterIds','str',parameterCount),minimum=array('ParameterMinimumValues','float',parameterCount),maximum=array('ParameterMaximumValues','float',parameterCount),defaults=array('ParameterDefaultValues','float',parameterCount);
   const parameterById=new Map(ids.map((id,i)=>[id,i]));if(parameterById.size!==parameterCount)throw new Error('人物模型参数编号重复');
   const parameterPtr=f.ParameterValues(model),partPtr=f.PartOpacities(model),partDefaults=array('PartOpacities','float',partCount);
   const sizePixels=[0,0],originPixels=[0,0],pixelsPerUnit=[0];canvas(model,sizePixels,originPixels,pixelsPerUnit);
   const canvasInfo={size:sizePixels,origin:originPixels,pixelsPerUnit:pixelsPerUnit[0]};
   if(![...sizePixels,...originPixels,pixelsPerUnit[0]].every(Number.isFinite)||Math.min(...sizePixels,pixelsPerUnit[0])<=0)throw new Error('人物模型画布无效');
   const nv=array('DrawableVertexCounts','int',count),ni=array('DrawableIndexCounts','int',count),nm=array('DrawableMaskCounts','int',count);
   const uvPtrs=array('DrawableVertexUvs','void *',count),indexPtrs=array('DrawableIndices','void *',count),maskPtrs=array('DrawableMasks','void *',count);
   const flags=array('DrawableConstantFlags','uint8_t',count),textures=array('DrawableTextureIndices','int',count),drawableIds=array('DrawableIds','str',count);
   const topology=Array.from({length:count},(_,i)=>{
    bounded(nv[i],100000,'顶点');bounded(ni[i],1000000,'三角形索引');bounded(nm[i],count,'遮罩');
    const uv=decode(uvPtrs[i],'float',nv[i]*2),indices=decode(indexPtrs[i],'uint16_t',ni[i]),masks=decode(maskPtrs[i],'int',nm[i]);
    if(indices.some(x=>x>=nv[i])||masks.some(x=>x<0||x>=count)||!uv.every(Number.isFinite)||ni[i]%3)throw new Error('人物网格数据无效');
    return {index:i,id:drawableIds[i],texture:textures[i],flags:flags[i],uvs:uv,indices,masks};
   });
   const parameters=ids.map((id,i)=>({id,min:minimum[i],max:maximum[i],default:defaults[i]}));
   const evaluate=(overrides={})=>{
    if(closed)throw new Error('人物模型已释放');
    if(!overrides||typeof overrides!=='object'||Array.isArray(overrides))throw new Error('人物参数格式无效');
    const values=[...defaults];for(const [id,value] of Object.entries(overrides)){
     const index=parameterById.get(id);if(index===undefined)throw new Error('模型不支持参数：'+id);
     if(!Number.isFinite(value)||value<minimum[index]||value>maximum[index])throw new Error('人物参数超出范围：'+id);values[index]=value;
    }
    if(parameterCount)koffi.encode(parameterPtr,'float',values,parameterCount);
    if(partCount)koffi.encode(partPtr,'float',partDefaults,partCount);
    update(model);
    const positions=array('DrawableVertexPositions','void *',count),orders=array('RenderOrders','int',count),opacities=array('DrawableOpacities','float',count),dynamic=array('DrawableDynamicFlags','uint8_t',count);
    return {drawables:topology.map((d,i)=>{
     const points=decode(positions[i],'float',nv[i]*2);if(!points.every(Number.isFinite))throw new Error('人物顶点计算失败');
     return {index:i,positions:points,order:orders[i],opacity:opacities[i],visible:!!(dynamic[i]&1)};
    })};
   };
   return {canvas:canvasInfo,parameters,topology,evaluate,dispose};
  }catch(error){dispose();throw error;}
 }};
}
