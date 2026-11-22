import {token} from '/bootstrap.mjs';
import {ModelMeshRenderer} from '/core/model-renderer.mjs';
import {actorParameters,actorTransform} from '/core/actor-state.mjs';
async function api(route,body){const response=await fetch('/api'+route,{method:body?'POST':'GET',headers:{'x-gf2-token':token,'content-type':'application/json'},body:body?JSON.stringify(body):undefined});const data=await response.json();if(!response.ok)throw new Error(data.error??'人物计算失败');return data;}
export class ActorRenderer {
 constructor(catalog){this.definitions=new Map(catalog.characters.map(x=>[x.id,x]));this.canvas=document.createElement('canvas');this.snapshots=new Map();this.staticImages=new Map();this.draw=this.draw.bind(this);this.draw.prepareFrame=this.prepareFrame.bind(this);this.draw.dispose=()=>this.dispose();}
 async prepareFrame(state,canvas){
  this.snapshots.clear();if(!state?.actors.length)return;
  if(state.actors.some(a=>this.definitions.get(a.assetId)?.source!=='custom'))this.mesh??=new ModelMeshRenderer(this.canvas);
  if(this.canvas.width!==canvas.width)this.canvas.width=canvas.width;if(this.canvas.height!==canvas.height)this.canvas.height=canvas.height;
  const activeAssets=new Set(state.actors.map(a=>a.assetId));for(const id of this.mesh?.models.keys()??[])if(!activeAssets.has(id))this.mesh.release(id);
  for(const id of this.staticImages.keys())if(!activeAssets.has(id))this.staticImages.delete(id);
  const instances=[];
  for(const actor of state.actors){const definition=this.definitions.get(actor.assetId);if(!definition)throw new Error('缺少人物素材：'+actor.assetId);
   if(definition.source==='custom'){if(!this.staticImages.has(actor.assetId)){const image=new Image();image.src=definition.imageUrl;await image.decode();this.staticImages.set(actor.assetId,image);}continue;}
   if(!this.mesh.models.has(actor.assetId)){
    const description=await api('/models/'+encodeURIComponent(actor.assetId)),textures=[];
    for(const texture of definition.textures){const image=new Image();image.src='/assets/character/'+encodeURIComponent(actor.assetId)+'/texture-'+texture.index;await image.decode();textures.push([texture.index,image]);}
    await this.mesh.prepare(actor.assetId,description,textures);
   }
   instances.push({instanceId:actor.instanceId,assetId:actor.assetId,parameters:actorParameters(actor,definition,state)});
  }
  for(let offset=0;offset<instances.length;offset+=10)for(const snapshot of await api('/models/evaluate',{instances:instances.slice(offset,offset+10)}))this.snapshots.set(snapshot.instanceId,snapshot);
 }
 draw(ctx,actor,{w,h,brightness}){
  const definition=this.definitions.get(actor.assetId);
  if(definition?.source==='custom'){const image=this.staticImages.get(actor.assetId);if(!image)throw new Error('自定义立绘尚未加载');const [l,t,r,b]=definition.framing.bounds,dh=h*(actor.scale??1)/(b-t),dw=dh*image.width/image.height;ctx.save();try{ctx.globalAlpha=actor.opacity??1;ctx.filter=`brightness(${brightness??1})`;ctx.translate((actor.x??.5)*w,(actor.y??1)*h);ctx.scale(actor.flip?-1:1,1);ctx.drawImage(image,-(l+r)/2*dw,-b*dh,dw,dh);}finally{ctx.restore();}return;}
  const snapshot=this.snapshots.get(actor.instanceId);if(!snapshot)throw new Error('人物帧缺失');
  const model=this.mesh.models.get(actor.assetId);
  const transform=actorTransform(actor,definition,model.description.canvas,w,h);
  this.mesh.render(actor.assetId,snapshot,{brightness,transform});
  // Explicit CPU transfer avoids changing Canvas2D's background resampling backend
  // after its first GPU-canvas draw. Preview and export must use identical pixels.
  const width=this.canvas.width,height=this.canvas.height,size=width*height*4;
  if(this.image?.width!==width||this.image?.height!==height){this.pixels=new Uint8Array(size);this.image=new ImageData(width,height);this.surface=document.createElement('canvas');this.surface.width=width;this.surface.height=height;this.surfaceContext=this.surface.getContext('2d',{willReadFrequently:true});}
  // A model only covers its own screen rectangle, so only that rectangle is read back
  // and un-premultiplied. Pixels outside it are cleared instead of computed, which gives
  // exactly the same image as converting the whole canvas.
  const box=this.screenBox(snapshot,transform,width,height)??{x:0,y:0,width,height};
  const bx=box.x,by=box.y,bw=box.width,bh=box.height,source=this.pixels,target=this.image.data;
  if(bx||by||bw!==width||bh!==height)target.fill(0);
  const gl=this.mesh.gl;gl.readPixels(bx,height-by-bh,bw,bh,gl.RGBA,gl.UNSIGNED_BYTE,source);
  for(let row=0;row<bh;row++){
   const sourceRow=row*bw*4,targetRow=((by+bh-1-row)*width+bx)*4;
   for(let column=0;column<bw;column++){
    const sourcePixel=sourceRow+column*4,targetPixel=targetRow+column*4,alpha=source[sourcePixel+3];
    target[targetPixel+3]=alpha;
    if(!alpha){target[targetPixel]=0;target[targetPixel+1]=0;target[targetPixel+2]=0;continue;}
    if(alpha===255){target[targetPixel]=source[sourcePixel];target[targetPixel+1]=source[sourcePixel+1];target[targetPixel+2]=source[sourcePixel+2];continue;}
    target[targetPixel]=Math.round(source[sourcePixel]*255/alpha);
    target[targetPixel+1]=Math.round(source[sourcePixel+1]*255/alpha);
    target[targetPixel+2]=Math.round(source[sourcePixel+2]*255/alpha);
   }
  }
  this.surfaceContext.putImageData(this.image,0,0);
  ctx.save();try{ctx.globalAlpha=actor.opacity??1;ctx.drawImage(this.surface,0,0,w,h);}finally{ctx.restore();}
 }
 /** Screen-space rectangle covered by the drawn geometry, or null when it cannot be bounded. */
 screenBox(snapshot,transform,width,height){
  const scale=transform?.scale,origin=transform?.origin;
  if(!scale||!origin)return null;
  let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
  for(const drawable of snapshot.drawables){
   const points=drawable.positions;
   if(!drawable.visible||!points?.length)continue;
   for(let index=0;index<points.length;index+=2){
    const x=points[index]*scale[0]+origin[0],y=points[index+1]*scale[1]+origin[1];
    if(!Number.isFinite(x)||!Number.isFinite(y))return null;
    if(x<minX)minX=x;if(x>maxX)maxX=x;if(y<minY)minY=y;if(y>maxY)maxY=y;
   }
  }
  if(!(maxX>=minX)||!(maxY>=minY))return null;
  // Rasterised coverage stays inside the geometry; two pixels absorb edge clamping.
  const padding=2;
  const x0=Math.max(0,Math.floor((minX+1)/2*width)-padding),x1=Math.min(width,Math.ceil((maxX+1)/2*width)+padding);
  const y0=Math.max(0,Math.floor((1-maxY)/2*height)-padding),y1=Math.min(height,Math.ceil((1-minY)/2*height)+padding);
  if(x1<=x0||y1<=y0)return null;
  return {x:x0,y:y0,width:x1-x0,height:y1-y0};
 }
 dispose(){this.mesh?.dispose();this.mesh=null;this.pixels=null;this.image=null;this.surface=null;this.surfaceContext=null;this.snapshots.clear();this.staticImages.clear();}
}
