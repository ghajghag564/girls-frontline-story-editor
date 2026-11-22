import {StoryInterfaceRenderer} from './story-interface.mjs';
const storyTypeface = '"Microsoft YaHei", "Noto Sans CJK SC", system-ui, sans-serif';
import {stateAt,graphemes} from './timeline.mjs';
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
export async function loadStoryFonts(){
 await document.fonts.ready;
}
function background(ctx,image,w,h,composition){
 const crop=composition?.background??{};const scale=Math.max(w/image.width,h/image.height)*(crop.scale??1),dw=image.width*scale,dh=image.height*scale;
 ctx.drawImage(image,(w-dw)*(crop.x??.5),(h-dh)*(crop.y??.5),dw,dh);
}
/** Rendering is a pure function of compiled story, time and output size after asset loading. */
export class StageRenderer {
 constructor(canvas,{imageLoader,actorRenderer,interfaceRenderer}={}){
  // Detached export canvases need the stage language for identical glyph selection and spacing.
  if(typeof document!=='undefined'&&'lang' in canvas)canvas.lang=document.documentElement.lang;
  this.canvas=canvas;this.context=canvas.getContext('2d',{alpha:false,willReadFrequently:true});this.imageLoader=imageLoader??(async id=>{
   const response=await fetch(`/assets/background/${encodeURIComponent(id)}/full`);if(!response.ok)throw new Error('背景素材无法读取');return createImageBitmap(await response.blob());
  });this.interfaceRenderer=interfaceRenderer??(typeof document!=='undefined'?new StoryInterfaceRenderer():null);this.actorRenderer=actorRenderer;this.images=new Map();this.wrapCache=new Map();
 }
 async image(id){
  if(!id)return null;
  if(this.images.has(id)){const value=this.images.get(id);this.images.delete(id);this.images.set(id,value);return value;}
  const bitmap=await this.imageLoader(id);this.images.set(id,bitmap);
  while(this.images.size>8){const key=this.images.keys().next().value;this.images.get(key).close?.();this.images.delete(key);}
  return bitmap;
 }
 async render(compiled,time,{ratio='16:9',hideText=false,showCompleteText=false,watermark={enabled:false,text:''}}={}){
  if(ratio!=='16:9')throw new Error('仅支持 16:9 横屏演出');
  const state=stateAt(compiled,time,ratio),ctx=this.context,canvas=this.canvas;
  const w=1280,h=720;
  const previous=await this.image(state?.previousBackground),next=await this.image(state?.background);
  await this.interfaceRenderer?.prepare?.(state,hideText);
  await this.actorRenderer?.prepareFrame?.(state,canvas);
  ctx.resetTransform();ctx.globalAlpha=1;ctx.filter='none';ctx.fillStyle='#000';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.save();ctx.scale(canvas.width/w,canvas.height/h);
  try{
  if(!state)return null;
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
  if(!hideText&&state.kind!=='pause')this.drawText(ctx,state,w,h,showCompleteText);
  if(watermark.enabled&&watermark.text){ctx.save();ctx.font='500 16px '+storyTypeface;ctx.fillStyle='rgba(255,255,255,.7)';ctx.textAlign='right';ctx.textBaseline='top';ctx.shadowColor='rgba(0,0,0,.7)';ctx.shadowBlur=2;ctx.fillText(watermark.text,w-28,24,w-56);ctx.restore();}
  return state;
  }finally{ctx.restore();}
 }
 drawText(ctx,state,w,h,showCompleteText){
  const narration=state.kind==='narration';
  const left=narration?100:107,right=107,width=w-left-right;
  let size=19,lines;
  do{ctx.font=`500 ${size}px ${storyTypeface}`;lines=this.wrappedText(ctx,size,width,state.fullText);if(lines.length<=4||size===16)break;size--;}while(size>=16);
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
  }else if(state.speaker){ctx.font='700 23px '+storyTypeface;ctx.textBaseline='top';ctx.fillStyle='#fff';ctx.shadowColor='#000';ctx.shadowBlur=3;ctx.fillText(state.speaker,left,bodyY-33,width);}
  ctx.font=`500 ${size}px ${storyTypeface}`;ctx.textBaseline='top';ctx.fillStyle='#fff';ctx.shadowColor='rgba(0,0,0,.8)';ctx.shadowBlur=2;
  let remaining=showCompleteText?Infinity:state.visibleGlyphs;
  for(let index=0;index<lines.length;index++){
   const visible=lines[index].slice(0,remaining);remaining=Math.max(0,remaining-lines[index].length);ctx.fillText(visible.join(''),left,bodyY+index*lineHeight);
  }
  if(state.complete||showCompleteText)this.interfaceRenderer?.continuation(ctx,w-60,h-33);
  ctx.restore();
 }
 /** Line wrapping measures every glyph, so reuse the result while text, size and width repeat. */
 wrappedText(ctx,size,width,text){
  const key=size+'|'+width+'|'+text,cached=this.wrapCache.get(key);if(cached)return cached;
  const lines=wrapText(ctx,text,width);if(this.wrapCache.size>=64)this.wrapCache.clear();this.wrapCache.set(key,lines);return lines;
 }
 dispose(){this.interfaceRenderer?.dispose?.();this.actorRenderer?.dispose?.();for(const image of this.images.values())image.close?.();this.images.clear();this.wrapCache.clear();}
}
