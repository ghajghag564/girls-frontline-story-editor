import {IMAGE_LIMITS,inspectImageInput,validateCustomImages} from '/core/custom-images.mjs';
export async function prepareImageFile(file,kind){
 const bytes=new Uint8Array(await file.arrayBuffer());inspectImageInput(bytes,file.name);
 const url=URL.createObjectURL(file),image=new Image();
 try{
  image.src=url;await image.decode();let scale=Math.min(1,IMAGE_LIMITS.maxDimension/Math.max(image.naturalWidth,image.naturalHeight));
  const canvas=document.createElement('canvas');let blob;
  do{canvas.width=Math.max(1,Math.round(image.naturalWidth*scale));canvas.height=Math.max(1,Math.round(image.naturalHeight*scale));canvas.getContext('2d').drawImage(image,0,0,canvas.width,canvas.height);blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));if(!blob)throw new Error('无法处理图片');if(blob.size<=IMAGE_LIMITS.imageBytes)break;scale*=.8;}while(scale>.04);
  if(blob.size>IMAGE_LIMITS.imageBytes)throw new Error('图片处理后仍过大，请先缩小图片');
  const rgba=canvas.getContext('2d',{willReadFrequently:true}).getImageData(0,0,canvas.width,canvas.height).data;let left=canvas.width,top=canvas.height,right=0,bottom=0;
  for(let y=0;y<canvas.height;y++)for(let x=0;x<canvas.width;x++)if(rgba[(y*canvas.width+x)*4+3]){left=Math.min(left,x);top=Math.min(top,y);right=Math.max(right,x+1);bottom=Math.max(bottom,y+1);}
  if(!right||!bottom)throw new Error('这张图片完全透明，没有可显示的内容');
  const png=new Uint8Array(await blob.arrayBuffer()),hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',png))).map(n=>n.toString(16).padStart(2,'0')).join('');
  const dataUrl=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(blob);});
  const item={id:`custom_${kind}_${hash}`,kind,name:file.name.replace(/\.(jpg|png)$/i,'').slice(0,100)||'自定义图片',width:canvas.width,height:canvas.height,bounds:[left/canvas.width,top/canvas.height,right/canvas.width,bottom/canvas.height],dataUrl};
  validateCustomImages([item]);return {item,bytes:blob.size,resized:scale<1};
 }finally{URL.revokeObjectURL(url);}
}
export async function loadBackgroundImage(catalog,id){
 const item=catalog.backgrounds.find(b=>b.id===id);if(!item)throw new Error('背景素材不存在');
 if(item.source==='custom'){const image=new Image();image.src=item.imageUrl;await image.decode();return image;}
 const response=await fetch(`/assets/background/${encodeURIComponent(id)}/full`);if(!response.ok)throw new Error('背景图片无法读取');return createImageBitmap(await response.blob());
}
export function setupImageImport({api,getProject,onImport,onPause}){
 const $=id=>document.getElementById(id),dialog=$('image-import-dialog');let kind,prepared=null,generation=0;
 const status=text=>$('image-import-status').textContent=text;
 const reset=()=>{generation++;prepared=null;$('image-file').value='';$('image-name').value='';$('image-preview').removeAttribute('src');$('image-preview').hidden=true;$('confirm-image-import').disabled=true;};
 $('cancel-image-import').onclick=()=>dialog.close();dialog.addEventListener('close',reset);
 $('image-file').onchange=async()=>{const file=$('image-file').files[0],version=++generation;prepared=null;$('confirm-image-import').disabled=true;if(!file)return;status('正在检查并处理图片…');
  try{if(file.size>IMAGE_LIMITS.inputBytes)throw new Error('单张图片不得超过20 MB');const result=await prepareImageFile(file,kind);if(version!==generation||!dialog.open)return;prepared=result.item;$('image-preview').src=prepared.dataUrl;$('image-preview').hidden=false;$('image-name').value=prepared.name;$('confirm-image-import').disabled=false;status(`${prepared.width} × ${prepared.height} · ${(result.bytes/1048576).toFixed(2)} MB${result.resized?' · 已等比缩小':''}。图片将随当前工程保存。`);}catch(error){if(version===generation)status(error.message);}
 };
 $('confirm-image-import').onclick=async()=>{if(!prepared)return;const version=generation,item={...prepared,name:$('image-name').value.trim()||prepared.name};$('confirm-image-import').disabled=true;$('image-file').disabled=true;status('正在校验并加入当前工程…');
  try{const current=getProject(),images=current.customImages??[],candidate={...current,customImages:[...images.filter(i=>i.id!==item.id),item]};validateCustomImages(candidate.customImages);await api('/projects/check',{method:'POST',body:candidate});if(version!==generation||!dialog.open)return;await onImport(item);dialog.close();}catch(error){status(error.message);}finally{$('image-file').disabled=false;if(dialog.open)$('confirm-image-import').disabled=!prepared;}
 };
 return type=>{onPause();kind=type;reset();$('image-import-title').textContent=type==='actor'?'导入人物立绘':'导入背景图片';$('image-import-note').textContent=type==='actor'?'仅支持 JPG / PNG，建议使用透明 PNG。导入立绘是静态图片，可移动、缩放、翻转和发言高亮；没有自动口型或眨眼。JPG 自带的底色会保留。':'仅支持 JPG / PNG。图片保持原比例，可在“当前画幅取景”调整位置与缩放。';status('选择 .jpg 或 .png 文件，单张最多20 MB。超大图片会等比缩小；每个工程图片合计最多32 MB。');dialog.showModal();};
}
