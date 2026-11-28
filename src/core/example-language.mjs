import {graphemes} from './timeline.mjs';
import {halfwidthTraditionalPunctuation} from './interface-language.mjs';
import {PROJECT_LIMITS} from './project-budget.mjs';

const columns={'zh-TW':0,en:1,ja:2};

export function exampleText(value, original, alternatives, language) {
  if (!alternatives) return value;
  const previousTraditional = alternatives[columns['zh-TW']];
  const traditional = typeof previousTraditional === 'string'
    ? halfwidthTraditionalPunctuation(previousTraditional) : previousTraditional;
  if (value !== original && value !== traditional && !alternatives.includes(value)) return value;
  return (language === 'zh-TW' ? traditional : alternatives[columns[language]]) ?? original;
}

function stockRate(line, text, speed=line.charactersPerSecond??25) {
  const count=graphemes(line.text).length;
  if (!count || text===line.text) return speed;
  return Math.min(PROJECT_LIMITS.textSpeed,Math.max(1,graphemes(text).length*speed/count));
}

function sameSpeaker(line, original) {
  const a=line.speakerInstanceIds??[], b=original.speakerInstanceIds??[];
  return (line.speakerInstanceId??null)===(original.speakerInstanceId??null) &&
    a.length===b.length && a.every((id,i)=>id===b[i]);
}

// Match the shipped IDs and stock text. A customized field keeps its own value.
export function createExampleTranslator(template, copy, previousTimingsFor) {
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
        const variants=copy.lines[line.id];
        const text=exampleText(line.text,stock.text,variants,language);
        const speaker=sameSpeaker(line,stock)?exampleText(line.speaker,stock.speaker,copy.speakers[stock.speaker],language):line.speaker;
        const speed=line.charactersPerSecond??25;
        const previousTiming=stock.kind!=='pause' && exampleText(line.text,stock.text,variants,'zh-CN')===stock.text
          ? previousTimingsFor?.(stock).find(timing=>Math.abs(speed-stockRate(stock,line.text,timing.speed))<1e-9)
          : undefined;
        // Only replace the timing of an old copy when its text and timing still match the shipped line.
        const retime=previousTiming && line.transition===stock.transition && line.hold===previousTiming.hold;
        if (text===line.text && speaker===line.speaker && !retime) return line;

        const translated={...line,text,speaker};
        if (retime) {
          translated.charactersPerSecond=stockRate(stock,text);
          translated.hold=stock.hold;
        } else if (text!==line.text) {
          // Retain the cadence of stock translations when switching interface languages.
          if (speed===(stock.charactersPerSecond??25)||Math.abs(speed-stockRate(stock,line.text))<1e-9) {
            translated.charactersPerSecond=stockRate(stock,text);
          } else if (previousTiming) {
            translated.charactersPerSecond=stockRate(stock,text,previousTiming.speed);
          }
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
