import {IMAGE_LIMITS} from '../core/custom-images.mjs';
import {verifyProjectImages} from './custom-images.mjs';
import {checkRequestSource,validSessionToken,readJson,HTTP_LIMITS} from './request-security.mjs';
import http from 'node:http';
import fs from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {pipeline} from 'node:stream/promises';
import {SafeDirectory} from './safe-files.mjs';
import {ExportService} from './export-service.mjs';
import {ModelService} from './model-service.mjs';
import {ProjectStore} from './project-store.mjs';
import {loadCatalog,publicCatalog} from './catalog.mjs';
import {validateProject,missingResources} from '../core/project.mjs';
import {release,releaseNotesPath} from '../core/release.mjs';
import {readAuthorInfo} from './author-info.mjs';
import {AssetIntegrity} from './asset-integrity.mjs';
import {AssetRequestBudget} from './asset-request-budget.mjs';
import {Readable} from 'node:stream';
import {hasAcceptedNotice,acceptNotice} from './notice-store.mjs';
const json=(response,status,data)=>{response.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});response.end(JSON.stringify(data));};
async function loadLocalExample(filename,catalog){
 if(!filename)return null;
 const directory=new SafeDirectory(path.dirname(filename));
 const name=path.basename(filename);
 const info=await fs.stat(await directory.resolve(name));
 if(!info.isFile()||info.size>IMAGE_LIMITS.projectBytes)throw new Error('本地示例工程文件无效');
 const project=verifyProjectImages(validateProject(JSON.parse((await directory.read(name)).toString('utf8').replace(/^\uFEFF/,''))));
 if(missingResources(project,catalog).length)throw new Error('本地示例工程缺少素材，请检查目录或移除 exampleProject 设置');
 return project;
}

