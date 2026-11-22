import {createNativeCore} from './native-cubism.mjs';
import {AssetIntegrity} from './asset-integrity.mjs';
import {loadCatalog} from './catalog.mjs';
const assets=new AssetIntegrity(process.argv[2]),models=new Map();
const dependency=JSON.parse(process.argv[3]);
let core,catalog,queue=Promise.resolve();
async function initialize(){
 await assets.initialize();
 const index=await loadCatalog(assets);
 core=await createNativeCore(dependency);
 catalog=index;
}
async function load(id){
 if(models.has(id)){const m=models.get(id);models.delete(id);models.set(id,m);return m;}
 const definition=catalog.characters.find(x=>x.id===id);if(!definition)throw new Error('人物素材不存在');
 const {bytes,release}=await assets.read('assets/'+definition.modelPath,definition.sha256);
 let model;
 try{model=core.create(bytes,definition.sha256);}finally{release();}
 models.set(id,model);
 while(models.size>10){const key=models.keys().next().value;models.get(key).dispose();models.delete(key);}
 return model;
}
process.on('message',request=>{queue=queue.then(async()=>{
 try{
  if(!catalog)await initialize();
  if(request.command==='describe'){
   const model=await load(request.assetId);process.send?.({id:request.id,result:{canvas:model.canvas,parameters:model.parameters,topology:model.topology}});
  }else if(request.command==='evaluate'){
   if(!Array.isArray(request.instances)||request.instances.length>10)throw new Error('人物实例数量无效');
   const result=[];for(const instance of request.instances){const model=await load(instance.assetId);result.push({instanceId:instance.instanceId,...model.evaluate(instance.parameters??{})});}
   process.send?.({id:request.id,result});
  }else throw new Error('模型计算请求无效');
 }catch(error){process.send?.({id:request.id,error:error.message});}
}).catch(error=>{process.send?.({id:request.id,error:error.message});});});
process.on('disconnect',()=>{for(const model of models.values())model.dispose();process.exit(0);});
