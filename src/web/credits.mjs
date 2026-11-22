// Shared credit presentation for the editor footer, author dialog and rights notice.
const node=(tag,text,cls)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e;};
export const collaboratorRole='协作开发';
export function teamCredits(author,coAuthors=[]){return [...(author?[{...author,role:'软件作者'}]:[]),...coAuthors.map(p=>({...p,role:collaboratorRole}))];}
export function renderCreditSummary(container,people){
 container.replaceChildren(...people.map(person=>{
  const group=node('div',undefined,'credit-person'),heading=node('div',undefined,'credit-person-heading');
  heading.append(node('span',person.role,'credit-role'),node('strong',person.name,'credit-person-name'));
  const handles=node('div',undefined,'credit-handles');
  for(const [label,value] of [['抖音',person.douyin],['B站 UID',person.bilibiliUid]]){const item=node('span');item.append(node('span',label,'credit-handle-label'),node('span',value,'credit-number'));handles.append(item);}
  group.append(heading,handles);return group;
 }));
}
export function creditCards(people,{copy=false}={}){
 const grid=node('div',undefined,'credit-cards');
 for(const person of people){
  const card=node('article',undefined,'credit-card'),head=node('div',undefined,'credit-card-heading');
  head.append(node('span',person.role,'credit-role'),node('h3',person.name));card.append(head);
  const fields=node('dl',undefined,'credit-fields'),status=node('p','', 'credit-copy-status');status.setAttribute('aria-live','polite');
  for(const [label,value] of [['抖音号',person.douyin],['B站 UID',person.bilibiliUid]]){
   const row=node('div',undefined,'credit-field'),description=node('dd'),number=node('span',value,'credit-number');
   description.append(number);
   if(copy){const action=node('button','复制','credit-copy');action.type='button';action.setAttribute('aria-label',`复制${person.name}的${label}`);action.onclick=async()=>{try{await navigator.clipboard.writeText(value);status.textContent=`已复制${label}`;}catch{status.textContent='未能复制，请选中号码手动复制。';}};description.append(action);}
   row.append(node('dt',label),description);fields.append(row);
  }
  card.append(fields);if(copy)card.append(status);grid.append(card);
 }return grid;
}
export function renderNoticeBody(container,notice,people){
 const contact=node('section',undefined,'rights-notice-contact');contact.setAttribute('aria-label','联系开发者');
 contact.append(node('h3','联系开发者'),people?.length?creditCards(people):node('p','原作者信息缺失'));
 container.replaceChildren(...notice.paragraphs.map(text=>node('p',text)),contact,node('p',notice.closing,'rights-notice-closing'));
}
export function setupCredits({author,coAuthors=[],authorInfoMissing=!author}={}){
 const people=teamCredits(author,coAuthors),dialog=document.getElementById('author-dialog');
 renderCreditSummary(document.querySelector('.author-details'),people);
 document.getElementById('author-cards').replaceChildren(creditCards(people,{copy:true}));
 document.getElementById('author-verification').textContent=!authorInfoMissing?'作者信息为项目署名，不作为版本来源认证':'原作者信息缺失';
 if(authorInfoMissing)document.querySelector('.author-details').replaceChildren(node('span','原作者信息缺失','credit-person-name'));
 document.getElementById('about-author').onclick=()=>{dialog.showModal();dialog.scrollTop=0;};
 for(const id of ['close-author','return-from-author'])document.getElementById(id).onclick=()=>dialog.close();
}
