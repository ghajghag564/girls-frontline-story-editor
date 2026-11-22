/** Pure, time-addressable story and music evaluation, shared by preview/export. */
import {assertProjectBudget,PROJECT_LIMITS} from './project-budget.mjs';
import {isSpeakingActor} from './speakers.mjs';
const clamp=(x,a=0,b=1)=>Math.min(b,Math.max(a,x));
const finite=(x,label,min=0)=>{if(!Number.isFinite(x)||x<min)throw new Error(`${label}无效`);return x};
// The supplied NPC recording shows a roughly 0.2 s linear highlight handover.
// Tracks are sampled at absolute time; interrupted fades start at the current value.
const highlightDuration=.2;
// The reference narrator leaves a non-speaking actor at the same dim level.
const highlightTarget=(line,id)=>line.kind==='pause'||line.kind==='dialogue'&&isSpeakingActor(line,id)?1:.45;
const highlightAt=(track,time)=>track.from+(track.to-track.from)*clamp((time-track.start)/highlightDuration);
// Constructing Intl.Segmenter is costly and this runs per rendered frame; reuse one.
const segmenter=new Intl.Segmenter('zh-CN',{granularity:'grapheme'});
export const graphemes=s=>[...segmenter.segment(s)].map(x=>x.segment);

// Punctuation starts a rest when it appears on screen. Spaces and quotation
// marks preserve the current phrase, including a final pause before a quote.
const shortPause=/[,，、､﹐;；﹔:：﹕]/u;
const longPause=/[.。．｡﹒!！﹗?？﹖…⋯—]/u;
const spacingOrQuote=/^[\s"'“”‘’「」『』（）()\[\]【】《》〈〉]+$/u;
export function hasSpeechPause(text){return shortPause.test(text)||longPause.test(text);}
export function endsWithSpeechPause(text){
 const tail=text.replace(/[\s"'“”‘’「」『』（）()\[\]【】《》〈〉]+$/u,'');
 return tail.length>0&&hasSpeechPause(tail.at(-1));
}
function compileSpeech(chars,speed){
 const pauses=[];let hasWords=false,pending=null;
 function finish(end){
  const last=pauses.at(-1);
  if(last&&last.end>=pending.start)last.end=Math.max(last.end,end);
  else pauses.push({start:pending.start,end});
  pending=null;
 }
 for(let i=0;i<chars.length;i++){
  const glyph=chars[i],revealed=(i+1)/speed;
  if(hasSpeechPause(glyph)){
   pending??={start:hasWords?revealed:0,minEnd:0};
   const dwell=longPause.test(glyph)?.18:.12;
   pending.minEnd=Math.max(pending.minEnd,revealed+dwell);
  }else if(!spacingOrQuote.test(glyph)){
   hasWords=true;
   if(pending)finish(Math.max(revealed,pending.minEnd));
  }
 }
 const endsPaused=Boolean(pending);
 if(pending)finish(Infinity);
 return {hasWords,endsPaused,pauses,starts:new Map()};
}
function mouthRestAt(pauses,elapsed){
 let lo=0,hi=pauses.length;
 while(lo<hi){
  const mid=(lo+hi)>>>1;
  if(pauses[mid].end<=elapsed+1e-9)lo=mid+1;else hi=mid;
 }
 return lo<pauses.length&&pauses[lo].start<=elapsed+1e-9;
}

export function compileProject(project,{budgetChecked=false}={}){
 if(!budgetChecked)assertProjectBudget(project);
 if(project.formatVersion!==1||!Array.isArray(project.scenes))throw new Error('工程格式不兼容');
 const entries=[];const voices=[];let time=0,stage={background:null,actors:[],compositions:{}};
 const ids=new Set();let expressionTracks=new Map(),highlightTracks=new Map(),backgroundStartedAt=0;
 for(const scene of project.scenes){
  if(!Array.isArray(scene.entries))throw new Error('场景缺少顺序条目');
  for(const line of scene.entries){
   if(!line.id||ids.has(line.id))throw new Error('条目标识重复或缺失');ids.add(line.id);
   if(!['dialogue','narration','pause'].includes(line.kind))throw new Error('不支持的演出条目');
   if(typeof line.text!=='string')throw new Error('正文必须是文字');
   const chars=graphemes(line.text),speed=finite(line.charactersPerSecond??25,'文字速度',1);
   const transition=finite(line.transition??.25,'过渡时长'),hold=finite(line.hold??1.5,'停留时长');
   const duration=transition+(line.kind==='pause'?0:chars.length/speed)+hold;
   if(duration<=0)throw new Error('条目时长必须大于零');
   if(time+duration>PROJECT_LIMITS.duration)throw new Error('工程总时长不得超过6小时');
   if(line.effects?.shake){const shake=line.effects.shake;finite(shake.amount,'震动强度');finite(shake.duration,'震动时长',.01);if(shake.amount>.03||shake.duration>10)throw new Error('震动设置超出范围');}
   // Most lines contain one UTF-16 unit per glyph and no hard breaks. Only
   // allocate prefix tables when a line needs them for partial text rendering.
   const textOffsets=chars.length===line.text.length?null:new Uint32Array(chars.length+1);
   const printableCounts=chars.includes('\n')?new Uint32Array(chars.length+1):null;
   if(textOffsets||printableCounts){
    for(let i=0;i<chars.length;i++){
     if(textOffsets)textOffsets[i+1]=textOffsets[i]+chars[i].length;
     if(printableCounts)printableCounts[i+1]=printableCounts[i]+Number(chars[i]!=='\n');
    }
   }
   const previous=structuredClone(stage),previousBackgroundStartedAt=backgroundStartedAt;
   stage={...stage,...structuredClone(line.stage??{})};
   if(stage.background!==previous.background)backgroundStartedAt=time;
   if(!Array.isArray(stage.actors))throw new Error('人物列表无效');
   if(new Set(stage.actors.map(a=>a.instanceId)).size!==stage.actors.length)throw new Error('人物实例重复');
   for(const actor of stage.actors){
    for(const k of ['x','y','scale','opacity'])if(actor[k]!==undefined&&!Number.isFinite(actor[k]))throw new Error('人物位置无效');
    if((actor.scale??1)<=0)throw new Error('人物缩放无效');
   }
   // Immutable change chains are shared by inherited lines, never restarted per sentence.
   const previousExpressionTracks=expressionTracks;expressionTracks=new Map();
   for(const actor of stage.actors){
    const old=previousExpressionTracks.get(actor.instanceId),expression=actor.expression??null;
    const sameModel=old?.assetId===actor.assetId;
    expressionTracks.set(actor.instanceId,sameModel&&old.expression===expression?old:
     {assetId:actor.assetId,expression,start:time,enteredAt:sameModel?old.enteredAt:time,previous:sameModel?old:null});
   }
   const previousHighlightTracks=highlightTracks;highlightTracks=new Map();
   for(const actor of stage.actors){
    const old=previousHighlightTracks.get(actor.instanceId),target=highlightTarget(line,actor.instanceId);
    const sameModel=old?.assetId===actor.assetId;
    highlightTracks.set(actor.instanceId,sameModel&&old.to===target?old:
     {assetId:actor.assetId,from:sameModel?highlightAt(old,time):target,to:target,start:time});
   }
   const music=line.music??{op:'inherit'};
   if(!['inherit','play','stop'].includes(music.op))throw new Error('音乐操作无效');
   if(music.op!=='inherit'){
    const fadeOut=finite(music.fadeOut??.5,'音乐淡出');
    for(const voice of voices){
     if(voice.stopAt!==null&&voice.stopAt+voice.fadeOut<=time)continue;
     const gain=voiceGain(voice,time);
     voice.stopAt=time;voice.stopGain=gain;voice.fadeOut=fadeOut;
    }
    if(music.op==='play'){
     if(typeof music.assetId!=='string'||!music.assetId)throw new Error('请选择背景音乐');
     const volume=finite(music.volume??.7,'音乐音量');if(volume>1)throw new Error('音乐音量超出范围');
     voices.push({assetId:music.assetId,start:time,offset:finite(music.offset??0,'音乐偏移'),volume,
      fadeIn:finite(music.fadeIn??.5,'音乐淡入'),loop:music.loop??true,stopAt:null,stopGain:0,fadeOut:0});
    }
   }
   const speech=line.kind==='dialogue'?compileSpeech(chars,speed):null;
   if(speech?.hasWords){
    const prior=entries.at(-1);
    for(const actor of stage.actors){
     if(actor.mouth===false||!isSpeakingActor(line,actor.instanceId))continue;
     const continued=prior?.sceneId===scene.id&&!prior.speech?.endsPaused
       ?prior.speech?.starts.get(actor.instanceId):null;
     const since=continued?.assetId===actor.assetId?continued.since:time+transition;
     speech.starts.set(actor.instanceId,{assetId:actor.assetId,since});
    }
   }
   entries.push({sceneId:scene.id,speech,line:structuredClone(line),chars,textOffsets,printableCounts,speed,start:time,end:time+duration,transition,previous,stage:structuredClone(stage),expressionTracks,previousExpressionTracks,highlightTracks,previousHighlightTracks,backgroundStartedAt,previousBackgroundStartedAt});
   time+=duration;
  }
 }
 return {entries,voices,duration:time};
}
export function voiceGain(voice,time){
 if(time<voice.start)return 0;
 if(voice.stopAt!==null&&time>=voice.stopAt)return voice.fadeOut===0?0:voice.stopGain*clamp(1-(time-voice.stopAt)/voice.fadeOut);
 return voice.volume*(voice.fadeIn===0?1:clamp((time-voice.start)/voice.fadeIn));
}
export function sourceSample(voice,time,asset){
 const rate=asset.sampleRate,total=asset.samples;
 if(!(rate>0&&Number.isSafeInteger(total)&&total>0))throw new Error('音频样本元数据无效');
 const raw=Math.floor((time-voice.start+voice.offset)*rate+1e-7);
 if(raw<0)return null;
 if(!voice.loop)return raw<total?raw:null;
 const loop=asset.loop??{start:0,end:total};
 if(!Number.isSafeInteger(loop.start)||!Number.isSafeInteger(loop.end)||loop.start<0||loop.end>total||loop.start>=loop.end)throw new Error('音频循环点无效');
 return raw<loop.end?raw:loop.start+(raw-loop.start)%(loop.end-loop.start);
}
export function musicAt(compiled,time,assets){
 const out=[];
 for(const v of compiled.voices){
  const gain=voiceGain(v,time);if(gain<=0)continue;
  const a=assets[v.assetId];if(!a)throw new Error(`缺少背景音乐：${v.assetId}`);
  const sample=sourceSample(v,time,a);if(sample!==null)out.push({assetId:v.assetId,gain,sample,loop:v.loop});
 }
 return out;
}
/** Time-addressable camera effect. No accumulated/random playback state. */
export function cameraAt(entry,time){
 const shake=entry.line.effects?.shake,elapsed=time-entry.start,duration=Math.min(shake?.duration??0,entry.end-entry.start);
 if(!shake||shake.amount===0||elapsed<=0||elapsed>=duration)return {x:0,y:0,zoom:1};
 let seed=2166136261;for(const c of entry.line.id)seed=Math.imul(seed^c.charCodeAt(0),16777619)>>>0;
 const phase=(seed%10000)/10000*Math.PI*2;
 const envelope=Math.sin(Math.PI*elapsed/duration)**2,amount=shake.amount*envelope;
 const x=amount*(.65*Math.sin(elapsed*113+phase)+.35*Math.sin(elapsed*179+phase*.7));
 const y=amount*.7*(.65*Math.cos(elapsed*97+phase)+.35*Math.sin(elapsed*157+phase*.3));
 return {x,y,zoom:1+2*amount};
}
function actorLayout(a,ratio,compositions){return {...a,...compositions?.[ratio]?.actors?.[a.instanceId]};}
export function stateAt(compiled,time,ratio='16:9'){
 finite(time,'时间');
 if(ratio!=='16:9')throw new Error('仅支持 16:9 横屏演出');
 if(!compiled.entries.length)return null;
 time=Math.min(time,compiled.duration);
 // First entry ending strictly after time. At the end of the project keep
 // displaying its last entry, just as playback does when the transport stops.
 let first=0,last=compiled.entries.length-1;
 while(first<last){
  const middle=Math.floor((first+last)/2);
  if(time<compiled.entries[middle].end)last=middle;
  else first=middle+1;
 }
 const entry=compiled.entries[first];
 const progress=entry.transition===0?1:clamp((time-entry.start)/entry.transition);
 const previous=entry.previous.actors.map(a=>actorLayout(a,ratio,entry.previous.compositions));
 const next=entry.stage.actors.map(a=>actorLayout(a,ratio,entry.stage.compositions));
 const actors=[];
 for(const id of new Set([...previous,...next].map(a=>a.instanceId))){
  const a=previous.find(x=>x.instanceId===id),b=next.find(x=>x.instanceId===id);
  const from=a??{...b,opacity:0},to=b??{...a,opacity:0};
  const result={...to};
  result.expressionTrack=(b?entry.expressionTracks:entry.previousExpressionTracks)?.get(id);
  result.animationStartedAt=result.expressionTrack?.enteredAt??0;
  const highlight=(b?entry.highlightTracks:entry.previousHighlightTracks).get(id);
  result.brightness=highlightAt(highlight,time);
  for(const [k,d] of Object.entries({x:.5,y:1,scale:1,opacity:1}))result[k]=(from[k]??d)+((to[k]??d)-(from[k]??d))*progress;
  if(result.opacity>0)actors.push(result);
 }
 const elapsed=Math.max(0,time-entry.start-entry.transition);
 const visible=Math.min(entry.chars.length,Math.floor(elapsed*entry.speed+1e-7));
 return {time,camera:cameraAt(entry,time),sceneId:entry.sceneId,lineId:entry.line.id,kind:entry.line.kind,speaker:entry.line.speaker??'',
  text:entry.line.text.slice(0,entry.textOffsets?.[visible]??visible),fullText:entry.line.text,
  visibleGlyphs:entry.printableCounts?.[visible]??visible,complete:visible===entry.chars.length,
  mouthSpeaking:Boolean(entry.speech?.hasWords&&time<entry.end&&!mouthRestAt(entry.speech.pauses,elapsed)),
  speaking:entry.line.kind==='dialogue'&&visible<entry.chars.length&&time>=entry.start+entry.transition,
  actors,background:entry.stage.background,previousBackground:entry.previous.background,transitionProgress:progress,
  backgroundElapsed:time-entry.backgroundStartedAt,previousBackgroundElapsed:time-entry.previousBackgroundStartedAt,
  composition:entry.stage.compositions?.[ratio]??{},previousComposition:entry.previous.compositions?.[ratio]??{},
  tint:sceneTint(entry.previous.tint,entry.stage.tint,progress),color:entry.stage.color??'#000000',previousColor:entry.previous.color??'#000000',entry};
}
export function validateExport(settings,duration,availableCodecs=['h264','h265']){
 const {ratio,resolution,fps,bitrateMbps,codec}=settings;
 if(ratio!=='16:9')throw new Error('仅支持 16:9 横屏导出，竖屏导出已禁用');
 if(![720,1080,1440,2160].includes(resolution)||![24,30,60].includes(fps))throw new Error('导出画幅、分辨率或帧率无效');
 finite(bitrateMbps,'码率',1);if(bitrateMbps>150)throw new Error('码率不得超过150 Mbps');
 if(!availableCodecs.includes(codec))throw new Error('编码器不可用');
 const start=finite(settings.start??0,'导出起点'),end=finite(settings.end??duration,'导出终点');
 if(start>=end||end>duration)throw new Error('导出区间必须位于作品时长内');
 const size=[resolution*16/9,resolution];
 return {...settings,start,end,width:size[0],height:size[1],frames:Math.ceil((end-start)*fps-1e-9),
  estimatedBytes:(end-start)*(bitrateMbps*1e6+192000)/8};
}
export function* frameTimes(settings){for(let i=0;i<settings.frames;i++)yield {index:i,time:settings.start+i/settings.fps};}

/** Interpolate the saved scene tint during a transition. */
export function sceneTint(previous='#ffffff',next='#ffffff',progress=1){
 const channels=color=>{if(!/^#[0-9a-f]{6}$/i.test(color))throw new Error('场景色调无效');return [1,3,5].map(i=>parseInt(color.slice(i,i+2),16));};
 const a=channels(previous),b=channels(next);return '#'+a.map((v,i)=>Math.round(v+(b[i]-v)*clamp(progress)).toString(16).padStart(2,'0')).join('');
}
