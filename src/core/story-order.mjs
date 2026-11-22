/** Move the original entries without rewriting their explicit stage/music changes. */
export function moveScene(project,sourceId,targetId,after=false){
 const items=project.scenes,from=items.findIndex(s=>s.id===sourceId),target=items.findIndex(s=>s.id===targetId);
 if(from<0||target<0||from===target)return false;
 let to=target+(after?1:0);if(from<to)to--;if(from===to)return false;
 items.splice(to,0,items.splice(from,1)[0]);return true;
}
export function moveLine(project,sourceId,targetSceneId,targetLineId=null,after=false){
 const source=project.scenes.find(s=>s.entries.some(l=>l.id===sourceId)),target=project.scenes.find(s=>s.id===targetSceneId);
 if(!source||!target||sourceId===targetLineId)return false;
 const from=source.entries.findIndex(l=>l.id===sourceId);
 let to=targetLineId===null?target.entries.length:target.entries.findIndex(l=>l.id===targetLineId);
 if(to<0)return false;if(targetLineId!==null&&after)to++;
 if(source===target){if(from<to)to--;if(from===to)return false;}
 target.entries.splice(to,0,source.entries.splice(from,1)[0]);return true;
}
export function duplicateScene(project,sourceId,newId){
 const index=project.scenes.findIndex(s=>s.id===sourceId);if(index<0)return null;
 const copy=structuredClone(project.scenes[index]);copy.id=newId();copy.title+=' · 副本';
 for(const entry of copy.entries)entry.id=newId();project.scenes.splice(index+1,0,copy);return copy;
}
