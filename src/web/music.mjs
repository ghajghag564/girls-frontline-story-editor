import {t} from './i18n.mjs';
import {voiceGain,sourceSample} from '../core/timeline.mjs';
const maxCachedAudioBytes=128*1024**2;
function canScheduleVoice(voice,time,assets){
 if(voice.start>time+3||(voice.stopAt!==null&&voice.stopAt+voice.fadeOut<=time))return false;
 const asset=assets.get(voice.assetId);
 // Leave missing assets to load(), which reports the missing track.
 return !asset||sourceSample(voice,Math.max(voice.start,time),asset)!==null;
}
/** Schedules the same sample offsets and gain envelopes evaluated by the export mixer. */
export class MusicTransport {
 constructor(catalog,{onError=()=>{},createAudioContext=()=>new AudioContext({sampleRate:48000})}={}){
  this.assets=new Map(catalog.map(x=>[x.id,x]));
  this.buffers=new Map();this.loading=new Map();this.preparingAssets=new Set();
  this.nodes=new Map();this.scheduled=new Set();
  this.createAudioContext=createAudioContext;this.position=0;this.playing=false;this.generation=0;this.monitor=.8;this.onError=onError;
 }
 addAsset(asset){this.assets.set(asset.id,asset);}
 ensure(){if(!this.context){this.context=this.createAudioContext();this.master=this.context.createGain();this.master.gain.value=this.monitor;this.master.connect(this.context.destination);}return this.context;}
 trimBuffers(){
  // Playback and its initial preparation may temporarily need more than the cache budget.
  const needed=new Set(this.preparingAssets);
  for(const {assetId} of this.nodes.values())needed.add(assetId);
  let totalBytes=0;
  const idle=[];
  for(const [id,buffer] of this.buffers){
   const bytes=buffer.length*buffer.numberOfChannels*Float32Array.BYTES_PER_ELEMENT;
   totalBytes+=bytes;
   if(!needed.has(id))idle.push({id,bytes});
  }
  if(totalBytes<=maxCachedAudioBytes)return;
  // Map order breaks size ties by least recent use.
  idle.sort((a,b)=>b.bytes-a.bytes);
  for(const {id,bytes} of idle){
   this.buffers.delete(id);
   totalBytes-=bytes;
   if(totalBytes<=maxCachedAudioBytes)break;
  }
 }
 async load(id){
  if(this.buffers.has(id)){const b=this.buffers.get(id);this.buffers.delete(id);this.buffers.set(id,b);return b;}
  if(this.loading.has(id))return this.loading.get(id);
  if(!this.assets.has(id))throw new Error(t("缺少所选背景音乐"));
  const work=(async()=>{
   const response=await fetch(`/assets/music/${encodeURIComponent(id)}/full`);
   if(!response.ok)throw new Error(t("音乐素材读取失败"));
   const buffer=await this.ensure().decodeAudioData(await response.arrayBuffer());
   const asset=this.assets.get(id);
   if(buffer.sampleRate!==48000||buffer.numberOfChannels!==2||Math.abs(buffer.length-asset.samples)>1)throw new Error(t("音乐解码采样数与目录不符"));
   this.buffers.set(id,buffer);
   this.trimBuffers();
   return buffer;
  })();
  this.loading.set(id,work);try{return await work;}finally{this.loading.delete(id);}
 }
 get time(){return this.playing?Math.min(this.compiled.duration,this.position+Math.max(0,this.context.currentTime-this.anchor)):this.position;}
 setMonitor(value){this.monitor=value;if(this.master)this.master.gain.value=value;}
 stopNodes(){clearInterval(this.timer);for(const {source,gain} of this.nodes.values()){try{source.stop();}catch{}source.disconnect();gain.disconnect();}this.nodes.clear();this.scheduled.clear();}
 resetPlayback(position,preparingAssets=new Set()){
  this.position=position;
  this.playing=false;
  this.preparingAssets=preparingAssets;
  this.generation++;
  this.stopNodes();
  this.trimBuffers();
 }
 pause(){this.resetPlayback(this.time);return this.position;}
 async play(compiled,time=0){
  const position=Math.min(time,compiled.duration);
  const initial=compiled.voices.filter(voice=>canScheduleVoice(voice,position,this.assets));
  // Keep a still-needed long buffer through a seek before releasing the previous sources.
  const preparingAssets=new Set(initial.map(voice=>voice.assetId));
  this.resetPlayback(position,preparingAssets);
  const generation=this.generation;
  this.compiled=compiled;
  try{
   const context=this.ensure();
   await context.resume();
   if(generation!==this.generation)return;
   await Promise.all([...preparingAssets].map(id=>this.load(id)));
   if(generation!==this.generation)return;
   this.anchor=context.currentTime+.08;this.playing=true;
   await this.schedule(generation);
   if(generation!==this.generation)return;
   this.timer=setInterval(()=>this.schedule(generation).catch(error=>{
    if(generation===this.generation){this.pause();this.onError(error);}
   }),200);
  }catch(error){
   if(generation!==this.generation)return;
   this.pause();throw error;
  }finally{
   if(generation===this.generation){
    preparingAssets.clear();
    this.trimBuffers();
   }
  }
 }
 async schedule(generation){
  if(generation!==this.generation||!this.playing)return;
  const time=this.time;
  for(let index=0;index<this.compiled.voices.length;index++){
   const voice=this.compiled.voices[index];
   if(this.scheduled.has(index)||!canScheduleVoice(voice,time,this.assets))continue;
   const buffer=await this.load(voice.assetId);if(generation!==this.generation||!this.playing)return;
   if(this.scheduled.has(index))continue;
   const now=this.context.currentTime,storyStart=Math.max(voice.start,this.position+Math.max(0,now-this.anchor));
   const end=Math.min(this.compiled.duration,voice.stopAt===null?Infinity:voice.stopAt+voice.fadeOut);
   if(end<=storyStart)continue;
   const asset=this.assets.get(voice.assetId),sample=sourceSample(voice,storyStart,asset);if(sample===null)continue;
   const source=this.context.createBufferSource(),gain=this.context.createGain();source.buffer=buffer;source.loop=voice.loop;
   source.loopStart=(asset.loop?.start??0)/48000;source.loopEnd=(asset.loop?.end??asset.samples)/48000;
   source.connect(gain);gain.connect(this.master);
   const when=this.anchor+storyStart-this.position;
   gain.gain.setValueAtTime(voiceGain(voice,storyStart),when);
   const boundaries=[voice.start+voice.fadeIn,voice.stopAt,voice.stopAt===null?null:voice.stopAt+voice.fadeOut,this.compiled.duration].filter(t=>t!==null&&t>storyStart&&t<=this.compiled.duration).sort((a,b)=>a-b);
   for(const boundary of [...new Set(boundaries)]){
    const at=this.anchor+boundary-this.position;
    if(boundary===voice.stopAt&&voice.fadeOut===0)gain.gain.setValueAtTime(0,at);
    else gain.gain.linearRampToValueAtTime(voiceGain(voice,boundary),at);
   }
   source.start(when,sample/48000);source.stop(this.anchor+end-this.position);
   this.nodes.set(index,{assetId:voice.assetId,source,gain});
   // Keep the scheduled buffer available for another voice or a seek.
   this.buffers.set(voice.assetId,buffer);
   this.scheduled.add(index);
   this.trimBuffers();
   source.onended=()=>{
    source.disconnect();gain.disconnect();
    if(this.nodes.get(index)?.source===source){
     this.nodes.delete(index);
     this.trimBuffers();
    }
   };
  }
 }
 async seek(compiled,time){
  if(this.playing)return this.play(compiled,time);
  this.pause();this.position=time;this.compiled=compiled;
 }
}