export async function startServer(config,{rootId,port=0,onShutdown}={}){
 const {sourceRoot,materialsDirectory,workspaceDirectory}=config;
 const {author,coAuthors,authorInfoMissing}=await readAuthorInfo(sourceRoot);
 const codeFiles=new SafeDirectory(sourceRoot);
 const files=new SafeDirectory(workspaceDirectory);await files.initialize();
 const assetIntegrity=new AssetIntegrity(materialsDirectory);await assetIntegrity.initialize();const assetBudget=new AssetRequestBudget();
 const catalog=await loadCatalog(assetIntegrity);
 const example=await loadLocalExample(config.example,catalog);
 let noticeAccepted=await hasAcceptedNotice(files);
 const store=new ProjectStore(await files.resolve('userdata/projects'));await store.initialize();
 const token=randomBytes(32).toString('hex');let origin,catalogBody;
 const models=new ModelService(config);
 const exports=new ExportService(config,catalog);await exports.initialize();
 const server=http.createServer(HTTP_LIMITS,async(request,response)=>{
  response.setHeader('Cross-Origin-Resource-Policy','same-origin');response.setHeader('X-Frame-Options','DENY');response.setHeader('X-Content-Type-Options','nosniff');response.setHeader('Referrer-Policy','no-referrer');response.setHeader('Cache-Control','no-store');
  response.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob: data:; media-src 'self' blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
  let verifiedAsset;
  try{
   checkRequestSource(request,origin);
   const url=new URL(request.url,origin),route=url.pathname;
   if(route==='/health'&&request.method==='GET')return json(response,200,{application:'gf2-story-editor',version:release.version,rootId});
   if(route.startsWith('/api/')){
    if(!validSessionToken(request.headers['x-gf2-token'],token))return json(response,403,{error:'会话已失效，请刷新页面'});
    if(!['GET','HEAD'].includes(request.method)&&request.headers.origin!==origin)return json(response,403,{error:'缺少本机来源验证'});
    if(route==='/api/shutdown'&&request.method==='POST'){
     if(!onShutdown)return json(response,409,{error:'此启动方式不支持从页面退出'});
     if([...exports.jobs.values()].some(j=>['preparing','rendering','encoding'].includes(j.state)))return json(response,409,{error:'请先完成或取消视频导出，再退出'});
     response.once('finish',()=>setImmediate(()=>onShutdown()));return json(response,200,{stopped:true});
    }
    if(route==='/api/notice/accept'&&request.method==='POST'){
     const result=await acceptNotice(files,await readJson(request));noticeAccepted=true;return json(response,200,result);
    }
    if(!noticeAccepted)return json(response,403,{error:'请先阅读并同意本地素材权利声明。'});
    if(route==='/api/tutorial'&&request.method==='GET'){let state={seen:false,completed:false,step:0};try{state=JSON.parse(await files.read('userdata/tutorial.json'));}catch(e){if(e.code!=='ENOENT')throw e;}return json(response,200,state);}
    if(route==='/api/tutorial'&&request.method==='POST'){const b=await readJson(request);if(typeof b.seen!=='boolean'||typeof b.completed!=='boolean'||!Number.isInteger(b.step)||b.step<0||b.step>8)throw new Error('教程进度无效');const state={seen:b.seen,completed:b.completed,step:b.step};await files.atomicWrite('userdata/tutorial.json',JSON.stringify(state));return json(response,200,state);}
    if(route==='/api/capabilities'&&request.method==='GET')return json(response,200,{codecs:exports.codecs});
    if(route==='/api/example'&&request.method==='GET')return json(response,200,example);
    if(route==='/api/exports'&&request.method==='POST'){const body=await readJson(request,IMAGE_LIMITS.projectBytes);return json(response,202,await exports.create(body.project,body.settings));}
    const exportRoute=route.match(/^\/api\/exports\/([a-f0-9-]+)(?:\/(cancel|frame)(?:\/(\d+))?)?$/);
    if(exportRoute){
     const [,id,action,index]=exportRoute;
     if(request.method==='GET'&&!action)return json(response,200,exports.status(exports.get(id)));
     if(request.method==='POST'&&action==='cancel')return json(response,200,await exports.cancel(id));
     if(request.method==='POST'&&action==='frame'&&index!==undefined)return json(response,200,await exports.frame(id,Number(index),request));
    }
    if(route==='/api/models/evaluate'&&request.method==='POST'){
     const body=await readJson(request);if(!Array.isArray(body.instances)||body.instances.length>10)throw new Error('人物实例数量无效');
     for(const instance of body.instances){
      if(!instance||!catalog.characters.some(x=>x.id===instance.assetId)||typeof instance.instanceId!=='string'||!/^[a-zA-Z0-9_-]{1,100}$/.test(instance.instanceId))throw new Error('人物实例无效');
      if(instance.parameters!==undefined&&(!instance.parameters||typeof instance.parameters!=='object'||Array.isArray(instance.parameters)||Object.keys(instance.parameters).length>1000))throw new Error('人物参数无效');
     }
     return json(response,200,await models.evaluate(body.instances));
    }
    const modelRoute=route.match(/^\/api\/models\/([a-zA-Z0-9_-]+)$/);
    if(modelRoute&&request.method==='GET'){
     if(!catalog.characters.some(x=>x.id===modelRoute[1]))return json(response,404,{error:'人物素材不存在'});
     return json(response,200,await models.describe(modelRoute[1]));
    }
    // The catalog is immutable for the process lifetime: serialize it once, not per request.
    if(route==='/api/catalog'&&request.method==='GET'){catalogBody??=JSON.stringify(publicCatalog(catalog));response.writeHead(200,{'Content-Type':'application/json; charset=utf-8'});return response.end(catalogBody);}
    if(route==='/api/projects'&&request.method==='GET')return json(response,200,await store.list());
    if(route==='/api/projects'&&request.method==='POST')return json(response,201,await store.create(await readJson(request,IMAGE_LIMITS.projectBytes)));
    if(route==='/api/projects/check'&&request.method==='POST'){const project=verifyProjectImages(validateProject(await readJson(request,IMAGE_LIMITS.projectBytes)));return json(response,200,{project,missing:missingResources(project,catalog),catalogChanged:project.catalogVersion!==catalog.version});}
    const match=route.match(/^\/api\/projects\/([\w-]+)(\/download)?$/);
    if(match){
     const id=match[1];
     if(request.method==='DELETE'&&!match[2]){
      const body=await readJson(request,1024);
      return json(response,200,await store.delete(id,body));
     }
     if(request.method==='GET'){
      if(match[2]){const saved=await store.open(id);response.setHeader('Content-Disposition',`attachment; filename="${id}.gf2story.json"`);return json(response,200,saved.project);}
      const saved=await store.openWithRecovery(id);
      return json(response,200,{...saved,missing:missingResources(saved.project,catalog),catalogChanged:saved.project.catalogVersion!==catalog.version});
     }
     if(['PUT','PATCH'].includes(request.method)&&!match[2]){const body=await readJson(request,IMAGE_LIMITS.projectBytes);return json(response,200,await store.save(id,body.project,{expectedRevision:body.expectedRevision,recovery:request.method==='PATCH'}));}
    }
    return json(response,404,{error:'接口不存在'});
   }
   if(!['GET','HEAD'].includes(request.method))return json(response,405,{error:'不支持的请求方法'});
   if(route==='/bootstrap.mjs'){
    response.writeHead(200,{'Content-Type':'text/javascript; charset=utf-8'});return response.end(`export const token=${JSON.stringify(token)}; export const release=${JSON.stringify({...release,notesPath:releaseNotesPath})}; export const author=${JSON.stringify(author)}; export const coAuthors=${JSON.stringify(coAuthors)}; export const authorInfoMissing=${JSON.stringify(authorInfoMissing)}; export const noticeAccepted=${JSON.stringify(noticeAccepted)};`);
   }
   const exported=route.match(/^\/exports\/([a-f0-9-]+)\.mp4$/);
   if(exported){const job=exports.get(exported[1]);if(job.state!=='completed')return json(response,404,{error:'视频尚未完成'});const file=await files.resolve(job.output);response.writeHead(200,{'Content-Type':'video/mp4','Content-Length':(await fs.stat(file)).size,'Content-Disposition':`attachment; filename="${job.id}.mp4"`});if(request.method==='HEAD')return response.end();await pipeline(createReadStream(file),response);return;}
   const asset=route.match(/^\/assets\/(background|music)\/([a-zA-Z0-9_-]+)\/(full|thumb)$/);
   let relative,type,expectedHash;
   const characterAsset=route.match(/^\/assets\/character\/([a-zA-Z0-9_-]+)\/(thumb|texture-([0-9]+))$/);
   if(characterAsset){
    const item=catalog.characters.find(x=>x.id===characterAsset[1]);
    const texture=characterAsset[2]==='thumb'
     ?item?.thumbnail?{path:item.thumbnail}:item?.textures[0]
     :item?.textures?.find(t=>t.index===Number(characterAsset[3]));
    if(!texture?.path)return json(response,404,{error:'人物图片不存在'});
    relative='assets/'+texture.path;expectedHash=texture.sha256;type='image/png';
   }else if(asset){
    const list=asset[1]==='background'?catalog.backgrounds:catalog.music;const item=list.find(x=>x.id===asset[2]);
    if(!item)return json(response,404,{error:'素材不存在'});
    const thumbnail=asset[1]==='background'&&asset[3]==='thumb'&&item.thumbnail;
    relative='assets/'+(thumbnail||item.path);expectedHash=thumbnail?undefined:item.sha256;type=asset[1]==='background'?'image/png':'audio/flac';
   }else{
    const allowed=new Map([['/','src/web/index.html'],['/app.mjs','src/web/app.mjs'],['/music.mjs','src/web/music.mjs'],['/export.mjs','src/web/export.mjs'],['/style.css','src/web/style.css'],['/core/timeline.mjs','src/core/timeline.mjs'],['/core/project.mjs','src/core/project.mjs'],['/core/audio-mixer.mjs','src/core/audio-mixer.mjs'],['/core/stage.mjs','src/core/stage.mjs']]);
    for(const file of ['project-budget','custom-images','speakers','rights-notice','project-save-queue','model-renderer','actor-state','eye-blink','story-order','story-interface'])allowed.set('/core/'+file+'.mjs','src/core/'+file+'.mjs');
    for(const file of ['image-import','tutorial','actors','credits'])allowed.set('/'+file+'.mjs','src/web/'+file+'.mjs');
    relative=allowed.get(route);if(!relative)return json(response,404,{error:'文件不存在'});
    type=relative.endsWith('.png')?'image/png':relative.endsWith('.ttf')?'font/ttf':relative.endsWith('.html')?'text/html; charset=utf-8':relative.endsWith('.css')?'text/css; charset=utf-8':'text/javascript; charset=utf-8';
   }
   let filename;
   if(relative.startsWith('assets/')){
    const browser=request.headers['sec-fetch-site']==='same-origin'||validSessionToken(request.headers['x-gf2-token'],token);
    // Charge the full file, including HEAD/Range: cache misses verify full bytes.
    assetBudget.consume({browser,bytes:assetIntegrity.hashes.get(relative)?.bytes??64*1024*1024});
    verifiedAsset=await assetIntegrity.read(relative,expectedHash);
   }else filename=await codeFiles.resolve(relative);
   const stat=verifiedAsset?{size:verifiedAsset.bytes.length,isFile:()=>true}:await fs.stat(filename);if(!stat.isFile())return json(response,404,{error:'文件不存在'});
   let start=0,end=stat.size-1,status=200;
   if(request.headers.range){
    const m=/^bytes=(\d*)-(\d*)$/.exec(request.headers.range);
    if(!m||(!m[1]&&!m[2])){response.setHeader('Content-Range',`bytes */${stat.size}`);return json(response,416,{error:'音频区间无效'});}
    if(!m[1])start=Math.max(0,stat.size-Number(m[2]));else{start=Number(m[1]);if(m[2])end=Math.min(end,Number(m[2]));}
    if(start>end||start>=stat.size||!Number.isSafeInteger(start)||!Number.isSafeInteger(end)){response.setHeader('Content-Range',`bytes */${stat.size}`);return json(response,416,{error:'音频区间无效'});}
    status=206;response.setHeader('Content-Range',`bytes ${start}-${end}/${stat.size}`);
   }
   response.writeHead(status,{'Content-Type':type,'Content-Length':end-start+1,'Accept-Ranges':'bytes'});
   if(request.method==='HEAD')return response.end();
   await pipeline(verifiedAsset?Readable.from([verifiedAsset.bytes.subarray(start,end+1)]):createReadStream(filename,{start,end}),response);
  }catch(error){
   if(response.headersSent){response.destroy();return;}
   if(error.retryAfter)response.setHeader('Retry-After',String(error.retryAfter));
   const status=error.status??(error.code==='ENOENT'?404:error.code==='CONFLICT'?409:400);
   const missingMessage=request.url?.startsWith('/api/projects/')?'工程已删除或不存在':'文件不存在';
   json(response,status,{error:error.code==='ENOENT'?missingMessage:error.message});
  }finally{verifiedAsset?.release();}
 });
 server.maxHeadersCount=64;server.maxConnections=128;server.maxRequestsPerSocket=1000;
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
 origin=`http://127.0.0.1:${server.address().port}`;
 return {server,origin,token,store,catalog,exports,models,close:async()=>{await models.close();await exports.close();return new Promise((resolve,reject)=>{server.close(error=>error?reject(error):resolve());server.closeAllConnections();});}};
}
