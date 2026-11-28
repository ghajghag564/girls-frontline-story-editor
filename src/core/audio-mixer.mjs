import {sourceSample,voiceGain} from './timeline.mjs';
export const MIX_RATE=48000;
/** Bounded stereo mixing. Reader returns interleaved Float32 source samples. */
export async function mixBlock(compiled,assets,startTime,frames,read){
 if(!Number.isFinite(startTime)||startTime<0||!Number.isSafeInteger(frames)||frames<0||frames>MIX_RATE)throw new Error('混音区间无效');
 const output=new Float32Array(frames*2);
 for(const voice of compiled.voices){
  if(voice.start>=startTime+frames/MIX_RATE)continue;
  if(voice.stopAt!==null&&voice.stopAt+voice.fadeOut<=startTime)continue;
  const asset=assets[voice.assetId];
  if(!asset)throw new Error(`缺少背景音乐：${voice.assetId}`);
  if(asset.sampleRate!==MIX_RATE||asset.channels!==2)throw new Error('音乐必须预先统一为48 kHz双声道');
  let i=0;
  while(i<frames){
   const time=startTime+i/MIX_RATE;
   if(time<voice.start){i++;continue;}
   const source=sourceSample(voice,time,asset);
   // Once a one-shot track ends, later samples in this block are silent.
   if(source===null)break;
   const begin=i;
   i++;
   while(i<frames&&sourceSample(voice,startTime+i/MIX_RATE,asset)===source+i-begin)i++;
   const count=i-begin,data=await read(voice.assetId,source,count);
   if(!(data instanceof Float32Array)||data.length!==count*2)throw new Error('音乐样本读取不完整');
   for(let j=0;j<count;j++){
    const gain=voiceGain(voice,startTime+(begin+j)/MIX_RATE);
    for(let channel=0;channel<2;channel++){
     const sample=data[j*2+channel];
     if(!Number.isFinite(sample))throw new Error('音乐包含无效采样');
     output[(begin+j)*2+channel]+=sample*gain;
    }
   }
  }
 }
 for(let i=0;i<output.length;i++)output[i]=Math.max(-1,Math.min(1,output[i]));
 return output;
}
export async function* mixRange(compiled,assets,start,end,read,{blockFrames=4800,signal}={}){
 if(!Number.isFinite(start)||!Number.isFinite(end)||start<0||end<=start||end>compiled.duration)throw new Error('混音区间超出作品');
 if(!Number.isSafeInteger(blockFrames)||blockFrames<1||blockFrames>MIX_RATE)throw new Error('混音缓冲区无效');
 const total=Math.ceil((end-start)*MIX_RATE-1e-7);
 for(let frame=0;frame<total;frame+=blockFrames){
  signal?.throwIfAborted();
  yield await mixBlock(compiled,assets,start+frame/MIX_RATE,Math.min(blockFrames,total-frame),read);
 }
}
