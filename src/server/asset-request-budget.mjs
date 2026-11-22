import {performance} from 'node:perf_hooks';
const MiB=1024*1024;
// Process-wide buckets cannot be reset by opening a new connection. Browser metadata
// is a compatibility hint, not authentication: all callers share the overall bound.
export class AssetRequestBudget {
 constructor({now=()=>performance.now()}={}){this.now=now;this.global=this.bucket(4096,128,512*MiB,64*MiB);this.direct=this.bucket(64,8,128*MiB,16*MiB);}
 bucket(requests,rate,bytes,byteRate){return {requests,rate,bytes,byteRate,requestLimit:requests,byteLimit:bytes,time:this.now()};}
 consume({browser=false,bytes=0}={}){
  const buckets=browser?[this.global]:[this.global,this.direct],now=this.now();
  for(const b of buckets){const dt=Math.max(0,now-b.time)/1000;b.time=now;b.requests=Math.min(b.requestLimit,b.requests+dt*b.rate);b.bytes=Math.min(b.byteLimit,b.bytes+dt*b.byteRate);}
  if(!Number.isSafeInteger(bytes)||bytes<0||buckets.some(b=>b.requests<1||b.bytes<bytes))throw Object.assign(new Error('素材请求过于频繁，请稍后重试'),{status:429,retryAfter:5});
  for(const b of buckets){b.requests--;b.bytes-=bytes;}
 }
}
