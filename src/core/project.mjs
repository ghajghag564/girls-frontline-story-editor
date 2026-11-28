import {assertProjectBudget} from './project-budget.mjs';
import {validateCustomImages,cloneProject,withProjectImages} from './custom-images.mjs';
import {compileProject,validateExport} from './timeline.mjs';
const fail=message=>{throw new Error(message)};
const obj=(v,label)=>v&&typeof v==='object'&&!Array.isArray(v)?v:fail(`${label}格式无效`);
const text=(v,label,max)=>typeof v==='string'&&v.length<=max?v:fail(`${label}格式无效`);
const id=(v,label)=>typeof v==='string'&&/^[a-zA-Z0-9_-]{1,100}$/.test(v)?v:fail(`${label}格式无效`);
const num=(v,label,min,max)=>Number.isFinite(v)&&v>=min&&v<=max?v:fail(`${label}超出范围`);
function actor(value){
 const a=obj(value,'人物');id(a.instanceId,'人物实例');id(a.assetId,'人物素材');
 if(a.expression!==undefined)id(a.expression,'表情');
 for(const [key,min,max] of [['x',-5,5],['y',-5,5],['scale',.01,10],['opacity',0,1],['layer',-100,100]])if(a[key]!==undefined)num(a[key],key,min,max);
 for(const key of ['flip','blink','mouth'])if(a[key]!==undefined&&typeof a[key]!=='boolean')fail('人物动态开关格式无效');
}
export function validateProject(input){
 obj(input,'工程');assertProjectBudget(input);validateCustomImages(input.customImages);const project=cloneProject(input);
 if(project.formatVersion!==1)fail('不支持的工程版本');
 text(project.title,'作品名称',200);text(project.catalogVersion,'素材版本',100);
 if(!Array.isArray(project.scenes)||project.scenes.length===0)fail('场景数量无效');
 const sceneIds=new Set();
 for(const scene of project.scenes){
  obj(scene,'场景');id(scene.id,'场景编号');if(sceneIds.has(scene.id))fail('场景编号重复');sceneIds.add(scene.id);text(scene.title,'场景名称',200);
  if(!Array.isArray(scene.entries))fail('条目列表无效');
  for(const line of scene.entries){
   obj(line,'条目');id(line.id,'条目编号'); // 正文类型及长度已由 assertProjectBudget 检查。
   if(line.speaker!==undefined)text(line.speaker,'说话人',200);
   if(line.speakerInstanceId!==undefined&&line.speakerInstanceId!==null)id(line.speakerInstanceId,'发言人物');
   if(line.speakerInstanceIds!==undefined){if(!Array.isArray(line.speakerInstanceIds)||line.speakerInstanceIds.length>10||new Set(line.speakerInstanceIds).size!==line.speakerInstanceIds.length)fail('齐声发言人物列表无效');for(const value of line.speakerInstanceIds)id(value,'齐声发言人物');}
   num(line.charactersPerSecond??25,'文字速度',1,120);num(line.hold??1.5,'停留时间',0,3600);num(line.transition??.25,'转场时间',0,60);
   if(line.effects){obj(line.effects,'演出效果');if(line.effects.shake){const shake=obj(line.effects.shake,'画面震动');num(shake.amount,'震动强度',0,.03);num(shake.duration,'震动时长',.01,10);}}
   if(line.stage){
    const s=obj(line.stage,'舞台');
    if(s.background!==undefined&&s.background!==null)id(s.background,'背景素材');
    if(s.tint!==undefined&&!/^#[a-fA-F0-9]{6}$/.test(s.tint))fail('场景色调无效');
    if(s.color!==undefined&&!/^#[a-fA-F0-9]{6}$/.test(s.color))fail('舞台颜色无效');
    if(s.actors!==undefined){if(!Array.isArray(s.actors)||s.actors.length>10)fail('同时在场人数超出范围');s.actors.forEach(actor);}
    if(s.compositions){
     obj(s.compositions,'画幅构图');
     for(const [ratio,c] of Object.entries(s.compositions)){
      if(!['16:9','9:16'].includes(ratio))fail('构图比例无效');obj(c,'构图');
      if(c.background){obj(c.background,'背景取景');num(c.background.x??.5,'背景横向取景',0,1);num(c.background.y??.5,'背景纵向取景',0,1);num(c.background.scale??1,'背景缩放',1,5);}
      if(c.actors){obj(c.actors,'人物构图');if(Object.keys(c.actors).length>10)fail('人物构图数量过多');for(const [key,a] of Object.entries(c.actors)){id(key,'人物构图编号');obj(a,'人物构图');for(const [k,min,max] of [['x',-5,5],['y',-5,5],['scale',.01,10]])if(a[k]!==undefined)num(a[k],k,min,max);}}
     }
    }
   }
   if(line.music){obj(line.music,'音乐');if(line.music.assetId!==undefined)id(line.music.assetId,'音乐素材');num(line.music.offset??0,'音乐偏移',0,86400);num(line.music.fadeIn??.5,'音乐淡入',0,60);num(line.music.fadeOut??.5,'音乐淡出',0,60);if(line.music.loop!==undefined&&typeof line.music.loop!=='boolean')fail('音乐循环格式无效');}
  }
 }
 compileProject(project,{budgetChecked:true}); // 输入已在克隆/图片解码前预算；时间线仍检查实际时长。
 if(project.exportSettings){
  obj(project.exportSettings,'导出设置');
  if(project.exportSettings.watermark!==undefined){obj(project.exportSettings.watermark,'水印');text(project.exportSettings.watermark.text??'','水印文字',200);if(typeof project.exportSettings.watermark.enabled!=='boolean')fail('水印开关无效');}
  // Save unfinished export ranges; validate against the current timeline only at export.
  num(project.exportSettings.start??0,'导出起点',0,86400);
  if(project.exportSettings.end!==null&&project.exportSettings.end!==undefined)num(project.exportSettings.end,'导出终点',0,86400);
  // Accept legacy project data for opening; all new exports use landscape.
  if(project.exportSettings.ratio==='9:16')project.exportSettings.ratio='16:9';
  validateExport({...project.exportSettings,start:0,end:1},1);
 }
 return project;
}
export function missingResources(project,catalog){
 catalog=withProjectImages(catalog,project);
 const missing=new Map();const available=new Map();
 const videos=catalog.videos??[];
 for(const [kind,list] of Object.entries({background:[...(catalog.backgrounds??[]),...videos],video:videos,actor:catalog.characters??[],music:catalog.music??[]}))for(const item of list)available.set(kind+':'+item.id,item);
 const check=(kind,assetId,lineId)=>{if(assetId&&!available.has(kind+':'+assetId)){const excluded=kind==='background'?catalog.unavailableBackgrounds?.find(x=>x.id===assetId):null;missing.set(kind+':'+assetId,{kind,assetId,lineId,...(excluded?{name:excluded.name,reason:excluded.reason}: {})});}};
 for(const scene of project.scenes)for(const line of scene.entries){
  if(line.kind==='cutscene'){
   const clip=line.video,material=available.get('video:'+clip.assetId);
   check('video',clip.assetId,line.id);
   if(material&&(Math.abs(material.seconds-clip.seconds)>.05||clip.audioId&&clip.audioId!==material.audioId)){
    missing.set('video:'+clip.assetId,{kind:'video',assetId:clip.assetId,lineId:line.id,name:material.name,reason:'视频记录已变更，请重新选择素材。'});
   }
   check('music',clip.audioId,line.id);
   continue;
  }
  check('background',line.stage?.background,line.id);check('music',line.music?.assetId,line.id);
  for(const actor of line.stage?.actors??[]){check('actor',actor.assetId,line.id);const definition=available.get('actor:'+actor.assetId);if(actor.expression&&definition&&!definition.expressions?.some(e=>e.id===actor.expression))missing.set('expression:'+actor.expression,{kind:'expression',assetId:actor.expression,lineId:line.id});}
 }
 return [...missing.values()];
}

