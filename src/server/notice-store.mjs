import {rightsNotice} from '../core/rights-notice.mjs';
const recordPath='userdata/rights-notice-acceptance.json';
// Explicit local acceptance; merely reading or dismissing a notice is not consent.
export async function hasAcceptedNotice(files,revision=rightsNotice.revision){
 try{const record=JSON.parse((await files.read(recordPath)).toString('utf8'));return record?.accepted===true&&record.revision===revision;}
 catch(error){if(error.code==='ENOENT'||error instanceof SyntaxError)return false;throw error;}
}
export async function acceptNotice(files,body){
 if(!body||body.revision!==rightsNotice.revision||body.accepted!==true){const error=new Error('请勾选确认并同意当前声明后进入软件。');error.status=409;throw error;}
 await files.atomicWrite(recordPath,JSON.stringify({revision:rightsNotice.revision,accepted:true,acceptedAt:new Date().toISOString()},null,2)+'\n');
 return {accepted:true,revision:rightsNotice.revision};
}
