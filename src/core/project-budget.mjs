export const PROJECT_LIMITS=Object.freeze({scenes:200,entries:2000,lineText:4000,totalText:200000,duration:21600,textSpeed:200});
// Run before grapheme segmentation, image inflation or cloning a loaded project.
export function assertProjectBudget(project){
 if(!project||!Array.isArray(project.scenes)||project.scenes.length>PROJECT_LIMITS.scenes)throw new Error('工程场景不得超过200个');
 let count=0,text=0,hold=0;
 for(const scene of project.scenes){
  if(!scene||!Array.isArray(scene.entries))throw new Error('场景条目列表无效');
  count+=scene.entries.length;if(count>PROJECT_LIMITS.entries)throw new Error('工程条目不得超过2000条');
  for(const line of scene.entries){
   if(!line||typeof line.text!=='string'||line.text.length>PROJECT_LIMITS.lineText)throw new Error('每条正文不得超过4000字');
   text+=line.text.length;if(text>PROJECT_LIMITS.totalText)throw new Error('工程正文合计不得超过20万字');
   hold+=(line.hold??1.5)+(line.transition??.25);if(!Number.isFinite(hold)||hold>PROJECT_LIMITS.duration)throw new Error('工程总时长不得超过6小时');
  }
 }
}
