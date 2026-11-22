import {setupCredits,renderNoticeBody,teamCredits} from '/credits.mjs';
import {IMAGE_LIMITS,cloneProject,withProjectImages} from '/core/custom-images.mjs';
import {speakerIds,localizeLegacySpeakers,characterDisplayRecord} from '/core/speakers.mjs';
import {setupImageImport,loadBackgroundImage} from '/image-import.mjs';
import {setupTutorial} from '/tutorial.mjs';
import {rightsNotice} from '/core/rights-notice.mjs';
import {ProjectSaveQueue} from '/core/project-save-queue.mjs';
import {moveScene,moveLine,duplicateScene} from '/core/story-order.mjs';
import {defaultActorPlacement,defaultStagePositions} from '/core/actor-state.mjs';
import * as session from '/bootstrap.mjs';
const {token}=session;
import {compileProject,stateAt,validateExport,hasSpeechPause,endsWithSpeechPause} from '/core/timeline.mjs';
import {StageRenderer,loadStoryFonts} from '/core/stage.mjs';
import {exportVideo,cancelExport,exportCapabilities} from '/export.mjs';
import {MusicTransport} from '/music.mjs';
import {ActorRenderer} from '/actors.mjs';
const $=id=>document.getElementById(id),clone=value=>value?.formatVersion===1&&Array.isArray(value.scenes)?cloneProject(value):structuredClone(value),uid=()=>crypto.randomUUID(),fmt=t=>`${Math.floor(t/60).toString().padStart(2,'0')}:${Math.floor(t%60).toString().padStart(2,'0')}`;
const node=(tag,text,className)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(className)e.className=className;return e;};
const button=(text,action)=>{const e=node('button',text);e.onclick=()=>run(action);return e;};
const run=action=>Promise.resolve().then(action).catch(reportError);
async function api(route,{method='GET',body}={}){const response=await fetch('/api'+route,{method,headers:{'x-gf2-token':token,'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});const value=await response.json();if(!response.ok){const error=new Error(value.error??'本地服务请求失败');error.status=response.status;throw error;}return value;}
let catalog,baseCatalog,localExample,actorRenderer,openImageImport,tutorial,project,compiled,projectId,revision=0,selectedScene,selectedLine,time=0,transport,renderer;
let dirty=false,editVersion=0,undo=[],redo=[],lastEditKey='',lastEditAt=0,saveTimer,toastTimer;
let revealed=true,hiddenText=false,renderPending=false,rendering=false,pickerType='background',pickerGroup=null,ticking=false,lastRenderKey='';
const saves=new ProjectSaveQueue(api);let projectSwitching=false,exitInProgress=false,editorExited=false;
async function switchProject(action,{savingCopy=false}={}){
 if(projectSwitching){toast('正在切换工程，请稍候');return;}
 projectSwitching=true;pause();cancelAutoSave();
 const surfaces=[document.querySelector('header'),document.querySelector('.workspace'),$('author-credit')].filter(Boolean);
 for(const surface of surfaces)surface.inert=true;
 try{
  await saves.pending.catch(()=>{});
  if(project&&(dirty||savingCopy)){
   try{await persist(false);}
   catch(error){if(!savingCopy||![404,409].includes(error.status))throw error;}
  }
  return await action();
 }
 finally{for(const surface of surfaces)surface.inert=false;projectSwitching=false;}
}
const defaults=()=>({ratio:'16:9',resolution:1080,fps:30,bitrateMbps:16,codec:'h264',start:0,end:null,watermark:{enabled:false,text:''}});
const blankLine=(kind='dialogue')=>({id:uid(),kind,speaker:'',text:'',charactersPerSecond:25,hold:1.5,transition:.25,music:{op:'inherit'}});
const blankProject=()=>({formatVersion:1,actorFramingRevision:2,title:'未命名作品',catalogVersion:catalog.version,scenes:[{id:uid(),title:'场景一',entries:[blankLine()]}],exportSettings:defaults()});
const scene=()=>project.scenes.find(s=>s.id===selectedScene);
const line=()=>scene()?.entries.find(l=>l.id===selectedLine);
const entry=()=>compiled.entries.find(e=>e.line.id===selectedLine);
function toast(message){$('toast').textContent=message;$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,3500);}
function reportError(error){console.error(error);$('save-status').classList.add('error-status');$('save-status').textContent=error.message;toast(error.message);}
function message(title,text,actions=[['知道了',()=>{}]]){return new Promise(resolve=>{
 $('message-title').textContent=title;$('message-text').textContent=text;$('message-actions').replaceChildren();
 for(const [label,action] of actions)$('message-actions').append(button(label,async()=>{$('message-dialog').close();await action();resolve(label);}));
 $('message-dialog').showModal();$('message-dialog').oncancel=()=>resolve('取消');
});}
function setSaveState(text){$('save-status').classList.remove('error-status');$('save-status').textContent=text;}
function cancelAutoSave(){clearTimeout(saveTimer);saveTimer=null;}
function scheduleAutoSave(){cancelAutoSave();saveTimer=setTimeout(()=>{saveTimer=null;run(()=>persist(false));},900);}
function markDirty(){dirty=true;editVersion++;setSaveState('有未保存修改');scheduleAutoSave();}
function pause(){if(transport){time=transport.pause();$('play').textContent='▶ 播放';}ticking=false;}
function edit(action,{key='',fields=false}={}){
 pause();const now=performance.now();
 if(!key||lastEditKey!==key||now-lastEditAt>750){undo.push(clone(project));if(undo.length>100)undo.shift();}
 lastEditKey=key;lastEditAt=now;redo=[];action();markDirty();recompile();
 if(key==='line-text')updateMouthPunctuationHint(line());
 if(key==='speaker'||key==='line-text'){
  const row=$('scene-list').querySelector('.line-item.active');
  if(row&&row.dataset.lineId===selectedLine)updateOutlineText(row,line());else renderOutline();
 }else if(key!=='title')renderOutline();
 if(fields)renderInspector();updateSettingsSummary();selectPreviewTime();queueRender();
}
let catalogImages;
function recompile(){
 if(catalogImages!==project.customImages){
  catalogImages=project.customImages;
  catalog=catalogImages?.length?withProjectImages(baseCatalog,project):baseCatalog;
  actorRenderer.definitions=new Map(catalog.characters.map(x=>[x.id,x]));
 }
 compiled=compileProject(project);$('scrub').max=compiled.duration||1;$('undo').disabled=!undo.length;$('redo').disabled=!redo.length;const selected=entry();$('entry-duration').textContent=selected?`本句约 ${(selected.end-selected.start).toFixed(1)} 秒 · 作品共 ${compiled.duration.toFixed(1)} 秒`:'';}
function selectPreviewTime(){const e=entry();time=e?Math.min(e.end,e.start+e.transition+.00001):0;if(transport)transport.position=time;revealed=true;}
function historyStep(from,to){if(!from.length)return;pause();to.push(clone(project));project=from.pop();ensureSelection();markDirty();recompile();renderAll();}
function ensureSelection(){if(!project.scenes.some(s=>s.id===selectedScene))selectedScene=project.scenes[0]?.id;if(!scene()?.entries.some(l=>l.id===selectedLine))selectedLine=scene()?.entries[0]?.id;}
function renderAll(){$('delete-current-project').disabled=!projectId;ensureSelection();$('project-title').value=project.title;renderOutline();renderInspector();renderSettings();selectPreviewTime();queueRender();}
function select(id,sceneId){pause();selectedScene=sceneId;selectedLine=id;revealed=true;renderOutline();renderInspector();selectPreviewTime();queueRender();}
let outlineDrag=null;
function clearOutlineDrop(){document.querySelectorAll('#scene-list .drop-before,#scene-list .drop-after').forEach(e=>e.classList.remove('drop-before','drop-after'));}
function orderEdit(change,selection){const next=clone(project);if(!change(next))return;edit(()=>{project=next;if(selection){selectedScene=selection.scene;selectedLine=selection.line;}},{fields:true});}
function bindOutlineDrag(handle,kind,id){
 handle.draggable=true;handle.ondragstart=event=>{outlineDrag={kind,id};event.dataTransfer.effectAllowed='move';event.dataTransfer.setData('text/x-gf2-'+kind,id);};
 handle.ondragend=()=>{outlineDrag=null;clearOutlineDrop();};
}
function bindOutlineDrop(target,kind,apply,end=false){
 target.ondragover=event=>{if(outlineDrag?.kind!==kind)return;event.preventDefault();event.stopPropagation();event.dataTransfer.dropEffect='move';clearOutlineDrop();const after=end||event.clientY>target.getBoundingClientRect().top+target.getBoundingClientRect().height/2;target.classList.add(after?'drop-after':'drop-before');};
 target.ondragleave=event=>{if(!target.contains(event.relatedTarget)){target.classList.remove('drop-before','drop-after');}};
 target.ondrop=event=>{if(outlineDrag?.kind!==kind)return;event.preventDefault();event.stopPropagation();const moving=outlineDrag.id,after=end||event.clientY>target.getBoundingClientRect().top+target.getBoundingClientRect().height/2;outlineDrag=null;clearOutlineDrop();run(()=>apply(moving,after));};
}
function updateOutlineText(row,l){
 const title=l.kind==='narration'?'旁白':l.kind==='pause'?(l.stage?.background===null&&l.stage?.color==='#000000'?'黑场':'停顿'):l.speaker||'角色台词';
 row.querySelector('strong').textContent=title;
 row.querySelector('.excerpt').textContent=l.kind==='pause'?'停留 '+(l.hold??1.5)+' 秒':l.text||'（等待输入）';
}
function renderOutline(){
 const list=$('scene-list');list.replaceChildren();let count=0;
 project.scenes.forEach((s,sceneIndex)=>{
  const section=node('section'),head=node('div',undefined,'scene-heading'),title=node('input'),controls=node('div',undefined,'scene-actions');section.dataset.sceneId=s.id;title.value=s.title;title.setAttribute('aria-label',`场景 ${sceneIndex+1} 名称`);title.onchange=()=>edit(()=>{s.title=title.value||'未命名场景';});
  const handle=button('⠿',()=>select(s.entries[0]?.id,s.id));handle.className='scene-drag-handle';handle.setAttribute('aria-label','拖动场景 '+s.title);handle.title='拖动调整场景顺序，也可使用上下按钮';bindOutlineDrag(handle,'scene',s.id);
  const up=button('↑',()=>{if(sceneIndex>0)orderEdit(p=>moveScene(p,s.id,project.scenes[sceneIndex-1].id));}),down=button('↓',()=>{if(sceneIndex<project.scenes.length-1)orderEdit(p=>moveScene(p,s.id,project.scenes[sceneIndex+1].id,true));});up.disabled=sceneIndex===0;down.disabled=sceneIndex===project.scenes.length-1;up.setAttribute('aria-label','上移场景 '+s.title);down.setAttribute('aria-label','下移场景 '+s.title);
  const copy=button('复制',()=>edit(()=>{const c=duplicateScene(project,s.id,uid);selectedScene=c.id;selectedLine=c.entries[0]?.id;},{fields:true}));copy.setAttribute('aria-label','复制场景 '+s.title);
  const remove=button('×',()=>edit(()=>{project.scenes.splice(sceneIndex,1);if(!project.scenes.length)project.scenes.push({id:uid(),title:'场景一',entries:[blankLine()]});ensureSelection();},{fields:true}));remove.setAttribute('aria-label','删除场景 '+s.title);
  controls.append(up,down,copy,remove);head.append(handle,title,controls);bindOutlineDrop(head,'scene',(id,after)=>orderEdit(p=>moveScene(p,id,s.id,after)));section.append(head);
  s.entries.forEach((l,index)=>{
   count++;const row=button('',()=>select(l.id,s.id));row.className='line-item'+(l.id===selectedLine?' active':'');row.dataset.lineId=l.id;row.setAttribute('aria-current',l.id===selectedLine?'true':'false');row.title='拖动到台词上半部或下半部排序；Alt+↑/↓ 在本场景内移动';
   const copy=node('span',undefined,'line-copy');copy.append(node('strong'),node('span',undefined,'excerpt'));row.append(node('span',String(count).padStart(2,'0'),'number'),copy);updateOutlineText(row,l);
   bindOutlineDrag(row,'line',l.id);bindOutlineDrop(row,'line',(id,after)=>orderEdit(p=>moveLine(p,id,s.id,l.id,after),{scene:s.id,line:id}));
   row.onkeydown=event=>{if(!event.altKey||!['ArrowUp','ArrowDown'].includes(event.key))return;event.preventDefault();const next=index+(event.key==='ArrowDown'?1:-1);if(!s.entries[next])return;orderEdit(p=>moveLine(p,l.id,s.id,s.entries[next].id,next>index),{scene:s.id,line:l.id});document.querySelector('[data-line-id="'+CSS.escape(l.id)+'"]')?.focus();};section.append(row);
  });
  const end=button(s.entries.length?'拖入本场景末尾':'空场景 · 拖入台词或添加下一句',()=>select(s.entries.at(-1)?.id,s.id));end.className='scene-drop-end';end.dataset.dropScene=s.id;bindOutlineDrop(end,'line',id=>orderEdit(p=>moveLine(p,id,s.id),{scene:s.id,line:id}),true);section.append(end);list.append(section);
 });
 $('undo').disabled=!undo.length;$('redo').disabled=!redo.length;
}
function renderInspector(){
 const panel=document.querySelector('.inspector'),top=panel.scrollTop,left=panel.scrollLeft;
 const active=document.activeElement,focusKey=panel.contains(active)?active.dataset.inspectorFocus:undefined;
 try{return updateInspector();}
 finally{
  // Rebuilt controls keep keyboard focus without asking the browser to reveal them.
  if(focusKey&&!active.isConnected){
   const replacement=panel.querySelector('[data-inspector-focus="'+CSS.escape(focusKey)+'"]');
   if(replacement&&!replacement.disabled)replacement.focus({preventScroll:true});
  }
  panel.scrollLeft=left;panel.scrollTop=top;
 }
}
function updateMouthPunctuationHint(line){
 const hint=$('mouth-punctuation-hint');
 if(line?.kind!=='dialogue'||endsWithSpeechPause(line.text)){hint.hidden=true;return;}
 const message=hasSpeechPause(line.text)
  ?'要让角色在句末停口，请在末尾加上句号、问号或感叹号。'
  :'请在需要停口的地方加标点，例如“收到，现在出发。”逗号让角色稍停，句号让角色收口。';
 if(hint.textContent!==message)hint.textContent=message;
 hint.hidden=false;
}
function updateInspector(){
 const l=line(),e=entry();updateMouthPunctuationHint(l);document.querySelectorAll('.inspector input,.inspector select,.inspector textarea,.inspector button').forEach(x=>x.disabled=!l);if(!l)return;
 $('line-kind').value=l.kind;$('speaker').value=l.speaker??'';$('speaker-label').hidden=l.kind!=='dialogue';$('line-text').value=l.text;$('line-text').disabled=l.kind==='pause';
 const shakeValue=String(l.effects?.shake?.amount??0);$('shake-amount').querySelector('option[data-custom]')?.remove();if(![...$('shake-amount').options].some(o=>o.value===shakeValue)){const option=node('option','自定义强度');option.value=shakeValue;option.dataset.custom='true';$('shake-amount').append(option);}$('shake-amount').value=shakeValue;$('shake-duration').value=l.effects?.shake?.duration??.5;
 $('text-speed').value=l.charactersPerSecond??25;$('hold').value=l.hold??1.5;$('transition').value=l.transition??.25;
 const bg=catalog.backgrounds.find(x=>x.id===e?.stage.background);$('choose-background').textContent=(l.stage?.background===undefined?'继承 · ':'')+(bg?.name??'纯色画面');$('stage-color').value=e?.stage.color??'#000000';
 $('restore-background').disabled=!bg;
 const tint=l.stage?.tint??'';$('stage-tint').querySelector('[data-custom]')?.remove();if(![...$('stage-tint').options].some(o=>o.value===tint)){const option=node('option','已保存色调');option.value=tint;option.dataset.custom='true';$('stage-tint').append(option);}$('stage-tint').value=tint;
 const crop=e?.stage.compositions?.[project.exportSettings.ratio]?.background??{};$('crop-x').value=crop.x??.5;$('crop-y').value=crop.y??.5;$('crop-scale').value=crop.scale??1;
 $('music-op').value=l.music?.op??'inherit';const track=catalog.music.find(x=>x.id===l.music?.assetId);$('choose-music').textContent=track?.name??'选择音乐';$('choose-music').hidden=(l.music?.op??'inherit')!=='play';$('music-options').hidden=(l.music?.op??'inherit')!=='play';
 $('music-volume').value=(l.music?.volume??.7)*100;$('music-loop').checked=l.music?.loop??true;$('fade-in').value=l.music?.fadeIn??.5;$('fade-out').value=l.music?.fadeOut??.5;
 $('entry-duration').textContent=e?`本句约 ${(e.end-e.start).toFixed(1)} 秒 · 作品共 ${compiled.duration.toFixed(1)} 秒`:'';
 renderActors();
}
const defaultBackgroundCrop = Object.freeze({x:.5,y:.5,scale:1});
function setBackgroundCrop(crop=defaultBackgroundCrop){
 const l=line();l.stage??={};l.stage.compositions??=clone(entry()?.stage.compositions??{});l.stage.compositions['16:9']??={};l.stage.compositions['16:9'].background=clone(crop);
}
function actorsForEdit(){line().stage??={};line().stage.actors??=clone(entry()?.stage.actors??[]);return line().stage.actors;}
function moveActor(id,changes){const ratio=project.exportSettings.ratio,l=line();l.stage??={};l.stage.compositions??=clone(entry()?.stage.compositions??{});l.stage.compositions[ratio]??={};l.stage.compositions[ratio].actors??={};l.stage.compositions[ratio].actors[id]={...l.stage.compositions[ratio].actors[id],...changes};}
function actorLabel(definition){
 return definition.styleName&&definition.name!==definition.styleName?definition.name+' · '+definition.styleName:definition.name;
}
function actorCapabilities(definition){
 const parameters=definition.parameters??[],usable=id=>parameters.some(p=>p.id===id&&p.max>p.min);
 return {mouth:usable('ParamMouthOpenY'),blink:!!definition.eyeBlink?.enabled&&(definition.eyeBlink.parameterIds??[]).some(usable)};
}
function expressionAvailabilityNote(definition,expression){
 if(!expression)return '';const ids=new Set((definition.parameters??[]).map(p=>p.id)),missing=(expression.parameters??[]).filter(p=>!ids.has(p.id));
 if(!missing.length)return '';
 return missing.length===expression.parameters.length?'此模型表情在当前造型中与默认姿态一致。':'此造型只能显示该模型表情的部分变化，以预览为准。';
}
function expressionCountNote(definition){if(definition.source==='custom')return '自定义静态立绘，可移动、缩放、翻转与发言高亮。';if(!definition.expressionsComplete)return '此造型的模型表情尚未完整接入。';return definition.expressions.length?'默认姿态与 '+definition.expressions.length+' 个模型表情':'此模型未提供额外表情，可使用模型默认姿态。';}
// The legacy single-speaker field remains readable by older project versions.
function setSpeakers(ids,chorus){
 const l=line(),actors=l.stage?.actors??entry()?.stage.actors??[],active=new Set(actors.map(a=>a.instanceId));ids=[...new Set(ids)].filter(id=>active.has(id));if(!chorus)ids=ids.slice(0,1);
 l.speakerInstanceId=ids[0]??null;if(chorus)l.speakerInstanceIds=ids;else delete l.speakerInstanceIds;
 const names=ids.map(id=>{const a=actors.find(a=>a.instanceId===id);return catalog.characters.find(d=>d.id===a.assetId)?.name??project.customImages?.find(d=>d.id===a.assetId)?.name??'人物';});if(names.length)l.speaker=[...new Set(names)].join('、').slice(0,200);
}
function addActor(definition){
 const actors=actorsForEdit();if(actors.length>=10)throw new Error('最多同时添加 10 人');const a={instanceId:uid(),assetId:definition.id,...defaultActorPlacement(definition),opacity:1,layer:actors.length};actors.push(a);
 const chorus=Array.isArray(line().speakerInstanceIds);setSpeakers(chorus?[...speakerIds(line()),a.instanceId]:[a.instanceId],chorus);
}
function renderChorus(actors){
 const l=line(),chorus=Array.isArray(l?.speakerInstanceIds),ids=speakerIds(l),dialogue=l?.kind==='dialogue';
 $('chorus-enabled').checked=chorus;$('chorus-enabled').disabled=!dialogue;$('chorus-panel').hidden=!chorus||!dialogue;$('single-speaker-label').hidden=chorus||!dialogue;$('chorus-actors').replaceChildren();
 for(const actor of actors){const definition=catalog.characters.find(d=>d.id===actor.assetId),label=node('label',undefined,'compact'),check=node('input');check.type='checkbox';check.value=actor.instanceId;check.checked=ids.includes(actor.instanceId);check.dataset.inspectorFocus='chorus/'+actor.instanceId;check.onchange=()=>edit(()=>setSpeakers(check.checked?[...speakerIds(line()),actor.instanceId]:speakerIds(line()).filter(id=>id!==actor.instanceId),true),{fields:true});label.append(check,document.createTextNode(definition?actorLabel(definition):actor.assetId));$('chorus-actors').append(label);}
 const count=actors.filter(a=>ids.includes(a.instanceId)).length;$('chorus-count').textContent=!actors.length?'请先添加在场人物。':count>=2?`已选 ${count} 人，同时高亮并同步使用可用口型。`:count===1?'已选 1 人，再勾选至少 1 人即可齐声发言。':'尚未选择发言人物；此时作为画外发言。';
}
function renderActors(){
 const advancedOpen=new Set([...document.querySelectorAll('#actors .actor-control')].filter(b=>b.querySelector('.actor-advanced')?.open).map(b=>b.dataset.instanceId));
 const actors=entry()?.stage.actors??[],selected=$('stage-actor').value,content=document.createDocumentFragment();content.append(node('p','调整人物在横屏画面中的位置。','muted'));$('speaker-actor').replaceChildren();$('stage-actor').replaceChildren();
 const empty=node('option','画外人物／无人高亮');empty.value='';$('speaker-actor').append(empty);
 for(const actor of actors){
  const definition=catalog.characters.find(x=>x.id===actor.assetId),name=definition?actorLabel(definition):actor.assetId;
  for(const select of [$('speaker-actor'),$('stage-actor')]){const option=node('option',name);option.value=actor.instanceId;select.append(option);}
  const box=node('section',undefined,'actor-control');box.dataset.assetId=actor.assetId;box.dataset.instanceId=actor.instanceId;box.append(node('strong',name));
  if(!definition){box.append(node('p','缺少原人物素材，已保留引用。','muted'));content.append(box);continue;}
  const capabilities=actorCapabilities(definition);box.append(node('small',expressionCountNote(definition),'capability-note'));
  const expression=node('select');expression.setAttribute('aria-label',name+' 模型表情');const def=node('option',definition.source==='custom'?'导入图片（静态）':'模型默认姿态');def.value='';expression.append(def);
  for(const item of definition.expressions){const option=node('option',item.name);option.title=[item.name,expressionAvailabilityNote(definition,item)].filter(Boolean).join(' · ');option.value=item.id;expression.append(option);}expression.value=actor.expression??'';expression.disabled=!definition.expressions.length;expression.onchange=()=>edit(()=>{const target=actorsForEdit().find(x=>x.instanceId===actor.instanceId);if(expression.value)target.expression=expression.value;else delete target.expression;},{fields:true});box.append(expression);const expressionNote=expressionAvailabilityNote(definition,definition.expressions.find(e=>e.id===actor.expression));if(expressionNote)box.append(node('small',expressionNote,'capability-note'));if(definition.expressions.length)box.append(button('查看表情预览',()=>expressionPicker(actor,definition)));if(!definition.expressionsComplete)box.append(node('small','此造型的模型表情尚未接入。','muted'));
  const placement=node('div',undefined,'actor-positions');for(const [label,x] of defaultStagePositions)placement.append(button(label,()=>edit(()=>moveActor(actor.instanceId,{x}),{fields:true})));box.append(placement);
  const composition=entry().stage.compositions?.[project.exportSettings.ratio]?.actors?.[actor.instanceId]??{};
  const vertical=node('div',undefined,'actor-positions');for(const [label,delta] of [['上移',-.03],['下移',.03]]){const control=button(label,()=>edit(()=>moveActor(actor.instanceId,{y:Math.max(-.5,Math.min(2,Math.round(((composition.y??actor.y??1)+delta)*100)/100))}),{fields:true}));control.setAttribute('aria-label',name+' '+label);vertical.append(control);}box.append(vertical);box.append(button('恢复默认大小与高度',()=>edit(()=>{const {y,scale}=defaultActorPlacement(definition);moveActor(actor.instanceId,{y,scale});},{fields:true})));
  const sizeLabel=node('label','人物大小'),sizeOutput=node('output'),sizeSlider=node('input'),defaultScale=defaultActorPlacement(definition).scale,currentScale=composition.scale??actor.scale??1;
  sizeSlider.type='range';sizeSlider.min=Math.min(.1,currentScale);sizeSlider.max=Math.max(3,Math.ceil(currentScale));sizeSlider.step='.01';sizeSlider.value=currentScale;sizeSlider.dataset.actorScale='true';sizeSlider.setAttribute('aria-label',name+' 人物缩放');sizeOutput.textContent=Math.round(currentScale/defaultScale*100)+'%';sizeOutput.title='相对于默认大小';
  sizeSlider.oninput=()=>{const value=Number(sizeSlider.value);sizeOutput.textContent=Math.round(value/defaultScale*100)+'%';const numeric=box.querySelector('[data-actor-property="scale"]');if(numeric)numeric.value=value;edit(()=>moveActor(actor.instanceId,{scale:value}),{key:actor.instanceId+'scale-slider'});};sizeLabel.append(sizeOutput,sizeSlider);box.append(sizeLabel);
  const advanced=node('details',undefined,'actor-advanced');advanced.open=advancedOpen.has(actor.instanceId);advanced.append(node('summary','精细调整：位置、透明度与层级'));
  for(const [key,title,min,max,step] of [['x','水平位置',-1,2,.01],['y','垂直位置',-.5,2,.01],['scale','人物大小',.01,10,.01],['opacity','不透明度',0,1,.01],['layer','前后层级',-10,10,1]]){
   const label=node('label',title),input=node('input');input.type='number';input.min=min;input.max=max;input.step=step;input.value=composition[key]??actor[key]??({x:.5,y:1,scale:1,opacity:1,layer:0}[key]);input.setAttribute('aria-label',name+' '+title);input.dataset.actorProperty=key;input.onchange=()=>{if(!input.checkValidity()||input.value==='')return;edit(()=>{if(['x','y','scale'].includes(key))moveActor(actor.instanceId,{[key]:Number(input.value)});else actorsForEdit().find(x=>x.instanceId===actor.instanceId)[key]=Number(input.value);},{key:actor.instanceId+key,fields:true});};label.append(input);advanced.append(label);
  }
  for(const [key,title,defaultValue] of [['flip','水平翻转',false],['blink','自然眨眼',true],['mouth','发言时嘴部动态',true]]){
   const label=node('label',undefined,'compact'),input=node('input'),supported=key==='flip'||capabilities[key];input.type='checkbox';input.dataset.actorControl=key;input.checked=supported&&(actor[key]??defaultValue);input.disabled=!supported;
   input.onchange=()=>{if(!supported)return;edit(()=>{actorsForEdit().find(x=>x.instanceId===actor.instanceId)[key]=input.checked;});};label.append(input,document.createTextNode(title));box.append(label);
   const explanation=key==='blink'&&!supported?'此造型未提供可用的自动眨眼。':key==='mouth'?(!supported?'此造型不支持嘴部动态。':'口型随对白时间和标点变化。'):'';
   if(explanation){const note=node('small',explanation,'capability-note');note.id='capability-'+actor.instanceId+'-'+key;input.setAttribute('aria-describedby',note.id);box.append(note);}
  }
  box.append(advanced);
  box.append(button('从本句退场（删除）',()=>edit(()=>{line().stage??={};line().stage.actors=actorsForEdit().filter(x=>x.instanceId!==actor.instanceId);if(speakerIds(line()).includes(actor.instanceId))setSpeakers(speakerIds(line()).filter(id=>id!==actor.instanceId),Array.isArray(line().speakerInstanceIds));},{fields:true})));
  for(const control of box.querySelectorAll('button,input,select,summary')){
   const key=control.dataset.actorProperty??control.dataset.actorControl??control.getAttribute('aria-label')??control.textContent;
   control.dataset.inspectorFocus=actor.instanceId+'/'+control.tagName+'/'+key;
  }
  content.append(box);
 }
 $('actors').replaceChildren(content);renderChorus(actors);
 $('speaker-actor').value=line()?.speakerInstanceId??'';if(actors.some(x=>x.instanceId===selected))$('stage-actor').value=selected;
 $('add-actor').disabled=actors.length>=10;$('import-actor').disabled=actors.length>=10;$('stage-actor').disabled=!actors.length;
}
let expressionPickerVersion=0;
async function expressionPicker(actor,definition){
 actor=entry()?.stage.actors.find(x=>x.instanceId===actor.instanceId)??actor;
 const version=++expressionPickerVersion,actorRenderer=new ActorRenderer(catalog);$('expression-title').textContent=definition.name+' · 模型表情';$('expression-grid').replaceChildren();$('expression-dialog').showModal();
 const close=()=>{expressionPickerVersion++;$('expression-dialog').close();};$('close-expressions').onclick=close;$('expression-dialog').oncancel=()=>{expressionPickerVersion++;};
 const options=[{id:'',name:'模型默认姿态'},...definition.expressions];
 try{for(let i=0;i<options.length;i++){
  if(version!==expressionPickerVersion)break;const option=options[i],card=node('button',undefined,'expression-card'),canvas=node('canvas');canvas.width=160;canvas.height=180;canvas.setAttribute('aria-label',option.name+'预览');const note=expressionAvailabilityNote(definition,option);card.title=[option.name,note].filter(Boolean).join(' · ');card.append(canvas,node('span',option.name));if(note)card.append(node('small',note,'capability-note'));card.setAttribute('aria-pressed',String((actor.expression??'')===option.id));
  card.onclick=()=>run(()=>{edit(()=>{const target=actorsForEdit().find(x=>x.instanceId===actor.instanceId);if(!target)throw new Error('此人物已不在当前句中');if(option.id)target.expression=option.id;else delete target.expression;},{fields:true});close();});$('expression-grid').append(card);
  const instance={...actor,expression:option.id||undefined,x:.5,y:2.15,scale:2.15,opacity:1,blink:false,mouth:false,flip:false},state={actors:[instance],time:0,speaking:false,entry:{start:0,transition:0,speed:25,chars:[],line:{}}};
  await actorRenderer.prepareFrame(state,canvas);if(version!==expressionPickerVersion)break;actorRenderer.draw(canvas.getContext('2d'),instance,{w:canvas.width,h:canvas.height,brightness:1});card.dataset.ready='true';$('expression-progress').textContent=`已显示 ${i+1} / ${options.length} 个表情预览`;
 }}finally{actorRenderer.dispose();}
}
function addLine(kind,black=false){const current=line();edit(()=>{const s=scene();const next=blankLine(kind??current?.kind??'dialogue');next.speaker=current?.speaker??'';next.speakerInstanceId=current?.speakerInstanceId??null;if(Array.isArray(current?.speakerInstanceIds))next.speakerInstanceIds=[...current.speakerInstanceIds];if(black){next.stage={background:null,color:'#000000',actors:[]};next.speakerInstanceId=null;delete next.speakerInstanceIds;next.transition=.5;}s.entries.splice(Math.max(0,s.entries.findIndex(l=>l.id===selectedLine)+1),0,next);selectedLine=next.id;},{fields:true});$('line-text').focus();}
async function persist(manual){
 cancelAutoSave();const version=editVersion;
 setSaveState(manual?'正在保存…':'正在自动保存…');
 const {record,session,current}=await saves.save(project,{manual});
 if(current){projectId=session.id;revision=session.revision;$('delete-current-project').disabled=!projectId;
  if(version===editVersion){if(manual)dirty=false;setSaveState(manual?'已保存':'自动恢复副本已保存');}
  else setSaveState('有更新的修改，等待保存');
 }return record;
}
async function exitEditor(saveBeforeExit){
 if(exitInProgress||projectSwitching||editorExited)return;
 exitInProgress=true;pause();stopAuditions();cancelAutoSave();
 const surfaces=[document.querySelector('header'),document.querySelector('.workspace'),$('author-credit')].filter(Boolean);
 for(const surface of surfaces)surface.inert=true;
 try{
  // Finish writes already requested before shutdown; plain exit does not start a save.
  await saves.pending.catch(()=>{});
  if(!saveBeforeExit&&dirty){
   const choice=await message('不保存并退出？','当前修改尚未手动保存。退出后保留上次手动保存的工程和已有自动恢复副本；尚未自动备份的修改会丢失。',[['继续编辑',()=>{}],['不保存并退出',()=>{}]]);
   if(choice!=='不保存并退出')return;
  }
  if(saveBeforeExit)await persist(true);
  await api('/shutdown',{method:'POST',body:{}});
  editorExited=true;dirty=false;
  document.body.replaceChildren(node('main',saveBeforeExit?'工程已保存，编辑器已退出。可以关闭此页；下次双击“启动编辑器”继续创作。':'编辑器已退出，未执行手动保存。已有自动恢复副本会保留。可以关闭此页；下次双击“启动编辑器”继续创作。','tip'));
 }finally{
  exitInProgress=false;
  if(!editorExited){
   for(const surface of surfaces)surface.inert=false;
   if(dirty)scheduleAutoSave();
  }
 }
}
async function openRecord(id){return switchProject(async()=>{
 const record=await api('/projects/'+id);let data=record.project;
 if(record.recovery)await message('发现自动恢复副本','这个工程有尚未手动保存的修改，可以恢复继续编辑。',[['打开手动保存版',()=>{}],['恢复修改',()=>{data=record.recovery.project;}] ]);
 const named=localizeLegacySpeakers(data,baseCatalog.characters);
 project=named;project.exportSettings??=defaults();project.exportSettings.ratio='16:9';projectId=id;revision=record.revision;saves.activate(id,revision);undo=[];redo=[];dirty=data!==record.project||named!==data;editVersion++;recompile();selectedScene=project.scenes[0]?.id;selectedLine=project.scenes[0]?.entries[0]?.id;renderAll();setSaveState(named!==data?'已更新旧工程的发言姓名，请保存':dirty?'已恢复未保存修改':'已打开');
 if(record.missing.length)await message('工程有缺失素材',`已保留工程引用，未替换素材。缺失 ${record.missing.length} 项：\n${record.missing.slice(0,8).map(x=>(x.name??x.assetId)+(x.reason?'：'+x.reason:'（缺少'+x.kind+'素材）')).join('\n')}`);
});}
async function newProject(data,options){return switchProject(async()=>{project=localizeLegacySpeakers(data??blankProject(),baseCatalog.characters);project.exportSettings??=defaults();project.exportSettings.ratio='16:9';projectId=null;revision=0;saves.activate();undo=[];redo=[];editVersion++;dirty=true;selectedScene=project.scenes[0].id;selectedLine=project.scenes[0].entries[0]?.id;recompile();renderAll();await persist(true);},options);}
async function openExampleCopy(){
 await newProject(localExample?clone(localExample):blankProject());
 toast(localExample?'已建立《'+localExample.title+'》练习副本':'已建立空白练习');
}
function exampleDialog(){
 pause();
 $('example-title').textContent=localExample?.title??'本地示例工程';
 $('example-description').textContent=localExample?'在副本上编辑可保留源工程。':'可在本地配置中通过 exampleProject 指定一个练习工程。';
 $('example-note').hidden=true;
 $('example-error').textContent='';
 $('open-example').disabled=!localExample;
 $('examples-dialog').showModal();
}
async function refreshProjectList(){
 const savedProjects=await api('/projects'),rows=document.createDocumentFragment();
 for(const saved of savedProjects){
  const displayName=saved.title.trim()||'未命名作品';
  const row=node('div',undefined,'saved-project'),title=node('div',displayName);
  row.dataset.projectId=saved.id;
  title.append(node('small',new Date(saved.savedAt).toLocaleString()));
  const actions=node('div',undefined,'project-row-actions');
  const open=button('打开',async()=>{$('projects-dialog').close();await openRecord(saved.id);});
  const remove=button('删除',()=>deleteProject(saved));
  remove.className='delete-project danger-quiet';remove.setAttribute('aria-label','删除工程 '+displayName);
  actions.append(open,remove);row.append(title,actions);rows.append(row);
 }
 if(!savedProjects.length)rows.append(node('p','尚未保存工程。','muted'));
 $('project-list').replaceChildren(rows);
}
async function projectDialog(){
 await refreshProjectList();
 if(!$('projects-dialog').open)$('projects-dialog').showModal();
}
function clearDeletedProject(){
 project=blankProject();projectId=null;revision=0;saves.activate();
 dirty=false;editVersion++;undo=[];redo=[];lastEditKey='';
 selectedScene=project.scenes[0].id;selectedLine=project.scenes[0].entries[0].id;
 recompile();renderAll();setSaveState('已删除工程');
}
async function deleteProject(saved){
 const id=saved?.id??projectId;
 if(!id||projectSwitching||exitInProgress)return;
 const current=id===projectId,resumeAutoSave=current&&Boolean(saveTimer);
 const dialog=$('delete-project-dialog'),cancel=$('cancel-delete-project'),confirm=$('confirm-delete-project');
 const hint=$('delete-project-hint'),fromList=$('projects-dialog').open;
 let deleted=false,stale=false,cleanupPending=false,problem='';
 projectSwitching=true;pause();
 if(current)cancelAutoSave();
 cancel.disabled=false;confirm.disabled=true;
 $('delete-project-name').textContent=(saved?.title??project.title).trim()||'未命名作品';
 $('delete-project-date').textContent='';
 hint.textContent=current?'本机保存的工程、自动恢复副本和当前编辑内容将被删除。':'本机保存的工程和自动恢复副本将被删除。';
 const decision=new Promise(resolve=>{
  cancel.onclick=()=>{dialog.close();resolve(false);};
  confirm.onclick=()=>resolve(true);
  dialog.oncancel=event=>{event.preventDefault();if(!cancel.disabled)cancel.click();};
 });
 try{
  dialog.showModal();cancel.focus();
  if(current)await saves.pending.catch(()=>{});
  const record=saved??(await api('/projects')).find(item=>item.id===id);
  if(!dialog.open)return;
  if(!record){stale=true;throw new Error('这个工程已在其他窗口删除。当前内容可用「另存为」保存。');}
  if(!saved&&record.revision!==saves.session.revision){
   stale=true;throw new Error('工程已在其他窗口保存了新版本。请重新打开工程核对，或用「另存为」保留当前内容。');
  }
  $('delete-project-name').textContent=record.title.trim()||'未命名作品';
  $('delete-project-date').textContent='保存于 '+new Date(record.savedAt).toLocaleString();
  confirm.disabled=false;
  if(!await decision)return;
  cancel.disabled=confirm.disabled=true;
  const result=await api('/projects/'+id,{method:'DELETE',body:{expectedRevision:record.revision,expectedRecovery:record.recoveryToken}});
  deleted=true;cleanupPending=result.cleanupPending===true;
  if(current)clearDeletedProject();
 }catch(error){
  if(!dialog.open)return;
  stale=stale||error.status===404||error.status===409;
  problem=error.message;
 }finally{
  if(dialog.open)dialog.close();projectSwitching=false;
  if(resumeAutoSave&&!deleted&&!stale)scheduleAutoSave();
 }
 if(fromList&&(deleted||stale))await refreshProjectList();
 if(problem){await message('未删除工程',problem);return;}
 if(cleanupPending)await message('工程已删除','正在使用的恢复文件将在下次启动时清理。');
 else if(deleted&&!current)toast('工程已删除');
}
function stopAuditions(){document.querySelectorAll('#asset-dialog audio').forEach(a=>a.pause());}
function openPicker(type){pause();pickerType=type;pickerGroup=null;$('asset-search').value='';$('asset-title').textContent=type==='background'?'选择背景':type==='character'?'选择人物与造型':'选择背景音乐';renderPicker();$('asset-dialog').showModal();$('asset-dialog').scrollTop=0;}
function renderPicker(){
 stopAuditions();const query=$('asset-search').value.trim().toLowerCase(),all=pickerType==='background'?catalog.backgrounds:pickerType==='character'?catalog.characters:catalog.music;
 const matches=x=>[x.name,x.styleName,x.id,...(x.aliases??[])].filter(Boolean).join(' ').toLowerCase().includes(query);
 let list=all.filter(matches);
 const showGroups=pickerType==='character'&&pickerGroup===null;
 if(showGroups){const groups=new Map();for(const item of list){if(!groups.has(item.name))groups.set(item.name,{...item,styles:[]});groups.get(item.name).styles.push(item);}list=[...groups.values()];}
 else if(pickerType==='character')list=list.filter(x=>x.name===pickerGroup);
 $('asset-back').hidden=pickerType!=='character'||pickerGroup===null;$('asset-back').onclick=()=>{pickerGroup=null;renderPicker();};
 $('asset-title').textContent=pickerType==='character'?(pickerGroup?pickerGroup+' · 选择造型':'选择人物'):pickerType==='background'?'选择背景':'选择背景音乐';$('asset-grid').replaceChildren();$('asset-count').textContent=`共 ${list.length} 项，已全部列出。${pickerType==='music'?'试听音量不改变作品音量。':'可按名称或编号搜索。'}`;
 const cards=document.createDocumentFragment();for(const item of list){
  const card=node('article',undefined,'asset-card');
  if(pickerType==='background'){const img=node('img');img.loading='lazy';img.src=item.thumbnailUrl??`/assets/background/${item.id}/thumb`;img.alt=item.name;card.append(img);}
  if(pickerType==='character'){const img=node('img');img.loading='lazy';img.className='character-thumbnail';img.src=item.thumbnailUrl??('/assets/character/'+item.id+'/thumb');img.alt=item.name;card.append(img);}
  card.append(node('p',pickerType==='character'&&!showGroups?actorLabel(item):item.name));if(showGroups)card.append(node('small',item.styles.length+' 套本地造型','muted'));if(pickerType==='character'&&!item.expressionsComplete)card.append(node('small','模型表情尚未接入','muted'));
  if(pickerType==='music'){const audio=node('audio');audio.controls=true;audio.preload='none';audio.volume=Number($('monitor-volume').value)/100;audio.src=`/assets/music/${item.id}/full`;audio.onplay=()=>document.querySelectorAll('#asset-dialog audio').forEach(other=>{if(other!==audio)other.pause();});card.append(audio);}
  if(pickerType==='character'&&!showGroups){const support=actorCapabilities(item);card.append(node('small',expressionCountNote(item),'capability-note'));const unavailable=[!support.mouth&&'无嘴部动态',!support.blink&&'无自动眨眼'].filter(Boolean);if(unavailable.length)card.append(node('small',unavailable.join(' · '),'capability-note'));}
  if(showGroups){card.append(button('选择造型',()=>{pickerGroup=item.name;renderPicker();}));cards.append(card);continue;}
  card.append(button('使用这个'+(pickerType==='background'?'背景':pickerType==='character'?'人物':'音乐'),()=>{edit(()=>{if(pickerType==='background'){line().stage??={};line().stage.background=item.id;setBackgroundCrop();}else if(pickerType==='character'){addActor(item);}else line().music={...line().music,op:'play',assetId:item.id,volume:line().music?.volume??.7,loop:line().music?.loop??true,fadeIn:line().music?.fadeIn??.5,fadeOut:line().music?.fadeOut??.5};},{fields:true});stopAuditions();$('asset-dialog').close();}));cards.append(card);
 }
 $('asset-grid').append(cards);
}
function queueRender(){renderPending=true;if(!rendering)run(drainRender);}
async function drainRender(){
 rendering=true;
 try{while(renderPending){renderPending=false;const settings=clone(project.exportSettings),target=compiled,at=time;
  const width=settings.resolution*16/9,height=settings.resolution;
  // Playback requests a redraw every animation frame, but the stage only changes once
  // per output frame: skip redrawing the same frame twice (60 Hz display, 30 fps video).
  const frameAt=transport.playing?Math.floor(at*settings.fps)/settings.fps:at;
  const renderKey=`${frameAt}|${editVersion}|${hiddenText}|${revealed}|${width}|${height}`;
  if(renderKey!==lastRenderKey){
   if($('stage').width!==width||$('stage').height!==height){$('stage').width=width;$('stage').height=height;}
   $('stage-error').hidden=true;
   try{await renderer.render(target,frameAt,{ratio:settings.ratio,hideText:hiddenText,showCompleteText:revealed,watermark:settings.watermark});lastRenderKey=renderKey;}
   catch(error){$('stage-error').textContent=error.message;$('stage-error').hidden=false;if(transport.playing)pause();}
  }
  $('time-label').textContent=`${fmt(at)} / ${fmt(target.duration)}`;$('scrub').value=at;$('dimensions').textContent=`${width} × ${height} · ${settings.fps} fps`;$('preview-ratio').textContent='16:9 横屏';
 }}finally{rendering=false;}
}
async function play(){
 if(transport.playing){pause();queueRender();return;}
 if(!compiled.entries.length)return;
 if(time>=compiled.duration-.01)time=0;
 revealed=false;$('play').textContent='正在准备…';await transport.play(compiled,time);if(!transport.playing)return;
 const state=stateAt(compiled,transport.time);if(state){selectedScene=state.sceneId;selectedLine=state.lineId;renderOutline();renderInspector();}
 $('play').textContent='Ⅱ 暂停';ticking=true;requestAnimationFrame(tick);
}
function tick(){
 if(!ticking||!transport.playing)return;
 const before=stateAt(compiled,time);time=transport.time;const after=stateAt(compiled,time);
 if(before?.lineId!==after?.lineId){
  if(!$('auto-play').checked){pause();time=before.entry.end-1e-6;transport.position=time;revealed=true;queueRender();return;}
  selectedScene=after.sceneId;selectedLine=after.lineId;revealed=false;renderOutline();renderInspector();
 }
 if(time>=compiled.duration){pause();time=compiled.duration;revealed=true;}
 queueRender();if(ticking)requestAnimationFrame(tick);
}
async function seek(value){time=Math.max(0,Math.min(compiled.duration,value));revealed=false;await transport.seek(compiled,time);const state=stateAt(compiled,time);if(state){selectedScene=state.sceneId;selectedLine=state.lineId;renderOutline();renderInspector();}queueRender();}
async function skip(toEnd=false){
 const state=stateAt(compiled,time);if(!state)return;
 const next=toEnd?null:compiled.entries[compiled.entries.indexOf(state.entry)+1];
 if(next){await seek(next.start);return;}
 pause();await seek(compiled.duration);revealed=true;queueRender();
}
async function advance(direction=1){
 const state=stateAt(compiled,time);if(!state)return;
 if(direction>0&&!state.complete&&!revealed){revealed=true;queueRender();return;}
 const index=compiled.entries.indexOf(state.entry),next=compiled.entries[index+direction];if(next){revealed=false;await seek(next.start);}else if(direction>0){await skip(true);}
}
function renderSettings(){
 const s=project.exportSettings;$('export-ratio').value=s.ratio;$('export-resolution').value=s.resolution;$('export-fps').value=s.fps;$('export-bitrate').value=s.bitrateMbps;$('export-codec').value=s.codec;$('export-start').value=s.start??0;$('export-end').value=s.end??compiled.duration;$('export-whole').checked=s.end===null||s.end===undefined;$('watermark-enabled').checked=s.watermark?.enabled??false;$('watermark-text').value=s.watermark?.text??'';updateSettingsSummary();
}
function updateSettingsSummary(){
 $('export-start').disabled=$('export-whole').checked;$('export-end').disabled=$('export-whole').checked;
 try{const x=validateExport(project.exportSettings,compiled.duration);$('export-summary').textContent=`${x.width} × ${x.height} · ${(x.end-x.start).toFixed(2)} 秒 · 约 ${(x.estimatedBytes/1024/1024).toFixed(1)} MB`;}
 catch(error){$('export-summary').textContent=error.message;}
}
function bind(){
 document.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>$(b.dataset.close).close());$('asset-dialog').addEventListener('close',stopAuditions);
 $('project-title').oninput=()=>edit(()=>project.title=$('project-title').value,{key:'title'});
 $('line-kind').onchange=()=>edit(()=>line().kind=$('line-kind').value,{fields:true});
 for(const [id,key] of [['speaker','speaker'],['line-text','text']])$(id).oninput=()=>edit(()=>line()[key]=$(id).value,{key:id});
 for(const [id,key] of [['text-speed','charactersPerSecond'],['hold','hold'],['transition','transition']])$(id).onchange=()=>{if(!$(id).checkValidity()||$(id).value==='')return;run(()=>edit(()=>line()[key]=Number($(id).value),{key:id}));};
 $('add-line').onclick=()=>run(()=>addLine());$('add-narration').onclick=()=>run(()=>addLine('narration'));
 $('add-pause').onclick=()=>run(()=>addLine('pause'));$('add-black').onclick=()=>run(()=>addLine('pause',true));
 for(const id of ['shake-amount','shake-duration'])$(id).onchange=()=>{if(!$('shake-duration').checkValidity())return;run(()=>edit(()=>{line().effects??={};const amount=Number($('shake-amount').value);if(amount===0)delete line().effects.shake;else line().effects.shake={amount,duration:Number($('shake-duration').value)};},{key:'shake'}));};
 $('add-scene').onclick=()=>edit(()=>{const next={id:uid(),title:`场景 ${project.scenes.length+1}`,entries:[blankLine('narration')]};project.scenes.push(next);selectedScene=next.id;selectedLine=next.entries[0].id;},{fields:true});
 $('duplicate-line').onclick=()=>edit(()=>{const l=clone(line());l.id=uid();const list=scene().entries;list.splice(list.findIndex(x=>x.id===selectedLine)+1,0,l);selectedLine=l.id;},{fields:true});
 $('delete-line').onclick=()=>edit(()=>{const list=scene().entries,index=list.findIndex(x=>x.id===selectedLine);list.splice(index,1);if(!list.length)list.push(blankLine());selectedLine=list[Math.min(index,list.length-1)].id;},{fields:true});
 $('undo').onclick=()=>historyStep(undo,redo);$('redo').onclick=()=>historyStep(redo,undo);
 $('examples-button').onclick=()=>run(exampleDialog);$('open-example').onclick=()=>run(async()=>{await openExampleCopy();$('examples-dialog').close();});
 $('new-project').onclick=()=>run(()=>newProject());$('open-project').onclick=()=>run(projectDialog);$('delete-current-project').onclick=()=>run(()=>deleteProject());$('save-project').onclick=()=>run(()=>persist(true));
 $('save-as').onclick=()=>run(async()=>{const copy=clone(project);copy.title+=' · 副本';await newProject(copy,{savingCopy:true});toast('已另存为新工程');});
 $('download-project').onclick=()=>run(async()=>{await persist(true);const response=await fetch(`/api/projects/${projectId}/download`,{headers:{'x-gf2-token':token}});if(!response.ok)throw new Error('工程下载失败');const url=URL.createObjectURL(await response.blob()),a=node('a');a.href=url;a.download=(project.title.replace(/[<>:"/\\|?*]/g,'_')||'作品')+'.gf2story.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
 $('import-project').onchange=()=>run(async()=>{const f=$('import-project').files[0];if(!f)return;if(f.size>IMAGE_LIMITS.projectBytes)throw new Error('工程文件超过48 MB');const checked=await api('/projects/check',{method:'POST',body:JSON.parse(await f.text())});$('projects-dialog').close();await newProject(checked.project);if(checked.missing.length)await message('工程缺少素材',`缺失 ${checked.missing.length} 项素材。已保留原引用，没有替换。`);$('import-project').value='';});
 $('add-actor').onclick=()=>openPicker('character');$('inherit-actors').onclick=()=>edit(()=>{if(line().stage)delete line().stage.actors;},{fields:true});
 $('speaker-actor').onchange=()=>edit(()=>setSpeakers($('speaker-actor').value?[$('speaker-actor').value]:[],false),{fields:true});
 $('chorus-enabled').onchange=()=>edit(()=>setSpeakers(speakerIds(line()),$('chorus-enabled').checked),{fields:true});
 $('import-actor').onclick=()=>openImageImport('actor');$('import-background').onclick=()=>openImageImport('background');
 let drag; $('stage').onpointerdown=event=>{if(!$('drag-actor').checked||!$('stage-actor').value)return;pause();const id=$('stage-actor').value,a=entry().stage.actors.find(x=>x.instanceId===id),c=entry().stage.compositions?.[project.exportSettings.ratio]?.actors?.[id]??{},rect=$('stage').getBoundingClientRect();drag={id,x:c.x??a.x??.5,y:c.y??a.y??1,clientX:event.clientX,clientY:event.clientY,rect};$('stage').setPointerCapture(event.pointerId);};
 $('stage').onpointermove=event=>{if(!drag)return;const x=Math.max(-5,Math.min(5,drag.x+(event.clientX-drag.clientX)/drag.rect.width)),y=Math.max(-5,Math.min(5,drag.y+(event.clientY-drag.clientY)/drag.rect.height));edit(()=>moveActor(drag.id,{x,y}),{key:'drag-'+drag.id});};
 $('stage').onpointerup=$('stage').onpointercancel=()=>{if(drag){drag=null;renderInspector();}};
 $('stage-tint').onchange=()=>edit(()=>{line().stage??={};if($('stage-tint').value)line().stage.tint=$('stage-tint').value;else delete line().stage.tint;},{fields:true});
 $('choose-background').onclick=()=>openPicker('background');$('choose-music').onclick=()=>openPicker('music');
 $('restore-background').onclick=()=>edit(()=>setBackgroundCrop(),{fields:true});
 $('inherit-background').onclick=()=>edit(()=>{const crop=entry()?.previous.compositions?.['16:9']?.background;if(line().stage){delete line().stage.background;delete line().stage.color;}setBackgroundCrop(crop);},{fields:true});
 $('clear-background').onclick=()=>edit(()=>{line().stage??={};line().stage.background=null;line().stage.color=$('stage-color').value;},{fields:true});
 $('stage-color').oninput=()=>edit(()=>{line().stage??={};line().stage.background=null;line().stage.color=$('stage-color').value;},{key:'color'});
 for(const [id,key] of [['crop-x','x'],['crop-y','y'],['crop-scale','scale']])$(id).oninput=()=>edit(()=>{const ratio=project.exportSettings.ratio,l=line();l.stage??={};l.stage.compositions??=clone(entry()?.stage.compositions??{});l.stage.compositions[ratio]??={};l.stage.compositions[ratio].background??={};l.stage.compositions[ratio].background[key]=Number($(id).value);},{key:id});
 $('music-op').onchange=()=>{
  if($('music-op').value==='play'&&!line().music?.assetId){openPicker('music');$('music-op').value=line().music?.op??'inherit';return;}
  edit(()=>{line().music={...line().music,op:$('music-op').value};},{fields:true});
 };
 for(const [id,key] of [['fade-in','fadeIn'],['fade-out','fadeOut'],['music-volume','volume']])$(id).onchange=()=>{if(!$(id).checkValidity())return;run(()=>edit(()=>{line().music??={op:'inherit'};line().music[key]=Number($(id).value)/(key==='volume'?100:1);},{key:id}));};
 $('music-loop').onchange=()=>edit(()=>{line().music??={op:'inherit'};line().music.loop=$('music-loop').checked;});
 $('asset-search').oninput=()=>{renderPicker();};
 $('skip-line').onclick=()=>run(()=>skip());$('skip-all').onclick=()=>run(()=>skip(true));
 $('play').onclick=()=>run(play);$('next-line').onclick=()=>run(()=>advance());$('previous-line').onclick=()=>run(()=>advance(-1));$('stage').onclick=()=>{if(!$('drag-actor').checked)run(()=>advance());};$('scrub').oninput=()=>run(()=>seek(Number($('scrub').value)));
 $('monitor-volume').oninput=()=>transport.setMonitor(Number($('monitor-volume').value)/100);
 $('hide-text').onclick=()=>{hiddenText=!hiddenText;$('hide-text').textContent=hiddenText?'显示文字':'隐藏文字';queueRender();};$('fullscreen').onclick=()=>run(()=>$('stage').requestFullscreen());
 $('history-button').onclick=()=>{$('history-list').replaceChildren();for(const e of compiled.entries.filter(e=>e.start<=time&&e.line.kind!=='pause')){const b=button('',()=>{run(()=>seek(e.start));$('history-dialog').close();});b.className='history-entry';b.append(node('strong',e.line.kind==='narration'?'旁白':e.line.speaker||'角色台词'),node('p',e.line.text));$('history-list').append(b);}$('history-dialog').showModal();};
 $('settings-button').onclick=()=>{renderSettings();$('settings-dialog').showModal();};
 const settingChange=()=>edit(()=>{const s=project.exportSettings;s.ratio='16:9';s.resolution=Number($('export-resolution').value);s.fps=Number($('export-fps').value);s.bitrateMbps=Number($('export-bitrate').value);s.codec=$('export-codec').value;s.start=$('export-whole').checked?0:Number($('export-start').value);s.end=$('export-whole').checked?null:Number($('export-end').value);s.watermark={enabled:$('watermark-enabled').checked,text:$('watermark-text').value};},{key:'settings',fields:true});
 $('watermark-text').oninput=()=>run(settingChange);
 for(const id of ['export-ratio','export-resolution','export-fps','export-bitrate','export-codec','export-start','export-end','export-whole','watermark-enabled','watermark-text'])$(id).onchange=()=>run(settingChange);
 $('export-preset').onchange=()=>edit(()=>{const keep=project.exportSettings.watermark;project.exportSettings={...defaults(),watermark:keep,...($('export-preset').value==='reference'?{resolution:1440,fps:60,bitrateMbps:60}:{})};renderSettings();},{fields:true});
 $('preview-export').onclick=()=>run(async()=>{settingChange();pause();$('settings-dialog').close();await seek(project.exportSettings.start??0);});
 $('start-export').onclick=()=>run(async()=>{
  settingChange();pause();await persist(true);$('start-export').disabled=true;$('cancel-export').hidden=false;$('export-progress').hidden=false;$('export-download').hidden=true;
  try{const result=await exportVideo(project,project.exportSettings,status=>{$('export-progress').value=status.progress;$('export-status').textContent=({preparing:'正在准备并混合背景音乐…',rendering:`正在绘制 ${status.completedFrames} / ${status.frames} 帧`,encoding:'正在完成视频编码…',completed:'导出完成',cancelled:'导出已取消',failed:status.error})[status.state];});$('export-status').textContent='导出完成 · '+result.output;$('export-download').href='/exports/'+result.id+'.mp4';$('export-download').hidden=false;toast('MP4 已保存到 exports 文件夹');}
  // A deliberate cancel is not an error: no red status, no toast, no console error.
  catch(error){$('export-status').textContent=error.message;if(error.code!=='EXPORT_CANCELLED')throw error;}
  finally{$('start-export').disabled=false;$('cancel-export').hidden=true;}
 });
 $('cancel-export').onclick=()=>run(cancelExport);
 for(const id of ['exit-editor','exit-editor-top'])$(id).onclick=()=>run(()=>exitEditor(true));
 for(const id of ['quit-editor','quit-editor-top'])$(id).onclick=()=>run(()=>exitEditor(false));
 $('guide').onclick=()=>{pause();tutorial.open();};
 document.addEventListener('keydown',event=>{if(document.querySelector('#image-import-dialog[open],#tutorial-dialog[open],#delete-project-dialog[open],#projects-dialog[open]')&&(event.ctrlKey||event.metaKey)&&['s','z'].includes(event.key.toLowerCase())){event.preventDefault();return;}if(projectSwitching||exitInProgress||editorExited)return;if(event.ctrlKey||event.metaKey){if(event.key.toLowerCase()==='s'){event.preventDefault();run(()=>persist(true));}if(event.key.toLowerCase()==='z'){event.preventDefault();historyStep(event.shiftKey?redo:undo,event.shiftKey?undo:redo);}}else if(event.code==='Space'&&!['INPUT','TEXTAREA','SELECT','BUTTON'].includes(document.activeElement.tagName)&&!document.querySelector('dialog[open]')){event.preventDefault();run(()=>advance());}});
 window.addEventListener('beforeunload',event=>{if(dirty){event.preventDefault();event.returnValue='';}});
}
function renderAuthorCredit(){setupCredits(session);}
let noticeDialogState=null;
function prepareRightsNotice(){
 const dialog=$('rights-notice-dialog'),confirm=$('rights-notice-confirm'),accept=$('accept-rights-notice'),decline=$('decline-rights-notice'),errorText=$('rights-notice-error');
 $('rights-notice-title').textContent=rightsNotice.title;
 renderNoticeBody($('rights-notice-body'),rightsNotice,teamCredits(session.author,session.coAuthors));
 $('open-rights-notice').onclick=()=>run(()=>showRightsNotice(false));
 for(const id of ['close-rights-notice','return-from-notice'])$(id).onclick=()=>dialog.close();
 confirm.onchange=()=>{accept.disabled=!confirm.checked||noticeDialogState?.busy;};
 dialog.addEventListener('cancel',event=>{if(noticeDialogState?.required)event.preventDefault();});
 dialog.addEventListener('close',()=>{
  const state=noticeDialogState;if(!state)return;
  // A required decision cannot be bypassed with Esc or a native close event.
  if(state.required&&!state.accepted&&!editorExited){dialog.showModal();return;}
  noticeDialogState=null;state.resolve(!state.required||state.accepted);
 });
 const busy=value=>{confirm.disabled=value;decline.disabled=value;accept.disabled=value||!confirm.checked;};
 const failure=error=>{errorText.textContent=error.message;errorText.hidden=false;};
 accept.onclick=async()=>{
  const state=noticeDialogState;if(!state||state.busy||!confirm.checked)return;
  state.busy=true;busy(true);errorText.hidden=true;accept.textContent='正在确认…';
  try{await api('/notice/accept',{method:'POST',body:{revision:rightsNotice.revision,accepted:true}});state.accepted=true;dialog.close();}
  catch(error){failure(new Error('未能记录同意状态：'+error.message+' 请重试，或选择“不同意并退出”。'));}
  finally{state.busy=false;busy(false);accept.textContent='我已阅读并同意，进入软件';}
 };
 decline.onclick=async()=>{
  const state=noticeDialogState;if(!state||state.busy)return;
  state.busy=true;busy(true);errorText.hidden=true;
  try{
   await exitEditor(false);
   if(editorExited){noticeDialogState=null;state.resolve(false);}
  }catch(error){failure(new Error('退出未完成：'+error.message+' 也可关闭此页面和启动终端。'));}
  finally{state.busy=false;busy(false);}
 };
}
function showRightsNotice(required=false){
 if(noticeDialogState)return noticeDialogState.promise;
 if(transport)pause();
 const state={required,accepted:false,busy:false};state.promise=new Promise(resolve=>{state.resolve=resolve;});noticeDialogState=state;
 $('rights-notice-error').hidden=true;$('rights-notice-confirm').checked=false;$('accept-rights-notice').disabled=true;
 for(const id of ['rights-notice-confirm-label','decline-rights-notice','accept-rights-notice'])$(id).hidden=!required;
 for(const id of ['close-rights-notice','return-from-notice'])$(id).hidden=required;
 $('rights-notice-hint').textContent=required?'请阅读以上声明并作出选择。不同意将退出软件。':'本机已记录对当前声明的同意，公告可随时从软件底部查看。';
 $('rights-notice-dialog').showModal();$('rights-notice-body').scrollTop=0;$('rights-notice-title').focus({preventScroll:true});
 return state.promise;
}
async function initialize(){
 renderAuthorCredit();prepareRightsNotice();
 if(session.noticeAccepted!==true&&!await showRightsNotice(true))return;
 const [received,configuredExample]=await Promise.all([api('/catalog'),api('/example')]);
 localExample=configuredExample;
 baseCatalog=catalog={...received,characters:received.characters.map(characterDisplayRecord)};
 const release=session.release;
 const uiVersion=document.documentElement.dataset.editorVersion;
 const versionLabel=release?`v${release.version}`:'服务待重启';
 $('coverage-notice').replaceChildren(node('span',`${versionLabel} · 本地离线`,'release-label'),node('span',`${catalog.characters.length} 套人物造型 / ${catalog.backgrounds.length} 张背景 / ${catalog.music.length} 首 BGM`,'library-summary'),node('span','16:9 横屏','format-badge'));
 if(release?.version!==uiVersion){
  const status=node('span','界面已更新至 v'+uiVersion+'。保存并退出后重新启动，可更新本地服务。');
  $('coverage-notice').append(status);
 }
 const caps=await exportCapabilities();for(const option of $('export-codec').options)option.disabled=!caps.codecs.includes(option.value);$('start-export').disabled=!caps.codecs.length;actorRenderer=new ActorRenderer(catalog);renderer=new StageRenderer($('stage'),{actorRenderer:actorRenderer.draw,imageLoader:id=>loadBackgroundImage(catalog,id)});transport=new MusicTransport(catalog.music,{onError:reportError});await loadStoryFonts();
 const firstProject=(await api('/projects')).length===0;
 project=firstProject&&localExample?clone(localExample):blankProject();projectId=null;revision=0;saves.activate();dirty=false;selectedScene=project.scenes[0].id;selectedLine=project.scenes[0].entries[0]?.id;recompile();renderAll();setSaveState(firstProject&&localExample?localExample.title+' · 可直接播放或编辑':'请选择工程，或开始新作品');
 openImageImport=setupImageImport({api,getProject:()=>project,onPause:pause,onImport:item=>edit(()=>{
  project.customImages=[...(project.customImages??[]).filter(i=>i.id!==item.id),item];
  if(item.kind==='background'){line().stage??={};line().stage.background=item.id;setBackgroundCrop();}
  else addActor({...item,source:'custom'});
 },{fields:true})});
 tutorial=setupTutorial({
  api,onError:reportError,onPause:pause,getProject:()=>project,
  selectEntry:(sceneId,lineId)=>select(lineId,sceneId),
  actions:{example:openExampleCopy,export:()=>$('settings-button').click()}
 });
 bind();await tutorial.firstRun();
}
run(initialize);
