import {setupCredits,renderNoticeBody,teamCredits} from '/credits.mjs';
import {IMAGE_LIMITS,cloneProject,withProjectImages} from '/core/custom-images.mjs';
import {speakerIds,localizeLegacySpeakers,characterDisplayRecord} from '/core/speakers.mjs';
import {catalogCharacterNames,catalogCharacterSearchText,catalogExpressionName} from '/core/catalog-labels.mjs';
import {setupImageImport,loadBackgroundImage} from '/image-import.mjs';
import {setupTutorial} from '/tutorial.mjs';
import {starterExampleInfo,createStarterExample,localizeStarterExample as localizeExample} from '/core/starter-example.mjs';
import {rightsNotice} from '/core/rights-notice.mjs';
import {ProjectSaveQueue} from '/core/project-save-queue.mjs';
import {moveScene,moveLine,duplicateScene} from '/core/story-order.mjs';
import {defaultActorPlacement,defaultStagePositions} from '/core/actor-state.mjs';
import {VideoFrames} from './video-frames.mjs';
import {setupVideoLibrary} from './video-library.mjs';
import {isLocalVideoId} from '/core/video.mjs';
import {t,translateMessage,interfaceLanguage,setInterfaceLanguage,setupLanguageControls} from './i18n.mjs';
import * as session from '/bootstrap.mjs';
import {isEditorTheme,isPreviewResolution,readEditorView} from '/core/editor-view.mjs';
const {token}=session;
const supportsLocalAudio=session.localAudioImport===true;
import {compileProject,stateAt,validateExport,hasSpeechPause,endsWithSpeechPause} from '/core/timeline.mjs';
import {StageRenderer} from '/core/stage.mjs';
import {exportVideo,cancelExport,exportCapabilities} from '/export.mjs';
import {MusicTransport} from '/music.mjs';
import {ActorRenderer} from '/actors.mjs';
const $=id=>document.getElementById(id),clone=value=>value?.formatVersion===1&&Array.isArray(value.scenes)?cloneProject(value):structuredClone(value),uid=()=>crypto.randomUUID(),fmt=t=>`${Math.floor(t/60).toString().padStart(2,'0')}:${Math.floor(t%60).toString().padStart(2,'0')}`;
const node=(tag,text,className)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(className)e.className=className;return e;};
const button=(text,action)=>{const e=node('button',text);e.onclick=()=>run(action);return e;};
const run=action=>Promise.resolve().then(action).catch(reportError);
async function api(route,{method='GET',body}={}){const response=await fetch('/api'+route,{method,headers:{'x-gf2-token':token,'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});const value=await response.json();if(!response.ok){const error=new Error(value.error??t("本地服务请求失败"));error.status=response.status;throw error;}return value;}
let catalog,baseCatalog,localExample,actorRenderer,openImageImport,openAudioImport,tutorial,project,compiled,projectId,selectedScene,selectedLine,time=0,transport,renderer,videoFrames,videoLibrary;
let dirty=false,editVersion=0,undo=[],redo=[],lastEditKey='',lastEditAt=0,saveTimer,toastTimer;
let revealed=true,hiddenText=false,renderPending=false,rendering=false,pickerType='background',pickerGroup=null,ticking=false,lastRenderKey='',lastRenderedTimeline=null;
const saves=new ProjectSaveQueue(api);let projectSwitching=false,exitInProgress=false,editorExited=false;
const previewFrameRate=60;
let editorView=readEditorView(session.editorView),editorViewWrites=Promise.resolve();
function saveEditorView(patch){
 editorView={...editorView,...patch};
 editorViewWrites=editorViewWrites.catch(()=>{}).then(()=>api('/editor-view',{method:'POST',body:patch}));
 editorViewWrites.catch(()=>toast(t('无法保存预览或主题偏好')));
}
function bindEditorView(){
 const theme=$('editor-theme'),resolution=$('preview-resolution');
 document.documentElement.dataset.theme=editorView.theme;
 theme.value=editorView.theme;
 resolution.value=String(editorView.previewResolution);
 theme.onchange=()=>{
  if(!isEditorTheme(theme.value)||theme.value===editorView.theme)return;
  document.documentElement.dataset.theme=theme.value;
  saveEditorView({theme:theme.value});
 };
 resolution.onchange=()=>{
  const value=Number(resolution.value);
  if(!isPreviewResolution(value)||value===editorView.previewResolution)return;
  saveEditorView({previewResolution:value});
  if(compiled)queueRender();
 };
}
async function switchProject(action,{savingCopy=false}={}){
 if(projectSwitching){toast(t("正在切换工程，请稍候"));return;}
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
const blankProject=()=>({formatVersion:1,actorFramingRevision:2,title:t("未命名作品"),catalogVersion:catalog.version,scenes:[{id:uid(),title:t("场景一"),entries:[blankLine()]}],exportSettings:defaults(),subtitleSettings:{mode:'game',fontLanguage:interfaceLanguage()}});
const scene=()=>project.scenes.find(s=>s.id===selectedScene);
const line=()=>scene()?.entries.find(l=>l.id===selectedLine);
const entry=()=>compiled.entries.find(e=>e.line.id===selectedLine);
const videoAsset=id=>baseCatalog.videos.find(asset=>asset.id===id);
function toast(message){$('toast').textContent=translateMessage(message);$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,3500);}
function reportError(error){console.error(error);saveCopy=error.message;saveError=true;renderSaveState();toast(error.message);}
function message(title,text,actions=[['知道了',()=>{}]]){return new Promise(resolve=>{
 $('message-title').textContent=title;$('message-text').textContent=text;$('message-actions').replaceChildren();
 for(const [label,action] of actions)$('message-actions').append(button(t(label),async()=>{$('message-dialog').close();await action();resolve(label);}));
 $('message-dialog').showModal();$('message-dialog').oncancel=()=>resolve('取消');
});}
let saveCopy=null,saveError=false;
function renderSaveState(){
 if(saveCopy===null)return;
 $('save-status').classList.toggle('error-status',saveError);
 const status=$('save-status');
 status.textContent=translateMessage(saveCopy);
 status.title=status.textContent;
 status.toggleAttribute('data-dirty',dirty);
}
function setSaveState(text){saveCopy=text;saveError=false;renderSaveState();}
function cancelAutoSave(){clearTimeout(saveTimer);saveTimer=null;}
function scheduleAutoSave(){cancelAutoSave();saveTimer=setTimeout(()=>{saveTimer=null;run(()=>persist(false));},900);}
function markDirty(){dirty=true;editVersion++;setSaveState('有未保存修改');scheduleAutoSave();}
function pause(){if(transport){time=transport.pause();$('play').textContent=t("▶ 播放");}videoFrames?.pause();ticking=false;}
function edit(action,{key='',fields=false}={}){
 pause();const now=performance.now();
 if(!key||lastEditKey!==key||now-lastEditAt>750){undo.push(clone(project));if(undo.length>100)undo.shift();}
 lastEditKey=key;lastEditAt=now;redo=[];action();markDirty();recompile();
 if(key==='line-text')updateMouthPunctuationHint(line());
 if(key==='speaker'||key==='line-text'){
  const row=$('scene-list').querySelector('.line-item.active');
  if(row&&row.dataset.lineId===selectedLine)updateOutlineText(row,line());else renderOutline();
 }else if(key!=='title')renderOutline(fields);
 if(fields)renderInspector();else renderEntryDuration(entry());
 updateSettingsSummary();selectPreviewTime();queueRender();
}
let catalogImages;
function recompile(){
 if(catalogImages!==project.customImages){
  catalogImages=project.customImages;
  catalog=catalogImages?.length?withProjectImages(baseCatalog,project):baseCatalog;
  actorRenderer.definitions=new Map(catalog.characters.map(x=>[x.id,x]));
 }
 compiled=compileProject(project);
 $('scrub').max=compiled.duration||1;
 const ruler=$('timeline-ruler');
 if(ruler.dataset.duration!==String(compiled.duration)){
  ruler.dataset.duration=compiled.duration;
  const marks=compiled.duration>=5?[0,.25,.5,.75,1]:[0,1];
  const labels=marks.map(fraction=>fmt(compiled.duration*fraction));
  ruler.replaceChildren(...labels.map(label=>node('span',label)));
 }
 $('undo').disabled=!undo.length;
 $('redo').disabled=!redo.length;
}
function renderEntryDuration(selected){
 $('entry-duration').textContent=selected
  ?t(selected.video?"过场 {0} 秒 · 作品共 {1} 秒":"本句约 {0} 秒 · 作品共 {1} 秒",(selected.end-selected.start).toFixed(1),compiled.duration.toFixed(1))
  :'';
}
function selectPreviewTime(){const e=entry();time=e?Math.min(e.end,e.start+e.transition+.00001):0;if(transport)transport.position=time;revealed=true;}
function historyStep(from,to){if(!from.length)return;pause();to.push(clone(project));project=localizeExample(from.pop(),interfaceLanguage());ensureSelection();markDirty();recompile();renderAll();}
function ensureSelection(){if(!project.scenes.some(s=>s.id===selectedScene))selectedScene=project.scenes[0]?.id;if(!scene()?.entries.some(l=>l.id===selectedLine))selectedLine=scene()?.entries[0]?.id;}
const subtitleColorInputs = {
 speaker: "subtitle-speaker-color",
 text: "subtitle-text-color",
 accent: "subtitle-accent-color",
};
function renderSubtitleSettings() {
 const { mode, fontLanguage, colors } = compiled.subtitleSettings;
 $("subtitle-mode").value = mode;
 $("subtitle-font-language").value = fontLanguage;
 $("subtitle-colors").hidden = mode !== "theater";
 $("subtitle-active").textContent = t(mode === "theater" ? "小剧场" : "原版样式");
 for (const [part, input] of Object.entries(subtitleColorInputs)) $(input).value = colors[part];
}
function displayProjectTitle(){
 const title=$('project-title');
 title.value=project.title;
 title.title=project.title;
}
function renderAll(){$('delete-current-project').disabled=!projectId;ensureSelection();displayProjectTitle();renderOutline(true);renderInspector();renderSubtitleSettings();renderSettings();selectPreviewTime();queueRender();}
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
 const clip=l.kind==='cutscene'?videoAsset(l.video.assetId):null;
 const title=l.kind==='cutscene'?t("过场视频"):l.kind==='narration'?t("旁白"):l.kind==='pause'?(l.stage?.background===null&&l.stage?.color==='#000000'?t("黑场"):t("停顿")):l.speaker||t("角色台词");
 row.querySelector('strong').textContent=title;
 row.querySelector('.excerpt').textContent=l.kind==='cutscene'?(clip?.name??t('视频素材不存在。')):
  l.kind==='pause'?t("停留 {0} 秒",l.hold??1.5):l.text||t("（等待输入）");
}
function renderOutline(followSelection=false){
 const list=$('scene-list'),offset=list.scrollTop;
 list.replaceChildren();
 let count=0;
 project.scenes.forEach((s,sceneIndex)=>{
  const section=node('section'),head=node('div',undefined,'scene-heading'),title=node('input'),controls=node('div',undefined,'menu-panel scene-actions');section.dataset.sceneId=s.id;title.value=s.title;title.title=s.title;title.setAttribute('aria-label',t("场景 {0} 名称",sceneIndex+1));title.onchange=()=>edit(()=>{s.title=title.value||t("未命名场景");});
  const handle=button('⠿',()=>select(s.entries[0]?.id,s.id));handle.className='scene-drag-handle';handle.setAttribute('aria-label',t("拖动场景 {0}",s.title));handle.title=t("拖动调整场景顺序，也可使用上下按钮");bindOutlineDrag(handle,'scene',s.id);
  const up=button('↑',()=>{if(sceneIndex>0)orderEdit(p=>moveScene(p,s.id,project.scenes[sceneIndex-1].id));}),down=button('↓',()=>{if(sceneIndex<project.scenes.length-1)orderEdit(p=>moveScene(p,s.id,project.scenes[sceneIndex+1].id,true));});up.disabled=sceneIndex===0;down.disabled=sceneIndex===project.scenes.length-1;up.setAttribute('aria-label',t("上移场景 {0}",s.title));down.setAttribute('aria-label',t("下移场景 {0}",s.title));
  const copy=button('⧉',()=>edit(()=>{const c=duplicateScene(project,s.id,uid);selectedScene=c.id;selectedLine=c.entries[0]?.id;},{fields:true}));copy.setAttribute('aria-label',t("复制场景 {0}",s.title));
  const remove=button('×',()=>edit(()=>{project.scenes.splice(sceneIndex,1);if(!project.scenes.length)project.scenes.push({id:uid(),title:t("场景一"),entries:[blankLine()]});ensureSelection();},{fields:true}));remove.setAttribute('aria-label',t("删除场景 {0}",s.title));
  for(const control of [up,down,copy,remove])control.title=control.getAttribute('aria-label');
  const menu=node('details',undefined,'toolbar-menu scene-menu'),toggle=node('summary','⋯');
  toggle.setAttribute('aria-label',t("场景操作"));
  toggle.title=t("场景操作");
  controls.append(up,down,copy,remove);menu.append(toggle,controls);head.append(handle,title,menu);
  menu.addEventListener('toggle',()=>{
   if(!menu.open)return;
   const clipped=controls.getBoundingClientRect().bottom-list.getBoundingClientRect().bottom;
   if(clipped>0)list.scrollTop+=Math.ceil(clipped);
  });
  bindOutlineDrop(head,'scene',(id,after)=>orderEdit(p=>moveScene(p,id,s.id,after)));section.append(head);
  s.entries.forEach((l,index)=>{
   count++;const row=button('',()=>select(l.id,s.id));row.className='line-item'+(l.id===selectedLine?' active':'');row.dataset.lineId=l.id;row.setAttribute('aria-current',l.id===selectedLine?'true':'false');row.title=t("拖动到台词上半部或下半部排序；Alt+↑/↓ 在本场景内移动");
   const copy=node('span',undefined,'line-copy');copy.append(node('strong'),node('span',undefined,'excerpt'));row.append(node('span',String(count).padStart(2,'0'),'number'),copy);updateOutlineText(row,l);
   bindOutlineDrag(row,'line',l.id);bindOutlineDrop(row,'line',(id,after)=>orderEdit(p=>moveLine(p,id,s.id,l.id,after),{scene:s.id,line:id}));
   row.onkeydown=event=>{if(!event.altKey||!['ArrowUp','ArrowDown'].includes(event.key))return;event.preventDefault();const next=index+(event.key==='ArrowDown'?1:-1);if(!s.entries[next])return;orderEdit(p=>moveLine(p,l.id,s.id,s.entries[next].id,next>index),{scene:s.id,line:l.id});document.querySelector('[data-line-id="'+CSS.escape(l.id)+'"]')?.focus();};section.append(row);
  });
  const end=button(s.entries.length?t("拖入本场景末尾"):t("空场景 · 拖入台词或添加下一句"),()=>select(s.entries.at(-1)?.id,s.id));end.className='scene-drop-end';end.dataset.dropScene=s.id;bindOutlineDrop(end,'line',id=>orderEdit(p=>moveLine(p,id,s.id),{scene:s.id,line:id}),true);section.append(end);list.append(section);
 });
 list.scrollTop=offset;
 if(followSelection){
  const row=list.querySelector('.line-item.active');
  if(row){
   const view=list.getBoundingClientRect(),item=row.getBoundingClientRect();
   const header=row.parentElement.querySelector('.scene-heading').offsetHeight;
   if(item.top<view.top+header)list.scrollTop+=item.top-view.top-header;
   else if(item.bottom>view.bottom)list.scrollTop+=item.bottom-view.bottom;
  }
 }
 $('undo').disabled=!undo.length;$('redo').disabled=!redo.length;
}
function selectInspectorTab(tab){
 const group=$('inspector-tabs');
 if(tab.getAttribute('aria-selected')==='true')return;
 for(const button of group.querySelectorAll('[role=tab]')){
  const selected=button===tab;
  button.setAttribute('aria-selected',String(selected));
  button.tabIndex=selected?0:-1;
  $(button.getAttribute('aria-controls')).hidden=!selected;
 }
 document.querySelector('.inspector-content').scrollTop=0;
}
function revealInspectorControl(control){
 const panel=control?.closest('.inspector-content [role=tabpanel]');
 if(panel)selectInspectorTab($(panel.getAttribute('aria-labelledby')));
}
function bindInspectorTabs(){
 const group=$('inspector-tabs');
 group.addEventListener('click',event=>{
  const tab=event.target.closest('[role=tab]');
  if(tab)selectInspectorTab(tab);
 });
 group.addEventListener('keydown',event=>{
  const tabs=[...group.querySelectorAll('[role=tab]:not([hidden])')];
  const index=tabs.indexOf(event.target);
  if(index<0)return;
  let destination;
  switch(event.key){
   case 'ArrowLeft': destination=(index+tabs.length-1)%tabs.length;break;
   case 'ArrowRight': destination=(index+1)%tabs.length;break;
   case 'Home': destination=0;break;
   case 'End': destination=tabs.length-1;break;
   default: return;
  }
  event.preventDefault();
  selectInspectorTab(tabs[destination]);
  tabs[destination].focus();
 });
}
function renderInspector(){
 const panel=document.querySelector('.inspector-content'),top=panel.scrollTop,left=panel.scrollLeft;
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
  ?t("要让角色在句末停口，请在末尾加上句号、问号或感叹号。")
  :t("请在需要停口的地方加标点，例如“收到，现在出发。”逗号让角色稍停，句号让角色收口。");
 if(hint.textContent!==message)hint.textContent=message;
 hint.hidden=false;
}
function updateInspector(){
 const l=line(),e=entry(),indicator=$('entry-position');
 renderEntryDuration(e);
 const index=compiled.entries.indexOf(e);
 indicator.hidden=index<0;
 if(index>=0){
  indicator.textContent=String(index+1).padStart(2,'0')+' / '+compiled.entries.length;
  indicator.title=t("第 {0} 条，共 {1} 条",index+1,compiled.entries.length);
 }
 updateMouthPunctuationHint(l);
 document.querySelectorAll('.inspector-content :is(input,select,textarea,button),.inspector-actions button').forEach(x=>x.disabled=!l);
 const cutscene=l?.kind==='cutscene';
 const backgroundVideo=l&&!cutscene?videoAsset(e?.stage.background):null;
 $('video-background-tip').hidden=!backgroundVideo;
 if(cutscene)selectInspectorTab($('entry-tab'));
 for(const id of ['background-tab','actor-tab','audio-tab'])$(id).hidden=Boolean(cutscene);
 $('entry-text-fields').hidden=Boolean(cutscene);
 $('cutscene-fields').hidden=!cutscene;
 if(!l)return;
 $('line-kind').value=l.kind;$('speaker').value=l.speaker??'';$('speaker-label').hidden=l.kind!=='dialogue';
 if(cutscene){
  const clip=videoAsset(l.video.assetId);
  $('replace-cutscene').textContent=clip?.name??t('选择过场视频');
  $('cutscene-audio-label').hidden=!clip?.audioId;
  $('cutscene-audio').checked=Boolean(l.video.audioId);
  return;
 }
 $('line-text').value=l.text;$('line-text').disabled=l.kind==='pause';
 const shakeValue=String(l.effects?.shake?.amount??0);$('shake-amount').querySelector('option[data-custom]')?.remove();if(![...$('shake-amount').options].some(o=>o.value===shakeValue)){const option=node('option',t("自定义强度"));option.value=shakeValue;option.dataset.custom='true';$('shake-amount').append(option);}$('shake-amount').value=shakeValue;$('shake-duration').value=l.effects?.shake?.duration??.5;
 $('text-speed').value=Number((l.charactersPerSecond??25).toFixed(2));$('hold').value=l.hold??1.5;$('transition').value=l.transition??.25;
 const bg=catalog.backgrounds.find(x=>x.id===e?.stage.background);
 const inherit=l.stage?.background===undefined?t("继承 · "):'';
 $('choose-background').textContent=backgroundVideo?t("选择背景"):inherit+(bg?.name??t("纯色画面"));
 $('choose-video-background').textContent=backgroundVideo?inherit+backgroundVideo.name:t('选择视频背景');
 $('stage-color').value=e?.stage.color??'#000000';
 $('restore-background').disabled=!bg&&!backgroundVideo;
 const tint=l.stage?.tint??'';$('stage-tint').querySelector('[data-custom]')?.remove();if(![...$('stage-tint').options].some(o=>o.value===tint)){const option=node('option',t("已保存色调"));option.value=tint;option.dataset.custom='true';$('stage-tint').append(option);}$('stage-tint').value=tint;
 const crop=e?.stage.compositions?.[project.exportSettings.ratio]?.background??{};$('crop-x').value=crop.x??.5;$('crop-y').value=crop.y??.5;$('crop-scale').value=crop.scale??1;
 $('music-op').value=l.music?.op??'inherit';const track=catalog.music.find(x=>x.id===l.music?.assetId);$('choose-music').textContent=track?.name??t("选择音乐");$('choose-music').hidden=(l.music?.op??'inherit')!=='play';$('music-options').hidden=(l.music?.op??'inherit')!=='play';
 $('music-volume').value=(l.music?.volume??.7)*100;$('music-loop').checked=l.music?.loop??true;$('fade-in').value=l.music?.fadeIn??.5;$('fade-out').value=l.music?.fadeOut??.5;
 renderActors();
}
const defaultBackgroundCrop = Object.freeze({x:.5,y:.5,scale:1});
function setBackgroundCrop(crop=defaultBackgroundCrop){
 const l=line();l.stage??={};l.stage.compositions??=clone(entry()?.stage.compositions??{});l.stage.compositions['16:9']??={};l.stage.compositions['16:9'].background=clone(crop);
}
function actorsForEdit(){line().stage??={};line().stage.actors??=clone(entry()?.stage.actors??[]);return line().stage.actors;}
function moveActor(id,changes){const ratio=project.exportSettings.ratio,l=line();l.stage??={};l.stage.compositions??=clone(entry()?.stage.compositions??{});l.stage.compositions[ratio]??={};l.stage.compositions[ratio].actors??={};l.stage.compositions[ratio].actors[id]={...l.stage.compositions[ratio].actors[id],...changes};}
function actorLabel(definition){
 const {name,styleName}=catalogCharacterNames(definition,interfaceLanguage());
 return styleName&&name!==styleName?name+' · '+styleName:name;
}
function actorCapabilities(definition){
 const parameters=definition.parameters??[],usable=id=>parameters.some(p=>p.id===id&&p.max>p.min);
 return {mouth:usable('ParamMouthOpenY'),blink:!!definition.eyeBlink?.enabled&&(definition.eyeBlink.parameterIds??[]).some(usable)};
}
function expressionAvailabilityNote(definition,expression){
 if(!expression)return '';const ids=new Set((definition.parameters??[]).map(p=>p.id)),missing=(expression.parameters??[]).filter(p=>!ids.has(p.id));
 if(!missing.length)return '';
 return missing.length===expression.parameters.length?t("此模型表情在当前造型中与默认姿态一致。"):t("此造型只能显示该模型表情的部分变化，以预览为准。");
}
function expressionCountNote(definition){if(definition.source==='custom')return t("自定义静态立绘，可移动、缩放、翻转与发言高亮。");if(!definition.expressionsComplete)return t("此造型的模型表情尚未完整接入。");return definition.expressions.length?t("默认姿态与 {0} 个模型表情",definition.expressions.length):t("此模型未提供额外表情，可使用模型默认姿态。");}
// The legacy single-speaker field remains readable by older project versions.
function setSpeakers(ids,chorus){
 const l=line(),actors=l.stage?.actors??entry()?.stage.actors??[],active=new Set(actors.map(a=>a.instanceId));ids=[...new Set(ids)].filter(id=>active.has(id));if(!chorus)ids=ids.slice(0,1);
 l.speakerInstanceId=ids[0]??null;if(chorus)l.speakerInstanceIds=ids;else delete l.speakerInstanceIds;
 const names=ids.map(id=>{const a=actors.find(a=>a.instanceId===id),definition=catalog.characters.find(d=>d.id===a.assetId)??project.customImages?.find(d=>d.id===a.assetId);
  return definition?catalogCharacterNames(definition,interfaceLanguage()).name:t("人物");});if(names.length){const language=interfaceLanguage();l.speaker=[...new Set(names)].join(language==='en'||language==='zh-TW'?', ':'、').slice(0,200);}
}
function addActor(definition){
 const actors=actorsForEdit();if(actors.length>=10)throw new Error(t("最多同时添加 10 人"));const a={instanceId:uid(),assetId:definition.id,...defaultActorPlacement(definition),opacity:1,layer:actors.length};actors.push(a);
 const chorus=Array.isArray(line().speakerInstanceIds);setSpeakers(chorus?[...speakerIds(line()),a.instanceId]:[a.instanceId],chorus);
}
function renderChorus(actors){
 const l=line(),chorus=Array.isArray(l?.speakerInstanceIds),ids=speakerIds(l),dialogue=l?.kind==='dialogue';
 $('chorus-enabled').checked=chorus;$('chorus-enabled').disabled=!dialogue;$('chorus-panel').hidden=!chorus||!dialogue;$('single-speaker-label').hidden=chorus||!dialogue;$('chorus-actors').replaceChildren();
 for(const actor of actors){const definition=catalog.characters.find(d=>d.id===actor.assetId),label=node('label',undefined,'compact'),check=node('input');check.type='checkbox';check.value=actor.instanceId;check.checked=ids.includes(actor.instanceId);check.dataset.inspectorFocus='chorus/'+actor.instanceId;check.onchange=()=>edit(()=>setSpeakers(check.checked?[...speakerIds(line()),actor.instanceId]:speakerIds(line()).filter(id=>id!==actor.instanceId),true),{fields:true});label.append(check,document.createTextNode(definition?actorLabel(definition):actor.assetId));$('chorus-actors').append(label);}
 const count=actors.filter(a=>ids.includes(a.instanceId)).length;$('chorus-count').textContent=!actors.length?t("请先添加在场人物。"):count>=2?t("已选 {0} 人，同时高亮并同步使用可用口型。",count):count===1?t("已选 1 人，再勾选至少 1 人即可齐声发言。"):t("尚未选择发言人物；此时作为画外发言。");
}
function renderActors(){
 const advancedOpen=new Set([...document.querySelectorAll('#actors .actor-control')].filter(b=>b.querySelector('.actor-advanced')?.open).map(b=>b.dataset.instanceId));
 const actors=entry()?.stage.actors??[],selected=$('stage-actor').value,content=document.createDocumentFragment();content.append(node('p',t("调整人物在横屏画面中的位置。"),'muted'));$('speaker-actor').replaceChildren();$('stage-actor').replaceChildren();
 const empty=node('option',t("画外人物／无人高亮"));empty.value='';$('speaker-actor').append(empty);
 for(const actor of actors){
  const definition=catalog.characters.find(x=>x.id===actor.assetId),name=definition?actorLabel(definition):actor.assetId;
  for(const select of [$('speaker-actor'),$('stage-actor')]){const option=node('option',name);option.value=actor.instanceId;select.append(option);}
  const box=node('section',undefined,'actor-control');box.dataset.assetId=actor.assetId;box.dataset.instanceId=actor.instanceId;box.append(node('strong',name));
  if(!definition){box.append(node('p',t("缺少原人物素材，已保留引用。"),'muted'));content.append(box);continue;}
  const capabilities=actorCapabilities(definition);box.append(node('small',expressionCountNote(definition),'capability-note'));
  const expression=node('select');expression.setAttribute('aria-label',t("{0} 模型表情",name));const def=node('option',definition.source==='custom'?t("导入图片（静态）"):t("模型默认姿态"));def.value='';expression.append(def);
  for(const item of definition.expressions){const name=catalogExpressionName(item,interfaceLanguage()),option=node('option',name);option.title=[name,expressionAvailabilityNote(definition,item)].filter(Boolean).join(' · ');option.value=item.id;expression.append(option);}expression.value=actor.expression??'';expression.disabled=!definition.expressions.length;expression.onchange=()=>edit(()=>{const target=actorsForEdit().find(x=>x.instanceId===actor.instanceId);if(expression.value)target.expression=expression.value;else delete target.expression;},{fields:true});box.append(expression);const expressionNote=expressionAvailabilityNote(definition,definition.expressions.find(e=>e.id===actor.expression));if(expressionNote)box.append(node('small',expressionNote,'capability-note'));if(definition.expressions.length){const preview=button(t("查看表情预览"),()=>expressionPicker(actor,definition));preview.dataset.expressionPreview='';box.append(preview);}if(!definition.expressionsComplete)box.append(node('small',t("此造型的模型表情尚未接入。"),'muted'));
  const placement=node('div',undefined,'actor-positions');for(const [label,x] of defaultStagePositions)placement.append(button(t(label),()=>edit(()=>moveActor(actor.instanceId,{x}),{fields:true})));box.append(placement);
  const composition=entry().stage.compositions?.[project.exportSettings.ratio]?.actors?.[actor.instanceId]??{};
  const vertical=node('div',undefined,'actor-positions');for(const [label,delta] of [[t("上移"),-.03],[t("下移"),.03]]){const control=button(label,()=>edit(()=>moveActor(actor.instanceId,{y:Math.max(-.5,Math.min(2,Math.round(((composition.y??actor.y??1)+delta)*100)/100))}),{fields:true}));control.setAttribute('aria-label',name+' '+label);vertical.append(control);}box.append(vertical);box.append(button(t("恢复默认大小与高度"),()=>edit(()=>{const {y,scale}=defaultActorPlacement(definition);moveActor(actor.instanceId,{y,scale});},{fields:true})));
  const sizeLabel=node('label',t("人物大小")),sizeOutput=node('output'),sizeSlider=node('input'),defaultScale=defaultActorPlacement(definition).scale,currentScale=composition.scale??actor.scale??1;
  sizeSlider.type='range';sizeSlider.min=Math.min(.1,currentScale);sizeSlider.max=Math.max(3,Math.ceil(currentScale));sizeSlider.step='.01';sizeSlider.value=currentScale;sizeSlider.dataset.actorScale='true';sizeSlider.setAttribute('aria-label',t("{0} 人物缩放",name));sizeOutput.textContent=Math.round(currentScale/defaultScale*100)+'%';sizeOutput.title=t("相对于默认大小");
  sizeSlider.oninput=()=>{const value=Number(sizeSlider.value);sizeOutput.textContent=Math.round(value/defaultScale*100)+'%';const numeric=box.querySelector('[data-actor-property="scale"]');if(numeric)numeric.value=value;edit(()=>moveActor(actor.instanceId,{scale:value}),{key:actor.instanceId+'scale-slider'});};sizeLabel.append(sizeOutput,sizeSlider);box.append(sizeLabel);
  const advanced=node('details',undefined,'actor-advanced');advanced.open=advancedOpen.has(actor.instanceId);advanced.append(node('summary',t("精细调整：位置、透明度与层级")));
  for(const [key,title,min,max,step] of [['x',t("水平位置"),-1,2,.01],['y',t("垂直位置"),-.5,2,.01],['scale',t("人物大小"),.01,10,.01],['opacity',t("不透明度"),0,1,.01],['layer',t("前后层级"),-10,10,1]]){
   const label=node('label',title),input=node('input');input.type='number';input.min=min;input.max=max;input.step=step;input.value=composition[key]??actor[key]??({x:.5,y:1,scale:1,opacity:1,layer:0}[key]);input.setAttribute('aria-label',name+' '+title);input.dataset.actorProperty=key;input.onchange=()=>{if(!input.checkValidity()||input.value==='')return;edit(()=>{if(['x','y','scale'].includes(key))moveActor(actor.instanceId,{[key]:Number(input.value)});else actorsForEdit().find(x=>x.instanceId===actor.instanceId)[key]=Number(input.value);},{key:actor.instanceId+key,fields:true});};label.append(input);advanced.append(label);
  }
  for(const [key,title,defaultValue] of [['flip',t("水平翻转"),false],['blink',t("自然眨眼"),true],['mouth',t("发言时嘴部动态"),true]]){
   const label=node('label',undefined,'compact'),input=node('input'),supported=key==='flip'||capabilities[key];input.type='checkbox';input.dataset.actorControl=key;input.checked=supported&&(actor[key]??defaultValue);input.disabled=!supported;
   input.onchange=()=>{if(!supported)return;edit(()=>{actorsForEdit().find(x=>x.instanceId===actor.instanceId)[key]=input.checked;});};label.append(input,document.createTextNode(title));box.append(label);
   const explanation=key==='blink'&&!supported?t("此造型未提供可用的自动眨眼。"):key==='mouth'?(!supported?t("此造型不支持嘴部动态。"):t("口型随对白时间和标点变化。")):'';
   if(explanation){const note=node('small',explanation,'capability-note');note.id='capability-'+actor.instanceId+'-'+key;input.setAttribute('aria-describedby',note.id);box.append(note);}
  }
  box.append(advanced);
  box.append(button(t("从本句退场（删除）"),()=>edit(()=>{line().stage??={};line().stage.actors=actorsForEdit().filter(x=>x.instanceId!==actor.instanceId);if(speakerIds(line()).includes(actor.instanceId))setSpeakers(speakerIds(line()).filter(id=>id!==actor.instanceId),Array.isArray(line().speakerInstanceIds));},{fields:true})));
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
 const version=++expressionPickerVersion,actorRenderer=new ActorRenderer(catalog);$('expression-title').textContent=t("{0} · 模型表情",catalogCharacterNames(definition,interfaceLanguage()).name);$('expression-grid').replaceChildren();$('expression-dialog').showModal();
 const close=()=>{expressionPickerVersion++;$('expression-dialog').close();};$('close-expressions').onclick=close;$('expression-dialog').oncancel=()=>{expressionPickerVersion++;};
 const options=[{id:'',name:t("模型默认姿态")},...definition.expressions];
 try{for(let i=0;i<options.length;i++){
  if(version!==expressionPickerVersion)break;const option=options[i],name=option.id?catalogExpressionName(option,interfaceLanguage()):option.name,card=node('button',undefined,'expression-card'),canvas=node('canvas');canvas.width=160;canvas.height=180;canvas.setAttribute('aria-label',t("{0}预览",name));const note=expressionAvailabilityNote(definition,option);card.title=[name,note].filter(Boolean).join(' · ');card.append(canvas,node('span',name));if(note)card.append(node('small',note,'capability-note'));card.setAttribute('aria-pressed',String((actor.expression??'')===option.id));
  card.onclick=()=>run(()=>{edit(()=>{const target=actorsForEdit().find(x=>x.instanceId===actor.instanceId);if(!target)throw new Error(t("此人物已不在当前句中"));if(option.id)target.expression=option.id;else delete target.expression;},{fields:true});close();});$('expression-grid').append(card);
  const instance={...actor,expression:option.id||undefined,x:.5,y:2.15,scale:2.15,opacity:1,blink:false,mouth:false,flip:false},state={actors:[instance],time:0,speaking:false,entry:{start:0,transition:0,speed:25,chars:[],line:{}}};
  await actorRenderer.prepareFrame(state,canvas);if(version!==expressionPickerVersion)break;actorRenderer.draw(canvas.getContext('2d'),instance,{w:canvas.width,h:canvas.height,brightness:1});card.dataset.ready='true';$('expression-progress').textContent=t("已显示 {0} / {1} 个表情预览",i+1,options.length);
 }}finally{actorRenderer.dispose();}
}
function addLine(kind,black=false){const current=line();edit(()=>{const s=scene();const next=blankLine(kind??(current?.kind==='cutscene'?'dialogue':current?.kind)??'dialogue');next.speaker=current?.speaker??'';next.speakerInstanceId=current?.speakerInstanceId??null;if(Array.isArray(current?.speakerInstanceIds))next.speakerInstanceIds=[...current.speakerInstanceIds];if(black){next.stage={background:null,color:'#000000',actors:[]};next.speakerInstanceId=null;delete next.speakerInstanceIds;next.transition=.5;}s.entries.splice(Math.max(0,s.entries.findIndex(l=>l.id===selectedLine)+1),0,next);selectedLine=next.id;},{fields:true});revealInspectorControl($('line-text'));$('line-text').focus();}
async function persist(manual){
 cancelAutoSave();const version=editVersion;
 setSaveState(manual?'正在保存…':'正在自动保存…');
 const {record,session,current}=await saves.save(project,{manual});
 if(current){projectId=session.id;$('delete-current-project').disabled=!projectId;
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
  // Finish pending writes before shutting down the local service.
  await Promise.allSettled([saves.pending,editorViewWrites]);
  if(!saveBeforeExit&&dirty){
   const choice=await message(t("不保存并退出？"),t("当前修改尚未手动保存。退出后保留上次手动保存的工程和已有自动恢复副本；尚未自动备份的修改会丢失。"),[['继续编辑',()=>{}],['不保存并退出',()=>{}]]);
   if(choice!=='不保存并退出')return;
  }
  if(saveBeforeExit)await persist(true);
  await api('/shutdown',{method:'POST',body:{}});
  editorExited=true;dirty=false;
  document.body.replaceChildren(node('main',saveBeforeExit?t("工程已保存，编辑器已退出。可以关闭此页；下次双击“启动编辑器”继续创作。"):t("编辑器已退出，未执行手动保存。已有自动恢复副本会保留。可以关闭此页；下次双击“启动编辑器”继续创作。"),'tip'));
 }finally{
  exitInProgress=false;
  if(!editorExited){
   for(const surface of surfaces)surface.inert=false;
   if(dirty)scheduleAutoSave();
  }
 }
}
function activateProject(next,{id=null,revision=0,hasEdits=false}={}){
 project=next;
 project.exportSettings??=defaults();
 project.exportSettings.ratio='16:9';
 projectId=id;
 saves.activate(id,revision);
 undo=[];
 redo=[];
 lastEditKey='';
 dirty=hasEdits;
 editVersion++;
 const initial=project.scenes[0];
 selectedScene=initial.id;
 selectedLine=initial.entries[0]?.id;
 recompile();
 renderAll();
}
async function openRecord(id){return switchProject(async()=>{
 const record=await api('/projects/'+id);let data=record.project;
 if(record.recovery)await message(t("发现自动恢复副本"),t("这个工程有尚未手动保存的修改，可以恢复继续编辑。"),[['打开手动保存版',()=>{}],['恢复修改',()=>{data=record.recovery.project;}] ]);
 await refreshReferencedMedia(data);
 const named=localizeLegacySpeakers(data,baseCatalog.characters);
 activateProject(localizeExample(named,interfaceLanguage()),{
  id,revision:record.revision,hasEdits:data!==record.project||named!==data,
 });
 setSaveState(named!==data?'已更新旧工程的发言姓名，请保存':dirty?'已恢复未保存修改':'已打开');
 if(record.missing.length)await message(t("工程有缺失素材"),t("已保留工程引用，未替换素材。缺失 {0} 项：\n{1}",record.missing.length,record.missing.slice(0,8).map(x=>(x.name??x.assetId)+(x.reason?'：'+x.reason:t("（缺少{0}素材）",x.kind))).join('\n')));
});}
async function newProject(data,options){return switchProject(async()=>{
 if(data)await refreshReferencedMedia(data);
 const named=localizeLegacySpeakers(data??blankProject(),baseCatalog.characters);
 activateProject(localizeExample(named,interfaceLanguage()),{hasEdits:true});
 await persist(true);
 return projectId;
},options);}
async function openExampleCopy(){
 const language=interfaceLanguage();
 const id=await newProject(localExample?clone(localExample):createStarterExample(catalog.version,language));
 if(id)toast(t("已建立《{0}》练习副本",localExample?.title??starterExampleInfo(interfaceLanguage()).title));
 return id;
}
function exampleDialog(){
 pause();
 const starter=starterExampleInfo(interfaceLanguage());
 $('example-title').textContent=localExample?.title??starter.title;
 $('example-description').textContent=localExample?t("在副本上编辑可保留源工程。"):starter.description;
 $('example-note').hidden=!localExample;
 $('example-note').textContent=t("本地示例保留它的剧本文字。");
 $('example-error').textContent='';
 $('open-example').disabled=false;
 $('examples-dialog').showModal();
}
async function refreshProjectList(){
 const savedProjects=await api('/projects'),rows=document.createDocumentFragment();
 for(const saved of savedProjects){
  const displayName=saved.title.trim()||t("未命名作品");
  const row=node('div',undefined,'saved-project'),title=node('div',displayName);
  row.dataset.projectId=saved.id;
  title.append(node('small',new Date(saved.savedAt).toLocaleString(interfaceLanguage())));
  const actions=node('div',undefined,'project-row-actions');
  const open=button(t("打开"),async()=>{$('projects-dialog').close();await openRecord(saved.id);});
  const remove=button(t("删除"),()=>deleteProject(saved));
  remove.className='delete-project danger-quiet';remove.setAttribute('aria-label',t("删除工程 {0}",displayName));
  actions.append(open,remove);row.append(title,actions);rows.append(row);
 }
 if(!savedProjects.length)rows.append(node('p',t("尚未保存工程。"),'muted'));
 $('project-list').replaceChildren(rows);
}
async function projectDialog(){
 await refreshProjectList();
 if(!$('projects-dialog').open)$('projects-dialog').showModal();
}
function clearDeletedProject(){
 activateProject(blankProject());
 setSaveState('已删除工程');
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
 $('delete-project-name').textContent=(saved?.title??project.title).trim()||t("未命名作品");
 $('delete-project-date').textContent='';
 hint.textContent=current?t("本机保存的工程、自动恢复副本和当前编辑内容将被删除。"):t("本机保存的工程和自动恢复副本将被删除。");
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
  if(!record){stale=true;throw new Error(t("这个工程已在其他窗口删除。当前内容可用「另存为」保存。"));}
  if(!saved&&record.revision!==saves.session.revision){
   stale=true;throw new Error(t("工程已在其他窗口保存了新版本。请重新打开工程核对，或用「另存为」保留当前内容。"));
  }
  $('delete-project-name').textContent=record.title.trim()||t("未命名作品");
  $('delete-project-date').textContent=t("保存于 {0}",new Date(record.savedAt).toLocaleString(interfaceLanguage()));
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
 if(problem){await message(t("未删除工程"),problem);return;}
 if(cleanupPending)await message(t("工程已删除"),t("正在使用的恢复文件将在下次启动时清理。"));
 else if(deleted&&!current)toast(t("工程已删除"));
}
function stopAuditions(){document.querySelectorAll('#asset-dialog audio').forEach(a=>a.pause());}
function registerAudioAsset(track){
 const existing=transport.assets.get(track.id);
 if(existing&&existing.videoOnly===track.videoOnly)return false;
 transport.addAsset(track);
 const index=baseCatalog.music.findIndex(item=>item.id===track.id);
 if(index<0)baseCatalog.music.unshift(track);else baseCatalog.music[index]=track;
 return true;
}
const isMusicTrack=track=>!track.videoOnly;
async function refreshLocalAudio(){
 const tracks=await api('/local-audio');
 let changed=false;
 for(const track of tracks.reverse())changed=registerAudioAsset(track)||changed;
 if(changed)renderCoverage();
 return changed;
}
async function refreshVideos(){
 const {videos,tracks}=await api('/videos?withAudio=1');
 for(const track of tracks)registerAudioAsset(track);
 baseCatalog.videos.splice(0,baseCatalog.videos.length,...videos);
}
async function refreshReferencedMedia(data){
 const entries=data.scenes.flatMap(scene=>scene.entries);
 const audio=entries.some(item=>[item.music?.assetId,item.video?.audioId].some(id=>id?.startsWith('local_audio_')&&!transport.assets.has(id)));
 const video=entries.some(item=>[item.stage?.background,item.video?.assetId].some(id=>isLocalVideoId(id)&&!videoAsset(id)));
 await Promise.all([audio&&supportsLocalAudio?refreshLocalAudio():null,video?refreshVideos():null]);
}
async function openVideos(purpose){
 pause();
 await refreshVideos();
 const selectedId=purpose==='background'?entry()?.stage.background:purpose==='replace'?line()?.video?.assetId:null;
 videoLibrary.open({purpose,selectedId,onUse:asset=>{
  if(!line())return;
  edit(()=>{
   if(purpose==='background'){
    line().stage??={};line().stage.background=asset.id;
    setBackgroundCrop();
    return;
   }
   const item=purpose==='insert'?blankLine('cutscene'):line();
   item.kind='cutscene';
   item.video={assetId:asset.id,seconds:asset.seconds,...(asset.audioId?{audioId:asset.audioId}:{})};
   if(purpose==='insert'){
    const entries=scene().entries;
    entries.splice(entries.findIndex(entry=>entry.id===selectedLine)+1,0,item);
    selectedLine=item.id;
   }
  },{fields:true});
 }});
}
function useMusic(track){
 const previous=line().music??{};
 const newLocal=track.source==='local'&&previous.assetId!==track.id;
 line().music={
  ...previous,op:'play',assetId:track.id,volume:previous.volume??.7,
  loop:newLocal?false:previous.loop??true,fadeIn:newLocal?0:previous.fadeIn??.5,fadeOut:previous.fadeOut??.5,
  ...(newLocal?{offset:0}:{}),
 };
}
function openPicker(type){
 pause();pickerType=type;pickerGroup=null;$('asset-search').value='';
 renderPicker();$('asset-dialog').showModal();$('asset-dialog').scrollTop=0;
 if(type==='music'&&supportsLocalAudio)run(async()=>{
  if(await refreshLocalAudio()&&$('asset-dialog').open&&pickerType==='music')renderPicker();
 });
}
// Verified default appearances for characters with multiple story outfits.
const defaultCharacterCoverIds=new Set([
 'CHA_Bathilda_SSR_01',
 'CHA_Bibi_NPC_01',
 'CHA_Charolic_SR_01',
 'CHA_Cheyanne_01',
 'CHA_Colphne_SR_01',
 'CHA_Groza_SR_01',
 'CHA_Kuro_02',
 'CHA_Lene_SSR_01',
 'CHA_Lenna_SSR_02',
 'CHA_Levva_SSR_01',
 'CHA_Macqiato_SSR_01',
 'CHA_Nemesis_SR_01',
 'CHA_Sharkry_SR_01',
 'CHA_Springfield_SSR_01',
 'CHA_Suomi_SSR_01',
 'CHA_Vepley_SR_01',
 'CHA_Voymastina_SSR_01',
]);
function renderPicker(){
 stopAuditions();const query=$('asset-search').value.trim().normalize('NFKC').toLowerCase(),all=pickerType==='background'?catalog.backgrounds:pickerType==='character'?catalog.characters:catalog.music.filter(isMusicTrack);
 const matches=x=>pickerType==='character'?catalogCharacterSearchText(x).includes(query):[x.name,x.styleName,x.id,...(x.aliases??[])].filter(Boolean).join(' ').normalize('NFKC').toLowerCase().includes(query);
 let list=all.filter(matches);
 const showGroups=pickerType==='character'&&pickerGroup===null;
 if(showGroups){
  const covers=new Map();
  for(const item of all){
   if(!covers.has(item.name)||defaultCharacterCoverIds.has(item.id))covers.set(item.name,item);
  }
  const groups=new Map();
  for(const item of list){
   if(!groups.has(item.name))groups.set(item.name,{...covers.get(item.name),styles:[]});
   groups.get(item.name).styles.push(item);
  }
  list=[...groups.values()];
 }
 else if(pickerType==='character')list=list.filter(x=>x.name===pickerGroup);
 $('asset-back').hidden=pickerType!=='character'||pickerGroup===null;$('asset-back').onclick=()=>{pickerGroup=null;renderPicker();};
 $('asset-title').textContent=pickerType==='character'?(pickerGroup?t("{0} · 选择造型",catalogCharacterNames(all.find(item=>item.name===pickerGroup),interfaceLanguage()).name):t("选择人物")):pickerType==='background'?t("选择背景"):t("选择背景音乐");$('asset-grid').replaceChildren();$('asset-count').textContent=t("共 {0} 项，已全部列出。{1}",list.length,pickerType==='music'?t("试听音量不改变作品音量。"):t("可按名称或编号搜索。"));
 $('import-audio-from-picker').hidden=pickerType!=='music'||!supportsLocalAudio;
 const cards=document.createDocumentFragment();for(const item of list){
  const card=node('article',undefined,'asset-card');
  if(pickerType==='background'){const img=node('img');img.loading='lazy';img.src=item.thumbnailUrl??`/assets/background/${item.id}/thumb`;img.alt=item.name;card.append(img);}
  if(pickerType==='character'){const img=node('img');img.loading='lazy';img.className='character-thumbnail';img.src=item.thumbnailUrl??('/assets/character/'+item.id+'/thumb');img.alt=catalogCharacterNames(item,interfaceLanguage()).name;card.append(img);}
  const label=pickerType==='character'?(showGroups?catalogCharacterNames(item,interfaceLanguage()).name:actorLabel(item)):item.name;
  card.append(node('p',label));if(showGroups)card.append(node('small',t("{0} 套本地造型",item.styles.length),'muted'));if(pickerType==='character'&&!item.expressionsComplete)card.append(node('small',t("模型表情尚未接入"),'muted'));
  if(pickerType==='music'){
   if(item.source==='local')card.append(node('small',t("本地音频"),'muted'));
   const audio=node('audio');audio.controls=true;audio.preload='none';audio.volume=Number($('monitor-volume').value)/100;audio.src=`/assets/music/${item.id}/full`;audio.onplay=()=>document.querySelectorAll('#asset-dialog audio').forEach(other=>{if(other!==audio)other.pause();});card.append(audio);
  }
  if(pickerType==='character'&&!showGroups){const support=actorCapabilities(item);card.append(node('small',expressionCountNote(item),'capability-note'));const unavailable=[!support.mouth&&t("无嘴部动态"),!support.blink&&t("无自动眨眼")].filter(Boolean);if(unavailable.length)card.append(node('small',unavailable.join(' · '),'capability-note'));}
  if(showGroups){card.append(button(t("选择造型"),()=>{pickerGroup=item.name;renderPicker();}));cards.append(card);continue;}
  card.append(button(t("使用这个{0}",pickerType==='background'?t("背景"):pickerType==='character'?t("人物"):t("音乐")),()=>{edit(()=>{if(pickerType==='background'){line().stage??={};line().stage.background=item.id;setBackgroundCrop();}else if(pickerType==='character'){addActor(item);}else useMusic(item);},{fields:true});stopAuditions();$('asset-dialog').close();}));cards.append(card);
 }
 $('asset-grid').append(cards);
}
function queueRender(){renderPending=true;if(!rendering)run(drainRender);}
async function drainRender(){
 rendering=true;
 try{while(renderPending){renderPending=false;
  const {ratio,watermark}=project.exportSettings,target=compiled,at=time;
  const height=editorView.previewResolution,width=height*16/9;
  // Preview playback is timed independently of the project's export frame rate.
  const videoPlaying=transport.playing;
  const frameAt=videoPlaying?Math.floor(at*previewFrameRate)/previewFrameRate:at;
  const renderKey=`${frameAt}|${videoPlaying}|${editVersion}|${hiddenText}|${revealed}|${width}|${height}`;
  if(renderKey!==lastRenderKey||target!==lastRenderedTimeline){
   if($('stage').width!==width||$('stage').height!==height){$('stage').width=width;$('stage').height=height;}
   $('stage-error').hidden=true;
   try{await renderer.render(target,frameAt,{ratio,hideText:hiddenText,showCompleteText:revealed,watermark,videoPlaying});lastRenderKey=renderKey;lastRenderedTimeline=target;}
   catch(error){$('stage-error').textContent=translateMessage(error.message);$('stage-error').hidden=false;if(transport.playing)pause();}
  }
  $('time-label').textContent=`${fmt(at)} / ${fmt(target.duration)}`;$('scrub').value=at;
  const progress=target.duration?Math.min(100,at/target.duration*100):0;
  $('scrub').style.setProperty('--progress',progress+'%');
  $('dimensions').textContent=`${width} × ${height}`;$('preview-ratio').textContent=t("16:9 横屏");
 }}finally{rendering=false;}
}
async function play(){
 if(transport.playing){pause();queueRender();return;}
 if(!compiled.entries.length)return;
 if(time>=compiled.duration-.01)time=0;
 revealed=false;$('play').textContent=t("正在准备…");await transport.play(compiled,time);if(!transport.playing)return;
 const state=stateAt(compiled,transport.time);if(state){selectedScene=state.sceneId;selectedLine=state.lineId;renderOutline(true);renderInspector();}
 $('play').textContent=t("Ⅱ 暂停");ticking=true;requestAnimationFrame(tick);
}
function tick(){
 if(!ticking||!transport.playing)return;
 const before=stateAt(compiled,time);time=transport.time;const after=stateAt(compiled,time);
 if(before?.lineId!==after?.lineId){
  if(!$('auto-play').checked){pause();time=before.entry.end-1e-6;transport.position=time;revealed=true;queueRender();return;}
  selectedScene=after.sceneId;selectedLine=after.lineId;revealed=false;renderOutline(true);renderInspector();
 }
 if(time>=compiled.duration){pause();time=compiled.duration;revealed=true;}
 queueRender();if(ticking)requestAnimationFrame(tick);
}
async function seek(value){time=Math.max(0,Math.min(compiled.duration,value));revealed=false;await transport.seek(compiled,time);const state=stateAt(compiled,time);if(state){selectedScene=state.sceneId;selectedLine=state.lineId;renderOutline(true);renderInspector();}queueRender();}
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
let mediaCapabilities=null, exportingVideo=false;
function renderExportEncoder(){
 if(!mediaCapabilities)return;
 const {codecs,windowsCodecs,ffmpegCodecs}=mediaCapabilities,codec=$('export-codec').value;
 for(const option of $('export-codec').options)option.disabled=!codecs.includes(option.value);
 $('start-export').disabled=exportingVideo||!codecs.includes(codec);
 $('export-encoder-status').textContent=windowsCodecs.includes(codec)?t("优先使用 Windows Media Foundation，导出前检查所选档位。"):
  ffmpegCodecs.includes(codec)?t("此编码使用外置 FFmpeg。"):t("当前编码不可用，请切换编码或检查本地配置。");
}
function renderSettings(s=project.exportSettings){
 $('export-ratio').value=s.ratio;$('export-resolution').value=s.resolution;$('export-fps').value=s.fps;$('export-bitrate').value=s.bitrateMbps;$('export-codec').value=s.codec;$('export-start').value=s.start??0;$('export-end').value=s.end??compiled.duration;$('export-whole').checked=s.end===null||s.end===undefined;$('watermark-enabled').checked=s.watermark?.enabled??false;$('watermark-text').value=s.watermark?.text??'';updateSettingsSummary(s);renderExportEncoder();
}
function updateSettingsSummary(settings=project.exportSettings){
 $('export-start').disabled=$('export-whole').checked;$('export-end').disabled=$('export-whole').checked;
 try{const x=validateExport(settings,compiled.duration);$('export-summary').textContent=t("{0} × {1} · {2} 秒 · 约 {3} MB",x.width,x.height,(x.end-x.start).toFixed(2),(x.estimatedBytes/1024/1024).toFixed(1));}
 catch(error){$('export-summary').textContent=translateMessage(error.message);}
}
function openExportSettings(settings=project.exportSettings){
 renderSettings(settings);$('settings-dialog').showModal();
}
function openQuickExport(){
 const settings=project.exportSettings;
 const codecs=[...$('export-codec').options].filter(option=>!option.disabled).map(option=>option.value);
 const codec=codecs.includes(settings.codec)?settings.codec:codecs[0]??settings.codec;
 openExportSettings({...settings,codec,start:0,end:compiled.duration>3?3:null});
 $('start-export').focus();
}
function bindMenus(){
 function closeMenu(menu){
  if(!menu)return;
  menu.open=false;
  menu.querySelector(':scope > summary')?.focus({preventScroll:true});
 }
 document.addEventListener('click',event=>{
  if(event.target.closest('.menu-panel button'))closeMenu(event.target.closest('.toolbar-menu[open]'));
 },true);
 document.addEventListener('pointerdown',event=>{
  for(const menu of document.querySelectorAll('.toolbar-menu[open]')){
   if(!menu.contains(event.target))menu.open=false;
  }
 });
 document.addEventListener('keydown',event=>{
  if(event.key!=='Escape')return;
  const menu=event.target.closest('.toolbar-menu[open]');
  if(menu){event.preventDefault();closeMenu(menu);}
 });
}
function bindPreviewViewport(){
 const viewport=$('stage-fit'),frame=$('stage-wrap'),zoom=$('preview-zoom'),reset=$('reset-preview-view');
 const levels=Array.from(zoom.options,option=>Number(option.value));
 let scale=1,panX=0,panY=0,drag=null;
 let wheelDistance=0,lastWheelTime=0;
 const constrain=(offset,available,scaled)=>{
  const visible=Math.min(48,available/2,scaled/2);
  const limit=available/2+scaled/2-visible;
  return Math.max(-limit,Math.min(limit,offset));
 };
 function updateViewport(){
  panX=constrain(panX,viewport.clientWidth,frame.offsetWidth*scale);
  panY=constrain(panY,viewport.clientHeight,frame.offsetHeight*scale);
  const fitted=scale===1&&panX===0&&panY===0;
  frame.style.transform=fitted?'':'translate('+panX+'px, '+panY+'px) scale('+scale+')';
  zoom.value=String(scale);
  reset.disabled=fitted;
 }
 function zoomTo(level,anchorX=0,anchorY=0){
  if(level===scale)return;
  const ratio=level/scale;
  panX=anchorX+(panX-anchorX)*ratio;
  panY=anchorY+(panY-anchorY)*ratio;
  scale=level;
  updateViewport();
 }
 zoom.onchange=()=>zoomTo(Number(zoom.value));
 reset.onclick=()=>{
  scale=1;
  panX=panY=0;
  wheelDistance=0;
  updateViewport();
 };
 viewport.addEventListener('wheel',event=>{
  if(document.fullscreenElement||event.ctrlKey||event.metaKey||!event.deltaY||Math.abs(event.deltaX)>Math.abs(event.deltaY))return;
  event.preventDefault();
  const delta=event.deltaMode===1?event.deltaY*16:event.deltaMode===2?event.deltaY*viewport.clientHeight:event.deltaY;
  if(event.timeStamp-lastWheelTime>180||Math.sign(wheelDistance)!==Math.sign(delta))wheelDistance=0;
  lastWheelTime=event.timeStamp;
  wheelDistance+=delta;
  if(Math.abs(wheelDistance)<40)return;
  const step=wheelDistance<0?1:-1,current=levels.indexOf(scale);
  wheelDistance=0;
  const next=levels[Math.max(0,Math.min(levels.length-1,current+step))];
  const rect=viewport.getBoundingClientRect();
  zoomTo(next,event.clientX-rect.left-rect.width/2,event.clientY-rect.top-rect.height/2);
 },{passive:false});
 function finishPan(event){
  if(drag?.id!==event.pointerId)return;
  drag=null;
  viewport.classList.remove('is-preview-panning');
  if(viewport.hasPointerCapture(event.pointerId))viewport.releasePointerCapture(event.pointerId);
 }
 viewport.addEventListener('pointerdown',event=>{
  if(event.button!==1||event.buttons!==4||document.fullscreenElement||drag)return;
  event.preventDefault();
  drag={id:event.pointerId,x:event.clientX,y:event.clientY};
  viewport.setPointerCapture(event.pointerId);
  viewport.classList.add('is-preview-panning');
 });
 viewport.addEventListener('pointermove',event=>{
  if(drag?.id!==event.pointerId)return;
  if(!(event.buttons&4)){finishPan(event);return;}
  panX+=event.clientX-drag.x;
  panY+=event.clientY-drag.y;
  drag.x=event.clientX;
  drag.y=event.clientY;
  updateViewport();
 });
 for(const type of ['pointerup','pointercancel','lostpointercapture'])viewport.addEventListener(type,finishPan);
 for(const type of ['mousedown','auxclick'])viewport.addEventListener(type,event=>{
  if(event.button===1)event.preventDefault();
 });
 new ResizeObserver(updateViewport).observe(viewport);
 updateViewport();
}
function bind(){
 bindMenus();
 bindInspectorTabs();
 bindPreviewViewport();
 document.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>$(b.dataset.close).close());$('asset-dialog').addEventListener('close',stopAuditions);
 $('project-title').oninput=()=>edit(()=>{
  const title=$('project-title');
  project.title=title.value;
  title.title=title.value;
 },{key:'title'});
 $('line-kind').onchange=()=>{
  const kind=$('line-kind').value;
  if(kind==='cutscene'){$('line-kind').value=line().kind;run(()=>openVideos('replace'));return;}
  edit(()=>{line().kind=kind;delete line().video;},{fields:true});
 };
 for(const [id,key] of [['speaker','speaker'],['line-text','text']])$(id).oninput=()=>edit(()=>line()[key]=$(id).value,{key:id});
 for(const [id,key] of [['text-speed','charactersPerSecond'],['hold','hold'],['transition','transition']])$(id).onchange=()=>{if(!$(id).checkValidity()||$(id).value==='')return;run(()=>edit(()=>line()[key]=Number($(id).value),{key:id}));};
 $('add-line').onclick=()=>run(()=>addLine());$('add-narration').onclick=()=>run(()=>addLine('narration'));
 $('add-pause').onclick=()=>run(()=>addLine('pause'));$('add-black').onclick=()=>run(()=>addLine('pause',true));
 $('add-cutscene').onclick=()=>run(()=>openVideos('insert'));
 $('replace-cutscene').onclick=()=>run(()=>openVideos('replace'));
 $('choose-video-background').onclick=()=>run(()=>openVideos('background'));
 $('cutscene-audio').onchange=()=>edit(()=>{
  const clip=line().video,asset=videoAsset(clip.assetId);
  if($('cutscene-audio').checked&&asset?.audioId)clip.audioId=asset.audioId;else delete clip.audioId;
 },{fields:true});
 for(const id of ['shake-amount','shake-duration'])$(id).onchange=()=>{if(!$('shake-duration').checkValidity())return;run(()=>edit(()=>{line().effects??={};const amount=Number($('shake-amount').value);if(amount===0)delete line().effects.shake;else line().effects.shake={amount,duration:Number($('shake-duration').value)};},{key:'shake'}));};
 $('add-scene').onclick=()=>edit(()=>{const next={id:uid(),title:t("场景 {0}",project.scenes.length+1),entries:[blankLine('narration')]};project.scenes.push(next);selectedScene=next.id;selectedLine=next.entries[0].id;},{fields:true});
 $('duplicate-line').onclick=()=>edit(()=>{const l=clone(line());l.id=uid();const list=scene().entries;list.splice(list.findIndex(x=>x.id===selectedLine)+1,0,l);selectedLine=l.id;},{fields:true});
 $('delete-line').onclick=()=>edit(()=>{const list=scene().entries,index=list.findIndex(x=>x.id===selectedLine);list.splice(index,1);if(!list.length)list.push(blankLine());selectedLine=list[Math.min(index,list.length-1)].id;},{fields:true});
 $('undo').onclick=()=>historyStep(undo,redo);$('redo').onclick=()=>historyStep(redo,undo);
 $('examples-button').onclick=()=>run(exampleDialog);$('open-example').onclick=()=>run(async()=>{await openExampleCopy();$('examples-dialog').close();});
 $('new-project').onclick=()=>run(()=>newProject());$('open-project').onclick=()=>run(projectDialog);$('delete-current-project').onclick=()=>run(()=>deleteProject());$('save-project').onclick=()=>run(()=>persist(true));
 $('save-as').onclick=()=>run(async()=>{const copy=clone(project);copy.title+=t(" · 副本");await newProject(copy,{savingCopy:true});toast(t("已另存为新工程"));});
 $('download-project').onclick=()=>run(async()=>{await persist(true);const response=await fetch(`/api/projects/${projectId}/download`,{headers:{'x-gf2-token':token}});if(!response.ok)throw new Error(t("工程下载失败"));const url=URL.createObjectURL(await response.blob()),a=node('a');a.href=url;a.download=(project.title.replace(/[<>:"/\\|?*]/g,'_')||t("作品"))+'.gf2story.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
 $('import-project').onchange=()=>run(async()=>{const f=$('import-project').files[0];if(!f)return;if(f.size>IMAGE_LIMITS.projectBytes)throw new Error(t("工程文件超过48 MB"));const checked=await api('/projects/check',{method:'POST',body:JSON.parse(await f.text())});$('projects-dialog').close();await newProject(checked.project);if(checked.missing.length)await message(t("工程缺少素材"),t("缺失 {0} 项素材。已保留原引用，没有替换。",checked.missing.length));$('import-project').value='';});
 $('add-actor').onclick=()=>openPicker('character');$('inherit-actors').onclick=()=>edit(()=>{if(line().stage)delete line().stage.actors;},{fields:true});
 $('speaker-actor').onchange=()=>edit(()=>setSpeakers($('speaker-actor').value?[$('speaker-actor').value]:[],false),{fields:true});
 $('chorus-enabled').onchange=()=>edit(()=>setSpeakers(speakerIds(line()),$('chorus-enabled').checked),{fields:true});
 $('import-actor').onclick=()=>openImageImport('actor');$('import-background').onclick=()=>openImageImport('background');
 let drag; $('stage').onpointerdown=event=>{if(line()?.kind==='cutscene'||event.button!==0||!$('drag-actor').checked||!$('stage-actor').value)return;pause();const id=$('stage-actor').value,a=entry().stage.actors.find(x=>x.instanceId===id),c=entry().stage.compositions?.[project.exportSettings.ratio]?.actors?.[id]??{},rect=$('stage').getBoundingClientRect();drag={id,x:c.x??a.x??.5,y:c.y??1,clientX:event.clientX,clientY:event.clientY,rect};$('stage').setPointerCapture(event.pointerId);};
 $('stage').onpointermove=event=>{if(!drag)return;const x=Math.max(-5,Math.min(5,drag.x+(event.clientX-drag.clientX)/drag.rect.width)),y=Math.max(-5,Math.min(5,drag.y+(event.clientY-drag.clientY)/drag.rect.height));edit(()=>moveActor(drag.id,{x,y}),{key:'drag-'+drag.id});};
 $('stage').onpointerup=$('stage').onpointercancel=()=>{if(drag){drag=null;renderInspector();}};
 $('stage-tint').onchange=()=>edit(()=>{line().stage??={};if($('stage-tint').value)line().stage.tint=$('stage-tint').value;else delete line().stage.tint;},{fields:true});
 $('choose-background').onclick=()=>openPicker('background');$('choose-music').onclick=()=>openPicker('music');
 $('import-audio').onclick=()=>openAudioImport();
 $('import-audio-from-picker').onclick=()=>{stopAuditions();$('asset-dialog').close();openAudioImport();};

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
 $('play').onclick=()=>run(play);$('next-line').onclick=()=>run(()=>advance());$('previous-line').onclick=()=>run(()=>advance(-1));$('stage').onclick=event=>{if(event.button===0&&(!$('drag-actor').checked||line()?.kind==='cutscene'))run(()=>advance());};$('scrub').oninput=()=>run(()=>seek(Number($('scrub').value)));
 $('monitor-volume').oninput=()=>transport.setMonitor(Number($('monitor-volume').value)/100);
 $('hide-text').onclick=()=>{hiddenText=!hiddenText;$('hide-text').textContent=hiddenText?t("显示文字"):t("隐藏文字");queueRender();};$('fullscreen').onclick=()=>run(()=>$('stage').requestFullscreen());
 $('history-button').onclick=()=>{
  $('history-list').replaceChildren();
  for(const e of compiled.entries.filter(entry=>entry.start<=time&&entry.line.kind!=='pause')){
   const b=button('',()=>{run(()=>seek(e.start));$('history-dialog').close();});
   const clip=e.video&&videoAsset(e.video.assetId);
   const name=e.video?t('过场视频'):e.line.kind==='narration'?t("旁白"):e.line.speaker||t("角色台词");
   b.className='history-entry';
   b.append(node('strong',name),node('p',e.video?(clip?.name??t('视频素材不存在。')):e.line.text));
   $('history-list').append(b);
  }
  $('history-dialog').showModal();
 };
 $("subtitle-button").onclick = () => {
  renderSubtitleSettings();
  $("subtitle-dialog").showModal();
 };
 $("subtitle-mode").onchange = () => {
  edit(() => { project.subtitleSettings = { ...compiled.subtitleSettings, mode: $("subtitle-mode").value }; });
  renderSubtitleSettings();
 };
 $("subtitle-font-language").onchange = () => {
  edit(() => { project.subtitleSettings = { ...compiled.subtitleSettings, fontLanguage: $("subtitle-font-language").value }; });
 };
 for (const [part, input] of Object.entries(subtitleColorInputs)) {
  $(input).oninput = () => {
   const settings = compiled.subtitleSettings;
   edit(() => {
    project.subtitleSettings = { ...settings, colors: { ...settings.colors, [part]: $(input).value } };
   }, { key: input });
  };
 }
 $('settings-button').onclick=()=>openExportSettings();

 const settingChange=()=>edit(()=>{const s=project.exportSettings;s.ratio='16:9';s.resolution=Number($('export-resolution').value);s.fps=Number($('export-fps').value);s.bitrateMbps=Number($('export-bitrate').value);s.codec=$('export-codec').value;s.start=$('export-whole').checked?0:Number($('export-start').value);s.end=$('export-whole').checked?null:Number($('export-end').value);s.watermark={enabled:$('watermark-enabled').checked,text:$('watermark-text').value};},{key:'settings',fields:true});
 $('watermark-text').oninput=()=>run(settingChange);
 for(const id of ['export-ratio','export-resolution','export-fps','export-bitrate','export-codec','export-start','export-end','export-whole','watermark-enabled','watermark-text'])$(id).onchange=()=>run(settingChange);
 $('export-preset').onchange=()=>edit(()=>{const keep=project.exportSettings.watermark;project.exportSettings={...defaults(),watermark:keep,...($('export-preset').value==='reference'?{resolution:1440,fps:60,bitrateMbps:60}:{})};renderSettings();},{fields:true});
 $('preview-export').onclick=()=>run(async()=>{settingChange();pause();$('settings-dialog').close();await seek(project.exportSettings.start??0);});
 $('start-export').onclick=()=>run(async()=>{
  if(exportingVideo)return;
  exportingVideo=true;renderExportEncoder();
  $('export-progress').hidden=false;$('export-download').hidden=true;
  try{
   settingChange();pause();await persist(true);const result=await exportVideo(project,project.exportSettings,status=>{$('cancel-export').hidden=!['preparing','rendering','encoding'].includes(status.state);$('export-progress').value=status.progress;$('export-status').textContent=({preparing:t("正在检查编码器并准备音频…"),rendering:t("正在绘制 {0} / {1} 帧",status.completedFrames,status.frames),encoding:t("正在完成视频编码…"),completed:t("导出完成"),cancelled:t("导出已取消"),failed:translateMessage(status.error)})[status.state];});$('export-status').textContent=t("导出完成 · {0}",result.output);$('export-download').href='/exports/'+result.id+'.mp4';$('export-download').hidden=false;toast(t("MP4 已保存到 exports 文件夹"));}
  // A deliberate cancel is not an error: no red status, no toast, no console error.
  catch(error){$('export-status').textContent=translateMessage(error.message);if(error.code!=='EXPORT_CANCELLED')throw error;}
  finally{exportingVideo=false;renderExportEncoder();$('cancel-export').hidden=true;}
 });
 $('cancel-export').onclick=()=>run(cancelExport);
 $('exit-editor-top').onclick=()=>run(()=>exitEditor(true));
 $('quit-editor-top').onclick=()=>run(()=>exitEditor(false));
 document.addEventListener('keydown',event=>{if(document.querySelector('#image-import-dialog[open],#audio-import-dialog[open],#tutorial-dialog[open],#delete-project-dialog[open],#projects-dialog[open]')&&(event.ctrlKey||event.metaKey)&&['s','z'].includes(event.key.toLowerCase())){event.preventDefault();return;}if(projectSwitching||exitInProgress||editorExited)return;if(event.ctrlKey||event.metaKey){if(event.key.toLowerCase()==='s'){event.preventDefault();run(()=>persist(true));}if(event.key.toLowerCase()==='z'){event.preventDefault();historyStep(event.shiftKey?redo:undo,event.shiftKey?undo:redo);}}else if(event.code==='Space'&&!['INPUT','TEXTAREA','SELECT','BUTTON','SUMMARY'].includes(document.activeElement.tagName)&&!document.querySelector('dialog[open]')){event.preventDefault();run(()=>advance());}});
 window.addEventListener('beforeunload',event=>{if(dirty){event.preventDefault();event.returnValue='';}});
}
function renderAuthorCredit(){setupCredits(session);}
let noticeDialogState=null;
function markNoticeSection(){
 const body=$('rights-notice-body'),toc=$('rights-notice-toc');
 const top=body.getBoundingClientRect().top+26;
 const buttons=[...toc.querySelectorAll('[data-notice-section]')].filter(button=>!button.hidden);
 let current=buttons[0];
 const jump=noticeDialogState?.sectionJump;
 if(jump?.scrollTop===body.scrollTop){
  // The last sections may be visible together when the viewport reaches its scroll limit.
  current=buttons.find(button=>button.dataset.noticeSection===jump.id)??current;
 }else{
  if(noticeDialogState)noticeDialogState.sectionJump=null;
  for(const button of buttons){
   const heading=$(button.dataset.noticeSection);
   if(heading.getBoundingClientRect().top>top)break;
   current=button;
  }
  if(body.scrollTop>0&&body.scrollTop+body.clientHeight>=body.scrollHeight-2)current=buttons.at(-1);
 }
 for(const button of buttons){
  if(button===current)button.setAttribute('aria-current','location');
  else button.removeAttribute('aria-current');
 }
}
function scrollNoticeTo(heading){
 const body=$('rights-notice-body');
 body.scrollTop+=heading.getBoundingClientRect().top-body.getBoundingClientRect().top-20;
 if(noticeDialogState)noticeDialogState.sectionJump={id:heading.id,scrollTop:body.scrollTop};
 markNoticeSection();
}
function prepareRightsNotice(){
 const dialog=$('rights-notice-dialog'),confirm=$('rights-notice-confirm'),accept=$('accept-rights-notice'),decline=$('decline-rights-notice'),errorText=$('rights-notice-error');
 renderRightsCopy();
 const body=$('rights-notice-body'),toc=$('rights-notice-toc');
 body.addEventListener('scroll',markNoticeSection,{passive:true});
 toc.addEventListener('click',event=>{
  const button=event.target.closest('[data-notice-section]');
  const heading=button&&$(button.dataset.noticeSection);
  if(!heading)return;
  scrollNoticeTo(heading);
  heading.focus({preventScroll:true});
 });
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
 const failure=error=>{errorText.textContent=translateMessage(error.message);errorText.hidden=false;};
 accept.onclick=async()=>{
  const state=noticeDialogState;if(!state||state.busy||!confirm.checked)return;
  state.busy=true;busy(true);errorText.hidden=true;accept.textContent=t("正在确认…");
  try{await api('/notice/accept',{method:'POST',body:{...session.noticeDisclosures[interfaceLanguage()],accepted:true}});state.accepted=true;dialog.close();}
  catch(error){failure(new Error(t("未能记录同意状态：{0} 请重试，或选择“不同意并退出”。",translateMessage(error.message))));}
  finally{state.busy=false;busy(false);accept.textContent=t("我已阅读并同意，进入软件");}
 };
 decline.onclick=async()=>{
  const state=noticeDialogState;if(!state||state.busy)return;
  state.busy=true;busy(true);errorText.hidden=true;
  try{
   await exitEditor(false);
   if(editorExited){noticeDialogState=null;state.resolve(false);}
  }catch(error){failure(new Error(t("退出未完成：{0} 也可关闭此页面和启动终端。",error.message)));}
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
 $('rights-notice-hint').hidden=required;
 renderRightsCopy();
 $('rights-notice-dialog').showModal();
 $('rights-notice-body').scrollTop=0;
 markNoticeSection();
 $('rights-notice-title').focus({preventScroll:true});
 return state.promise;
}
function renderRightsCopy(){
 const toc=$('rights-notice-toc');
 const current=toc.querySelector('[aria-current]')?.dataset.noticeSection;
 const body=$('rights-notice-body');
 renderNoticeBody(body,rightsNotice,teamCredits(session.author,session.coAuthors));
 for(const button of toc.querySelectorAll('[data-notice-section]'))button.hidden=!$(button.dataset.noticeSection);
 if($('rights-notice-dialog').open){
  const heading=current&&$(current);
  if(heading)scrollNoticeTo(heading);
  else markNoticeSection();
 }
 if(noticeDialogState?.busy)$('accept-rights-notice').textContent=t('正在确认…');
}
function renderCoverage(){
 const release=session.release;
 const uiVersion=document.documentElement.dataset.editorVersion;
 const versionLabel=release?`v${release.version}`:t("服务待重启");
 $('coverage-notice').replaceChildren(node('span',t("{0} · 本地离线",versionLabel),'release-label'),node('span',t("{0} 套人物造型 / {1} 张背景 / {2} 首 BGM",catalog.characters.length,catalog.backgrounds.length,catalog.music.filter(isMusicTrack).length),'library-summary'));
 if(release?.version!==uiVersion){
  const status=node('span',t("界面已更新至 v{0}。保存并退出后重新启动，可更新本地服务。",uiVersion));
  $('coverage-notice').append(status);
 }
}
function refreshExampleLanguage(language){
 const localized=localizeExample(project,language);
 if(localized===project)return;
 const playing=transport.playing;
 if(playing)pause();
 const previous=stateAt(compiled,time)?.entry;
 project=localized;
 recompile();
 const entry=previous&&compiled.entries.find(item=>item.line.id===previous.line.id);
 if(entry)time=entry.start+Math.min(entry.end-entry.start,Math.max(0,time-previous.start));
 else time=Math.min(time,compiled.duration);
 transport.position=time;
 displayProjectTitle();
 queueRender();
 if(playing)run(play);
}
let languageWrites=Promise.resolve();
function changeLanguage(value){
 if(!setInterfaceLanguage(value))return;
 clearTimeout(toastTimer);
 $('toast').hidden=true;
 renderAuthorCredit();
 renderRightsCopy();
 renderSaveState();
 if(project){
  refreshExampleLanguage(value);
  renderCoverage();renderOutline(true);renderInspector();renderSubtitleSettings();renderSettings();
  $('play').textContent=transport.playing?t('Ⅱ 暂停'):t('▶ 播放');
  $('hide-text').textContent=hiddenText?t('显示文字'):t('隐藏文字');
  $('preview-ratio').textContent=t('16:9 横屏');
  if($('asset-dialog').open&&pickerType==='character')renderPicker();
  tutorial?.refreshLocale();
  videoLibrary?.refresh();
 }
 languageWrites=languageWrites.catch(()=>{}).then(()=>api('/language',{method:'POST',body:{language:value}}));
 languageWrites.catch(()=>toast(t('无法保存界面语言')));
}
async function initialize(){
 setupLanguageControls(session.interfaceLanguage,changeLanguage);
 bindEditorView();
 renderAuthorCredit();prepareRightsNotice();
 if(session.noticeAccepted!==true&&!await showRightsNotice(true))return;
 const [received,configuredExample]=await Promise.all([api('/catalog'),api('/example')]);
 localExample=configuredExample;
 baseCatalog=catalog={...received,videos:received.videos??[],characters:received.characters.map(characterDisplayRecord)};
 renderCoverage();
 mediaCapabilities=await exportCapabilities();renderExportEncoder();
 actorRenderer=new ActorRenderer(catalog);
 videoFrames=new VideoFrames(baseCatalog);
 renderer=new StageRenderer($('stage'),{actorRenderer:actorRenderer.draw,imageLoader:id=>loadBackgroundImage(catalog,id),videoFrames});
 transport=new MusicTransport(catalog.music,{onError:reportError});
 const firstProject=(await api('/projects')).length===0;
 activateProject(firstProject&&localExample?localizeExample(clone(localExample),interfaceLanguage()):blankProject());
 setSaveState(firstProject&&localExample?localExample.title+' · 可直接播放或编辑':'请选择工程，或开始新作品');
 openImageImport=setupImageImport({api,getProject:()=>project,onPause:pause,onImport:item=>edit(()=>{
  project.customImages=[...(project.customImages??[]).filter(i=>i.id!==item.id),item];
  if(item.kind==='background'){line().stage??={};line().stage.background=item.id;setBackgroundCrop();}
  else addActor({...item,source:'custom'});
 },{fields:true})});
 if(supportsLocalAudio){
  const {setupAudioImport}=await import('/audio-import.mjs');
  openAudioImport=setupAudioImport({onPause:pause,onImport:track=>{
   if(registerAudioAsset(track))renderCoverage();
   edit(()=>useMusic(track),{fields:true});
  }});
  $('import-audio').hidden=false;
 }
 videoLibrary=setupVideoLibrary({
  getVideos:()=>baseCatalog.videos,onPause:pause,
  onImport:asset=>{
   const index=baseCatalog.videos.findIndex(video=>video.id===asset.id);
   if(index<0)baseCatalog.videos.unshift(asset);else baseCatalog.videos[index]=asset;
  },
  onAudio:track=>{if(registerAudioAsset(track))renderCoverage();},
 });
 tutorial=setupTutorial({
  api,onError:reportError,onPause:pause,getProject:()=>project,
  selectEntry:(sceneId,lineId)=>select(lineId,sceneId),
  revealControl:revealInspectorControl,
  actions:{
   example:openExampleCopy,
   quickExample:openExampleCopy,
   resumeExample:async id=>{
    if(projectId!==id)await openRecord(id);
    if(projectId!==id)throw new Error(t("练习副本尚未打开，请再试一次。"));
   },
   subtitle:()=>$('subtitle-button').click(),
   quickExport:openQuickExport,
   export:openExportSettings,
  }
 });
 bind();await tutorial.firstRun();
}
run(initialize);
