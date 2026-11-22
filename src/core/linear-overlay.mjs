/** Composite translucent UI in linear light; keep scene pixels in their original sRGB encoding. */
const decode=Float32Array.from({length:256},(_,v)=>{const s=v/255;return s<=.04045?s/12.92:((s+.055)/1.055)**2.4;});
const encode=Uint8Array.from({length:65536},(_,v)=>{const l=v/65535;return Math.round(255*(l<=.0031308?12.92*l:1.055*l**(1/2.4)-.055));});
export function addLinearLayer(overlay,rgba){
 if(overlay.length!==rgba.length)throw new Error('Overlay dimensions differ');
 for(let i=0;i<rgba.length;i+=4){const a=rgba[i+3]/255,remain=1-a;if(!a)continue;for(let c=0;c<3;c++)overlay[i+c]=decode[rgba[i+c]]*a+overlay[i+c]*remain;overlay[i+3]=a+overlay[i+3]*remain;}
 return overlay;
}
export function compositeLinearOverlay(rgba,overlay){
 if(overlay.length!==rgba.length)throw new Error('Overlay dimensions differ');
 for(let i=0;i<rgba.length;i+=4){const a=overlay[i+3];if(!a)continue;for(let c=0;c<3;c++){const linear=overlay[i+c]+decode[rgba[i+c]]*(1-a);rgba[i+c]=encode[Math.max(0,Math.min(65535,Math.round(linear*65535)))];}}
 return rgba;
}
