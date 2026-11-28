import {createExampleTranslator,exampleText} from './example-language.mjs';
import {defaultInterfaceLanguage,isInterfaceLanguage} from './interface-language.mjs';

const info={
  title:'对白练习',
  description:'用一段纯色背景和一句对白练习编辑、预览与导出。',
};
const description=['用一段單色背景和一句對白練習編輯、預覽與匯出。','Edit, preview and export a line of dialogue on a solid background.','単色の背景と1行のセリフで、編集・プレビュー・書き出しを練習できます。'];
const sceneId='gfse-practice-scene';
const lineId='gfse-practice-line';
const template={
  formatVersion:1,actorFramingRevision:2,title:info.title,
  scenes:[{id:sceneId,title:'场景一',entries:[{
    id:lineId,kind:'dialogue',speaker:'小林',text:'先看一遍，再换成你的台词。',
    charactersPerSecond:25,hold:4,transition:0,music:{op:'inherit'},stage:{color:'#253747'},
  }]}],
};
const stockScene=template.scenes[0],stockLine=stockScene.entries[0];
const copy={
  title:['對白練習','Dialogue practice','セリフの練習'],
  scenes:{[sceneId]:['場景一','Scene 1','シーン1']},
  speakers:{'小林':['小林','Lin','小林']},
  lines:{[lineId]:['先看一遍，再換成你的台詞。','Watch this once, then replace it with your own line.','まず再生してから、自分のセリフに変えてみましょう。']},
};
const localize=createExampleTranslator(template,copy);

export function starterExampleInfo(language) {
  return {
    title:exampleText(info.title,info.title,copy.title,language),
    description:exampleText(info.description,info.description,description,language),
  };
}

export function createStarterExample(catalogVersion, language) {
  const fontLanguage=isInterfaceLanguage(language)?language:defaultInterfaceLanguage;
  return localize({...structuredClone(template),catalogVersion,subtitleSettings:{mode:'game',fontLanguage}},language);
}

export function localizeStarterExample(project, language) {
  const next=localize(project,language);
  if (next!==project || project.scenes.length!==1 || project.scenes[0].entries.length!==1) return next;
  // Earlier versions used random IDs for this practice. Recognize its exact stock structure.
  const [scene]=project.scenes, [line]=scene.entries;
  if (line.kind!=='dialogue' || line.hold!==4 || line.transition!==0 || line.stage?.color!=='#253747' ||
      line.stage.background || line.stage.actors?.length || line.speakerInstanceId || line.speakerInstanceIds?.length ||
      line.music?.op!=='inherit') return project;
  const known=(value,original,alts)=>exampleText(value,original,alts,'zh-CN')===original;
  if (!known(project.title,template.title,copy.title) || !known(scene.title,stockScene.title,copy.scenes[sceneId]) ||
      !known(line.speaker,stockLine.speaker,copy.speakers[stockLine.speaker]) ||
      !known(line.text,stockLine.text,copy.lines[lineId])) return project;
  const legacyTemplate={...template,scenes:[{...stockScene,id:scene.id,entries:[{...stockLine,id:line.id}]}]};
  const legacyCopy={...copy,scenes:{[scene.id]:copy.scenes[sceneId]},lines:{[line.id]:copy.lines[lineId]}};
  return createExampleTranslator(legacyTemplate,legacyCopy)(project,language);
}
