import {graphemes} from './timeline.mjs';
import {halfwidthTraditionalPunctuation} from './interface-language.mjs';

const columns={'zh-TW':0,en:1,ja:2};

export function exampleText(value, original, alternatives, language) {
  if (!alternatives) return value;
  const previousTraditional = alternatives[columns['zh-TW']];
  const traditional = typeof previousTraditional === 'string'
    ? halfwidthTraditionalPunctuation(previousTraditional) : previousTraditional;
  if (value !== original && value !== traditional && !alternatives.includes(value)) return value;
  return (language === 'zh-TW' ? traditional : alternatives[columns[language]]) ?? original;
}

function stockRate(line, text) {
  const speed=line.charactersPerSecond??25;
  const count=graphemes(line.text).length;
  if (!count || text===line.text) return speed;
  return Math.min(120,Math.max(1,graphemes(text).length*speed/count));
}

function sameSpeaker(line, original) {
  const a=line.speakerInstanceIds??[], b=original.speakerInstanceIds??[];
  return (line.speakerInstanceId??null)===(original.speakerInstanceId??null) &&
    a.length===b.length && a.every((id,i)=>id===b[i]);
}

// Match the shipped IDs and stock text. A customized field keeps its own value.
export function createExampleTranslator(template, copy) {
  const scenes=new Map(template.scenes.map(scene=>[scene.id,scene]));
  const lines=new Map(template.scenes.flatMap(scene=>scene.entries.map(line=>[line.id,line])));
  return (project, language) => {
    if (!project.scenes.some(scene=>scenes.has(scene.id)||scene.entries.some(line=>lines.has(line.id)))) return project;
    const title=exampleText(project.title,template.title,copy.title,language);
    let changed=title!==project.title;
    const translatedScenes=project.scenes.map(scene=>{
      const original=scenes.get(scene.id);
      const name=original?exampleText(scene.title,original.title,copy.scenes[scene.id],language):scene.title;
      let changedScene=name!==scene.title;
      const entries=scene.entries.map(line=>{
        const stock=lines.get(line.id);
        if (!stock || line.kind!==stock.kind) return line;
        const text=exampleText(line.text,stock.text,copy.lines[line.id],language);
        const speaker=sameSpeaker(line,stock)?exampleText(line.speaker,stock.speaker,copy.speakers[stock.speaker],language):line.speaker;
        if (text===line.text && speaker===line.speaker) return line;
        const translated={...line,text,speaker};
        const speed=line.charactersPerSecond??25;
        // Stock translations retain the same reveal duration. Honor manual speed edits.
        if (text!==line.text && (speed===(stock.charactersPerSecond??25)||Math.abs(speed-stockRate(stock,line.text))<1e-9)) {
          translated.charactersPerSecond=stockRate(stock,text);
        }
        changedScene=true;
        return translated;
      });
      if (!changedScene) return scene;
      changed=true;
      return {...scene,title:name,entries};
    });
    return changed?{...project,title,scenes:translatedScenes}:project;
  };
}
