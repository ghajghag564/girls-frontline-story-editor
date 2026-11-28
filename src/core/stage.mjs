import {StoryInterfaceRenderer} from './story-interface.mjs';
import {stateAt,graphemes} from './timeline.mjs';

const storyFonts = {
 'zh-CN': 'GF2Editor, "HarmonyOS Sans SC", "Microsoft YaHei", "Noto Sans CJK SC", system-ui, sans-serif',
 'zh-TW': 'Inter, "Source Han Sans TW", "Source Han Sans TW VF", "Microsoft JhengHei", system-ui, sans-serif',
 en: 'Inter, "Inter Variable", "Segoe UI", system-ui, sans-serif',
 ja: 'Inter, "Source Han Sans JP", "Source Han Sans JP VF", "Yu Gothic UI", Meiryo, system-ui, sans-serif',
};
const fontLoads = new Map();
const noLineStart=new Set([..."、。，．？！：；…—)]}）〉》」』】〕〗〙〛’”％‰℃"]);
const noLineEnd=new Set([..."([{（〈《「『【〔〖〘〚‘“"]);
export function wrapText(context,text,width){
 const result=[[]];let current=0;
 for(const character of graphemes(text)){
  if(character==='\n'){result.push([]);current=0;continue;}
  const row=result.at(-1);row.push(character);current+=context.measureText(character).width;
  if(current<=width||row.length===1)continue;
  let cut=row.length-1;
  while(cut>0&&(noLineStart.has(row[cut])||noLineEnd.has(row[cut-1])))cut--;
  // A punctuation group wider than the entire line remains intact.
  if(cut===0)continue;
  const carry=row.splice(cut);result.push(carry);current=carry.reduce((sum,c)=>sum+context.measureText(c).width,0);
 }
 return result;
}
function drawVisibleLines(ctx, lines, remaining, left, top, lineHeight) {
 for (let index = 0; index < lines.length; index++) {
  const visible = lines[index].slice(0, remaining);
  remaining = Math.max(0, remaining - lines[index].length);
  ctx.fillText(visible.join(""), left, top + index * lineHeight);
 }
}
function loadStoryFonts(fontFamily){
 if(typeof document==='undefined')return;
 if(!fontLoads.has(fontFamily)){
  const loads=[500,700].map(weight=>document.fonts.load(weight+' 19px '+fontFamily));
  fontLoads.set(fontFamily,Promise.all(loads).catch(error=>{
   fontLoads.delete(fontFamily);
   throw new Error('字幕字体无法加载，请检查本地素材目录。',{cause:error});
  }));
 }
 return fontLoads.get(fontFamily);
}
function background(ctx,image,w,h,composition){
 const width=image.videoWidth??image.width,height=image.videoHeight??image.height;
 const crop=composition?.background??{};const scale=Math.max(w/width,h/height)*(crop.scale??1),dw=width*scale,dh=height*scale;
 ctx.drawImage(image,(w-dw)*(crop.x??.5),(h-dh)*(crop.y??.5),dw,dh);
}
function fitVideo(ctx,video,w,h){
 const scale=Math.min(w/video.videoWidth,h/video.videoHeight),dw=video.videoWidth*scale,dh=video.videoHeight*scale;
 ctx.drawImage(video,(w-dw)/2,(h-dh)/2,dw,dh);
}
/** Rendering is a pure function of compiled story, time and output size after asset loading. */
export class StageRenderer {
 constructor(canvas,{imageLoader,actorRenderer,interfaceRenderer,videoFrames}={}){
  this.canvas=canvas;this.context=canvas.getContext('2d',{alpha:false,willReadFrequently:true});this.imageLoader=imageLoader??(async id=>{
   const response=await fetch(`/assets/background/${encodeURIComponent(id)}/full`);if(!response.ok)throw new Error('背景素材无法读取');return createImageBitmap(await response.blob());
  });this.interfaceRenderer=interfaceRenderer??(typeof document!=='undefined'?new StoryInterfaceRenderer():null);this.actorRenderer=actorRenderer;this.images=new Map();this.wrapCache=new Map();
  this.videoFrames=videoFrames;
 }
 async image(id){
  if(!id)return null;
  if(this.images.has(id)){const value=this.images.get(id);this.images.delete(id);this.images.set(id,value);return value;}
  const bitmap=await this.imageLoader(id);this.images.set(id,bitmap);
  while(this.images.size>8){const key=this.images.keys().next().value;this.images.get(key).close?.();this.images.delete(key);}
  return bitmap;
 }
 async render(compiled,time,{ratio='16:9',hideText=false,showCompleteText=false,watermark={enabled:false,text:''},videoPlaying=false,signal}={}){
  if(ratio!=='16:9')throw new Error('仅支持 16:9 横屏演出');
  const state=stateAt(compiled,time,ratio),ctx=this.context,canvas=this.canvas;
  const subtitles=compiled.subtitleSettings,theater=subtitles?.mode==="theater";
  const w=1280,h=720;
  const clip=state?.video,videoOptions={playing:videoPlaying,signal};
  const language=subtitles?.fontLanguage??'zh-CN',fontFamily=storyFonts[language];
  // Use the story's glyph convention in both the visible stage and the export canvas.
  if('lang' in canvas&&canvas.lang!==language)canvas.lang=language;
  const drawSubtitles=state&&!clip&&!hideText&&state.kind!=='pause';
  const drawWatermark=watermark.enabled&&watermark.text;
  if(drawSubtitles||drawWatermark)await loadStoryFonts(fontFamily);
  let clipFrame,previous,next;
  this.videoFrames?.retain(clip?[clip.assetId]:[state?.previousBackground,state?.background]);
  if(clip){
   if(!this.videoFrames)throw new Error('过场视频尚未准备。');
   clipFrame=await this.videoFrames.frame(clip.assetId,state.videoElapsed,videoOptions);
  }else{
   const layer=(id,elapsed)=>this.videoFrames?.has(id)?
    this.videoFrames.frame(id,elapsed,{...videoOptions,loop:true}):this.image(id);
   previous=await layer(state?.previousBackground,state?.previousBackgroundElapsed);
   next=state?.previousBackground===state?.background?previous:await layer(state?.background,state?.backgroundElapsed);
   if(!theater)await this.interfaceRenderer?.prepare?.(state,hideText);
   await this.actorRenderer?.prepareFrame?.(state,canvas);
  }
  ctx.resetTransform();ctx.globalAlpha=1;ctx.filter='none';ctx.fillStyle='#000';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.save();ctx.scale(canvas.width/w,canvas.height/h);
  try{
  if(!state)return null;
  if(clipFrame)fitVideo(ctx,clipFrame,w,h);
  else{
  const drawBackground=(image,color,composition)=>{if(image)background(ctx,image,w,h,composition);else{ctx.fillStyle=color;ctx.fillRect(0,0,w,h);}};
  ctx.save();const camera=state.camera,minDimension=Math.min(w,h);ctx.translate(w/2+camera.x*minDimension,h/2+camera.y*minDimension);ctx.scale(camera.zoom,camera.zoom);ctx.translate(-w/2,-h/2);
  try{
  drawBackground(previous,state.previousColor,state.previousComposition);
  ctx.save();ctx.globalAlpha=state.transitionProgress;drawBackground(next,state.color,state.composition);ctx.restore();
  if(state.actors.length&&!this.actorRenderer){throw new Error('人物模型尚未完成加载，无法渲染该工程');}
  for(const actor of [...state.actors].sort((a,b)=>(a.layer??0)-(b.layer??0))){
   await this.actorRenderer(ctx,actor,{state,w,h,brightness:actor.brightness,time});
  }
  }finally{ctx.restore();}
  if(state.tint!=='#ffffff'){ctx.save();try{ctx.globalCompositeOperation='multiply';ctx.fillStyle=state.tint;ctx.fillRect(0,0,w,h);}finally{ctx.restore();}}
  if(drawSubtitles){
   if(theater)this.drawTheaterText(ctx,state,w,h,showCompleteText,subtitles.colors,fontFamily);
   else this.drawText(ctx,state,w,h,showCompleteText,fontFamily);
  }
  }
  if(drawWatermark){ctx.save();ctx.font='500 16px '+fontFamily;ctx.fillStyle='rgba(255,255,255,.7)';ctx.textAlign='right';ctx.textBaseline='top';ctx.shadowColor='rgba(0,0,0,.7)';ctx.shadowBlur=2;ctx.fillText(watermark.text,w-28,24,w-56);ctx.restore();}
  return state;
  }finally{ctx.restore();}
 }
 drawText(ctx,state,w,h,showCompleteText,fontFamily){
  const narration=state.kind==='narration';
  const left=narration?100:107,right=107,width=w-left-right;
  let size=19,lines;
  do{ctx.font=`500 ${size}px ${fontFamily}`;lines=this.wrappedText(ctx,width,state.fullText);if(lines.length<=4||size===16)break;size--;}while(size>=16);
  if(lines.length>7)throw new Error('这句文字过长，请拆成几句后再预览或导出');
  const lineHeight=size*24/19,bodyHeight=Math.max(lineHeight*2,lines.length*lineHeight);
  const bodyY=Math.min(narration?605:593,h-34-bodyHeight);
  ctx.save();
  if(!narration){
  const gradient=ctx.createLinearGradient(0,h*.52,0,h);gradient.addColorStop(0,'rgba(0,0,0,0)');gradient.addColorStop(1,'rgba(0,0,0,.72)');ctx.fillStyle=gradient;ctx.fillRect(0,h*.52,w,h*.48);
  }
  if(narration){
   const bx=66,by=bodyY-27,bw=w-bx*2,bh=h-20-by;
   if(this.interfaceRenderer)this.interfaceRenderer.narration(ctx,bx,by,bw,bh);
  }else if(state.speaker){ctx.font='700 23px '+fontFamily;ctx.textBaseline='top';ctx.fillStyle='#fff';ctx.shadowColor='#000';ctx.shadowBlur=3;ctx.fillText(state.speaker,left,bodyY-33,width);}
  ctx.font=`500 ${size}px ${fontFamily}`;ctx.textBaseline='top';ctx.fillStyle='#fff';ctx.shadowColor='rgba(0,0,0,.8)';ctx.shadowBlur=2;
  drawVisibleLines(ctx,lines,showCompleteText?Infinity:state.visibleGlyphs,left,bodyY,lineHeight);
  if(state.complete||showCompleteText)this.interfaceRenderer?.continuation(ctx,w-60,h-33);
  ctx.restore();
 }
 drawTheaterText(ctx, state, w, h, showCompleteText, colors, fontFamily) {
  const speaker = state.kind === "dialogue" ? state.speaker : "";
  if (!speaker && !state.fullText.trim()) return;

  // The 720p stage scales these sizes to 60/36 at 1080p, 80/48 at 1440p and 120/72 at 2160p.
  const bodySize = 40, nameSize = 24, lineHeight = 48, linesPerPage = 3;
  const left = w / 16, width = w - left * 2, bottom = h - 76;
  ctx.save();
  try {
   ctx.font = "700 " + bodySize + "px " + fontFamily;
   const lines = this.wrappedText(ctx, width, state.fullText);
   let remaining = state.visibleGlyphs, pageStart = 0;
   // Display the page at the current typewriter position, even when preview reveals it in full.
   while (pageStart + linesPerPage < lines.length) {
    const nextPage = pageStart + linesPerPage;
    const glyphs = lines.slice(pageStart, nextPage).reduce((count, row) => count + row.length, 0);
    if (glyphs > 0 && remaining <= glyphs) break;
    pageStart = nextPage;
    remaining -= glyphs;
   }
   const page = lines.slice(pageStart, pageStart + linesPerPage);
   const bodyTop = bottom - page.length * lineHeight;
   const top = speaker ? bodyTop - nameSize - 10 : bodyTop;
   const fadeTop = Math.min(h * .54, top - 56);
   const gradient = ctx.createLinearGradient(0, fadeTop, 0, h);
   gradient.addColorStop(0, "rgba(0,0,0,0)");
   gradient.addColorStop(.72, "rgba(0,0,0,.63)");
   gradient.addColorStop(1, "rgba(0,0,0,.95)");
   ctx.fillStyle = gradient;
   ctx.fillRect(0, fadeTop, w, h - fadeTop);
   ctx.fillStyle = colors.accent;
   ctx.fillRect(w * .05, top + 1, 3, bottom - top - 6);

   ctx.textAlign = "left";
   ctx.textBaseline = "top";
   ctx.shadowColor = "rgba(0,0,0,.85)";
   ctx.shadowBlur = 4 * this.canvas.height / h;
   if (speaker) {
    ctx.font = "700 " + nameSize + "px " + fontFamily;
    ctx.fillStyle = colors.speaker;
    ctx.fillText(speaker, left, top, width);
   }
   ctx.font = "700 " + bodySize + "px " + fontFamily;
   ctx.fillStyle = colors.text;
   drawVisibleLines(ctx, page, showCompleteText ? Infinity : remaining, left, bodyTop, lineHeight);
  } finally {
   ctx.restore();
  }
 }
 /** Line wrapping measures every glyph, so reuse the result while text, font and width repeat. */
 wrappedText(ctx,width,text){
  const key=ctx.font+'|'+width+'|'+text,cached=this.wrapCache.get(key);if(cached)return cached;
  const lines=wrapText(ctx,text,width);if(this.wrapCache.size>=64)this.wrapCache.clear();this.wrapCache.set(key,lines);return lines;
 }
 dispose(){this.interfaceRenderer?.dispose?.();this.actorRenderer?.dispose?.();this.videoFrames?.dispose();for(const image of this.images.values())image.close?.();this.images.clear();this.wrapCache.clear();}
}
