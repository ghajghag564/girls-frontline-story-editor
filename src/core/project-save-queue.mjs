/** Saves retain their own document/session even while another document is opened. */
import {cloneProject} from './custom-images.mjs';
export class ProjectSaveQueue {
 constructor(api){this.api=api;this.pending=Promise.resolve();this.activate();}
 activate(id=null,revision=0){this.session={id,revision};return this.session;}
 save(project,{manual=false}={}){
  const session=this.session,snapshot=cloneProject(project);
  const operation=this.pending.catch(()=>{}).then(async()=>{
   const record=session.id
    ?await this.api('/projects/'+session.id,{method:manual?'PUT':'PATCH',body:{project:snapshot,expectedRevision:session.revision}})
    :await this.api('/projects',{method:'POST',body:snapshot});
   if(!session.id){session.id=record.id;session.revision=record.revision;}
   else if(manual)session.revision=record.revision;
   return {record,session,current:session===this.session};
  });this.pending=operation;return operation;
 }
}
