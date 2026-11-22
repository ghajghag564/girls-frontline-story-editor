/** Source-mesh renderer. Textures/UVs/masks remain independent; no baked portrait animation. */
export class ModelMeshRenderer {
 constructor(canvas){
  this.canvas=canvas;this.gl=canvas.getContext('webgl',{alpha:true,premultipliedAlpha:true,preserveDrawingBuffer:true,antialias:false});if(!this.gl)throw new Error('浏览器无法初始化人物绘制，请启用硬件加速');
  const gl=this.gl;
  const shader=(type,source)=>{const s=gl.createShader(type);gl.shaderSource(s,source);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw new Error('人物绘制着色器编译失败：'+gl.getShaderInfoLog(s));return s;};
  const vertex=shader(gl.VERTEX_SHADER,`attribute vec2 position;attribute vec2 uv;uniform vec2 scale;uniform vec2 origin;varying vec2 textureUV;varying vec2 screenUV;void main(){vec2 point=position*scale+origin;gl_Position=vec4(point,0.,1.);textureUV=uv;screenUV=point*.5+.5;}`);
  const fragment=shader(gl.FRAGMENT_SHADER,`precision highp float;uniform sampler2D image;uniform sampler2D mask;uniform float useMask;uniform float inverted;uniform float opacity;uniform float brightness;varying vec2 textureUV;varying vec2 screenUV;void main(){vec4 color=texture2D(image,textureUV);float clip=mix(1.,mix(texture2D(mask,screenUV).a,1.-texture2D(mask,screenUV).a,inverted),useMask);gl_FragColor=color*opacity*clip*vec4(brightness,brightness,brightness,1.);}`);
  this.program=gl.createProgram();gl.attachShader(this.program,vertex);gl.attachShader(this.program,fragment);gl.linkProgram(this.program);gl.deleteShader(vertex);gl.deleteShader(fragment);if(!gl.getProgramParameter(this.program,gl.LINK_STATUS))throw new Error('人物绘制程序链接失败');
  this.attributes={position:gl.getAttribLocation(this.program,'position'),uv:gl.getAttribLocation(this.program,'uv')};this.uniforms={};for(const n of ['scale','origin','image','mask','useMask','inverted','opacity','brightness'])this.uniforms[n]=gl.getUniformLocation(this.program,n);
  this.models=new Map();this.maskTexture=gl.createTexture();this.maskFramebuffer=gl.createFramebuffer();this.maskSize='';
 }
 async prepare(id,description,textureSources){
  if(this.models.has(id))return;const gl=this.gl,textures=new Map(),meshes=[];
  try{
   for(const [index,source] of textureSources){const texture=gl.createTexture();textures.set(index,texture);gl.bindTexture(gl.TEXTURE_2D,texture);gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,true);gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,true);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,source);// Generate the minification pyramid from the original pixels after premultiplication.
    // WebGL 1 requires power-of-two dimensions for mipmapped textures.
    const powerOfTwo=n=>Number.isInteger(n)&&n>0&&(n&(n-1))===0;
    const mipmapped=powerOfTwo(source.width)&&powerOfTwo(source.height);
    if(mipmapped)gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,mipmapped?gl.LINEAR_MIPMAP_LINEAR:gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);}
   for(const mesh of description.topology){
    if(!textures.has(mesh.texture))throw new Error('人物贴图缺失');
    const position=gl.createBuffer(),uv=gl.createBuffer(),indices=gl.createBuffer();meshes.push({...mesh,position,uv,indexBuffer:indices});
    gl.bindBuffer(gl.ARRAY_BUFFER,uv);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(mesh.uvs),gl.STATIC_DRAW);gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,indices);gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,new Uint16Array(mesh.indices),gl.STATIC_DRAW);
   }
   this.models.set(id,{description,textures,meshes});while(this.models.size>20)this.release(this.models.keys().next().value);
  }catch(error){for(const texture of textures.values())gl.deleteTexture(texture);for(const m of meshes){gl.deleteBuffer(m.position);gl.deleteBuffer(m.uv);gl.deleteBuffer(m.indexBuffer);}throw error;}
 }
 render(id,snapshot,{brightness=1,transform}={}){
  const model=this.models.get(id);if(!model)throw new Error('人物模型尚未准备');const gl=this.gl,w=this.canvas.width,h=this.canvas.height;
  if(gl.isContextLost())throw new Error('人物绘制设备已重置，请刷新页面');
  if(this.maskSize!==w+'x'+h){gl.bindTexture(gl.TEXTURE_2D,this.maskTexture);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,w,h,0,gl.RGBA,gl.UNSIGNED_BYTE,null);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);gl.bindFramebuffer(gl.FRAMEBUFFER,this.maskFramebuffer);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,this.maskTexture,0);if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)throw new Error('人物遮罩缓冲区无法创建');this.maskSize=w+'x'+h;}
  gl.viewport(0,0,w,h);gl.useProgram(this.program);gl.disable(gl.DEPTH_TEST);gl.enable(gl.BLEND);gl.frontFace(transform?.flipped?gl.CW:gl.CCW);gl.clearColor(0,0,0,0);
  const c=model.description.canvas;gl.uniform2f(this.uniforms.scale,...(transform?.scale??[c.pixelsPerUnit*2/c.size[0],c.pixelsPerUnit*2/c.size[1]]));gl.uniform2f(this.uniforms.origin,...(transform?.origin??[c.origin[0]*2/c.size[0]-1,c.origin[1]*2/c.size[1]-1]));gl.uniform1i(this.uniforms.image,0);gl.uniform1i(this.uniforms.mask,1);
  if(snapshot.drawables.length!==model.meshes.length)throw new Error('人物绘制片段不匹配');
  for(const d of snapshot.drawables){const mesh=model.meshes[d.index];if(!mesh||d.positions.length!==mesh.uvs.length)throw new Error('人物顶点数量不匹配');gl.bindBuffer(gl.ARRAY_BUFFER,mesh.position);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(d.positions),gl.DYNAMIC_DRAW);}
  const draw=(mesh,opacity,clip,inverted,tint)=>{
   gl.bindBuffer(gl.ARRAY_BUFFER,mesh.position);gl.enableVertexAttribArray(this.attributes.position);gl.vertexAttribPointer(this.attributes.position,2,gl.FLOAT,false,0,0);gl.bindBuffer(gl.ARRAY_BUFFER,mesh.uv);gl.enableVertexAttribArray(this.attributes.uv);gl.vertexAttribPointer(this.attributes.uv,2,gl.FLOAT,false,0,0);gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,mesh.indexBuffer);
   if(mesh.flags&4)gl.disable(gl.CULL_FACE);else{gl.enable(gl.CULL_FACE);gl.cullFace(gl.BACK);}
   gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,model.textures.get(mesh.texture));gl.uniform1f(this.uniforms.opacity,opacity);gl.uniform1f(this.uniforms.useMask,clip?1:0);gl.uniform1f(this.uniforms.inverted,inverted?1:0);gl.uniform1f(this.uniforms.brightness,tint);gl.drawElements(gl.TRIANGLES,mesh.indices.length,gl.UNSIGNED_SHORT,0);
  };
  gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.clear(gl.COLOR_BUFFER_BIT);let lastMask='';
  for(const d of [...snapshot.drawables].sort((a,b)=>a.order-b.order)){
   if(!d.visible||d.opacity<=0)continue;const mesh=model.meshes[d.index];
   if(mesh.masks.length){
    const key=mesh.masks.join(',');if(key!==lastMask){
     // Never sample a texture while it is attached to the active framebuffer.
     gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_2D,null);gl.bindFramebuffer(gl.FRAMEBUFFER,this.maskFramebuffer);gl.clear(gl.COLOR_BUFFER_BIT);gl.blendFuncSeparate(gl.ONE,gl.ONE_MINUS_SRC_ALPHA,gl.ONE,gl.ONE_MINUS_SRC_ALPHA);
     for(const mask of mesh.masks)draw(model.meshes[mask],1,false,false,1);lastMask=key;gl.bindFramebuffer(gl.FRAMEBUFFER,null);
    }
   }
   gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_2D,this.maskTexture);
   let tint=brightness;
   if(mesh.flags&1){
    gl.blendFuncSeparate(gl.ONE,gl.ONE,gl.ZERO,gl.ONE);
   }else if(mesh.flags&2){
    gl.blendFuncSeparate(gl.DST_COLOR,gl.ONE_MINUS_SRC_ALPHA,gl.ZERO,gl.ONE);
    // Multiply layers modulate a destination that already has the actor brightness.
    tint=1;
   }else{
    gl.blendFuncSeparate(gl.ONE,gl.ONE_MINUS_SRC_ALPHA,gl.ONE,gl.ONE_MINUS_SRC_ALPHA);
   }
   draw(mesh,d.opacity,mesh.masks.length,!!(mesh.flags&8),tint);
  }
  const error=gl.getError();if(error!==gl.NO_ERROR)throw new Error('人物绘制失败：'+error);
  return this.canvas;
 }
 release(id){const model=this.models.get(id);if(!model)return;const gl=this.gl;for(const t of model.textures.values())gl.deleteTexture(t);for(const m of model.meshes){gl.deleteBuffer(m.position);gl.deleteBuffer(m.uv);gl.deleteBuffer(m.indexBuffer);}this.models.delete(id);}
 dispose(){const gl=this.gl;for(const model of this.models.values()){for(const texture of model.textures.values())gl.deleteTexture(texture);for(const mesh of model.meshes){gl.deleteBuffer(mesh.position);gl.deleteBuffer(mesh.uv);gl.deleteBuffer(mesh.indexBuffer);}}this.models.clear();gl.deleteFramebuffer(this.maskFramebuffer);gl.deleteTexture(this.maskTexture);gl.deleteProgram(this.program);}
}
