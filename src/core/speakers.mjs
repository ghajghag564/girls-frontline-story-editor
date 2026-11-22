/** An explicit array, including [], takes precedence over a legacy single speaker. */
export const speakerIds=line=>Array.isArray(line?.speakerInstanceIds)?line.speakerInstanceIds:line?.speakerInstanceId?[line.speakerInstanceId]:[];
export const isSpeakingActor=(line,id)=>speakerIds(line).includes(id);

// An earlier project format could save a generated speaker caption.
// Only replace an exact generated caption for the speakers actually on stage.
export function localizeLegacySpeakers(project,characters){
 const byAsset=new Map([...characters,...(project.customImages??[])].map(item=>[item.id,item]));
 let actors=[],changed=false;
 const caption=names=>[...new Set(names)].join('、').slice(0,200);
 const scenes=project.scenes.map(scene=>{
  let sceneChanged=false;
  const entries=scene.entries.map(line=>{
   if(line.stage?.actors)actors=line.stage.actors;
   if(line.kind!=='dialogue'||!line.speaker)return line;
   const definitions=speakerIds(line).map(id=>byAsset.get(actors.find(actor=>actor.instanceId===id)?.assetId));
   if(!definitions.some(d=>d?.legacySpeakerName)||definitions.some(d=>!d))return line;
   const oldCaption=caption(definitions.map(d=>d.legacySpeakerName??d.name));
   if(line.speaker!==oldCaption)return line;
   changed=sceneChanged=true;
   return {...line,speaker:caption(definitions.map(d=>d.name))};
  });
  return sceneChanged?{...scene,entries}:scene;
 });
 return changed?{...project,scenes}:project;
}

// Catalog providers supply display names together with the other character metadata.
export function characterDisplayRecord(character) {
  return character;
}
