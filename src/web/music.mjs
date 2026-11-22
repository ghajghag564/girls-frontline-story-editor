import {voiceGain,sourceSample} from '../core/timeline.mjs';
/** Schedules the same sample offsets and gain envelopes evaluated by the export mixer. */
export class MusicTransport {
 constructor(catalog,{onError=()=>{},createAudioContext=()=>new AudioContext({sampleRate:48000})}={}){this.assets=new Map(catalog.map(x=>[x.id,x]));this.buffers=new Map();this.loading=new Map();this.nodes=new Map();this.scheduled=new Set();this.createAudioContext=createAudioContext;this.position=0;this.playing=false;this.generation=0;this.monitor=.8;this.onError=onError;}
 ensure(){if(!this.context){this.context=this.createAudioContext();this.master=this.context.createGain();this.master.gain.value=this.monitor;this.master.connect(this.context.destination);}return this.context;}
 async load(id){
  if(this.buffers.has(id)){const b=this.buffers.get(id);this.buffers.delete(id);this.buffers.set(id,b);return b;}
  if(this.loading.has(id))return this.loading.get(id);
  if(!this.assets.has(id))throw new Error('缺少所选背景音乐');
  const work=(async()=>{const response=await fetch(`/assets/music/${encodeURIComponent(id)}/full`);if(!response.ok)throw new Error('音乐素材读取失败');const buffer=await this.ensure().decodeAudioData(await response.arrayBuffer());const asset=this.assets.get(id);if(buffer.sampleRate!==48000||buffer.numberOfChannels!==2||Math.abs(buffer.length-asset.samples)>1)throw new Error('音乐解码采样数与目录不符');this.buffers.set(id,buffer);while(this.buffers.size>3)this.buffers.delete(this.buffers.keys().next().value);return buffer;})();
  this.loading.set(id,work);try{return await work;}finally{this.loading.delete(id);}
 }
 get time(){return this.playing?Math.min(this.compiled.duration,this.position+Math.max(0,this.context.currentTime-this.anchor)):this.position;}
 setMonitor(value){this.monitor=value;if(this.master)this.master.gain.value=value;}
 stopNodes(){clearInterval(this.timer);for(const {source,gain} of this.nodes.values()){try{source.stop();}catch{}source.disconnect();gain.disconnect();}this.nodes.clear();this.scheduled.clear();}
 pause(){this.position=this.time;this.playing=false;this.generation++;this.stopNodes();return this.position;}
 async play(compiled,time=0){
  this.pause();const generation=this.generation;this.compiled=compiled;this.position=Math.min(time,compiled.duration);const context=this.ensure();await context.resume();
  const initial=compiled.voices.filter(v=>v.start<=time+3&&(v.stopAt===null||v.stopAt+v.fadeOut>time));
  await Promise.all([...new Set(initial.map(v=>v.assetId))].map(id=>this.load(id)));
  if(generation!==this.generation)return;
  this.anchor=context.currentTime+.08;this.playing=true;
  try{await this.schedule(generation);}catch(error){
   if(generation!==this.generation)return;
   this.pause();throw error;
  }
  // A pause or a new play can finish while this generation is decoding audio.
  if(generation!==this.generation)return;
  this.timer=setInterval(()=>this.schedule(generation).catch(error=>{
   if(generation===this.generation){this.pause();this.onError(error);}
  }),200);
 }
 async schedule(generation){
  if(generation!==this.generation||!this.playing)return;
  const time=this.time;
  for(let index=0;index<this.compiled.voices.length;index++){
   const voice=this.compiled.voices[index];
   if(this.scheduled.has(index)||voice.start>time+3||(voice.stopAt!==null&&voice.stopAt+voice.fadeOut<=time))continue;
   const buffer=await this.load(voice.assetId);if(generation!==this.generation||!this.playing)return;
   if(this.scheduled.has(index))continue;
   const now=this.context.currentTime,storyStart=Math.max(voice.start,this.position+Math.max(0,now-this.anchor));
   const asset=this.assets.get(voice.assetId),sample=sourceSample(voice,storyStart,asset);if(sample===null)continue;
   const source=this.context.createBufferSource(),gain=this.context.createGain();source.buffer=buffer;source.loop=voice.loop;
   source.loopStart=(asset.loop?.start??0)/48000;source.loopEnd=(asset.loop?.end??asset.samples)/48000;
   source.connect(gain);gain.connect(this.master);
   const when=this.anchor+storyStart-this.position;
   gain.gain.setValueAtTime(voiceGain(voice,storyStart),when);
   const boundaries=[voice.start+voice.fadeIn,voice.stopAt,voice.stopAt===null?null:voice.stopAt+voice.fadeOut,this.compiled.duration].filter(t=>t!==null&&t>storyStart&&t<=this.compiled.duration).sort((a,b)=>a-b);
   for(const boundary of [...new Set(boundaries)])gain.gain.linearRampToValueAtTime(voiceGain(voice,boundary),this.anchor+boundary-this.position);
   const end=Math.min(this.compiled.duration,voice.stopAt===null?Infinity:voice.stopAt+voice.fadeOut);
   if(end<=storyStart){source.disconnect();gain.disconnect();continue;}
   source.start(when,sample/48000);source.stop(this.anchor+end-this.position);
   this.nodes.set(index,{source,gain});this.scheduled.add(index);
   source.onended=()=>{source.disconnect();gain.disconnect();if(this.nodes.get(index)?.source===source)this.nodes.delete(index);};
  }
 }
 async seek(compiled,time){const wasPlaying=this.playing;this.pause();this.position=time;this.compiled=compiled;if(wasPlaying)await this.play(compiled,time);}
}
