import {timingSafeEqual} from 'node:crypto';
export const JSON_LIMIT=4*1024*1024;
export const HTTP_LIMITS=Object.freeze({maxHeaderSize:16384,headersTimeout:10000,requestTimeout:120000,connectionsCheckingInterval:1000,keepAliveTimeout:5000});
const failure=(message,status=400)=>Object.assign(new Error(message),{status});
export function checkRequestSource(request,origin){
 if(request.headers.host!==new URL(origin).host)throw failure('主机地址不受信任',403);
 if(request.headers.origin&&request.headers.origin!==origin)throw failure('不接受其他网站的请求',403);
 const site=request.headers['sec-fetch-site'];
 if(site!==undefined&&!['none','same-origin'].includes(site))throw failure('不接受其他网站的请求',403);
 if(request.headers['content-encoding']&&request.headers['content-encoding']!=='identity')throw failure('不支持压缩请求',415);
}
export function validSessionToken(candidate,expected){
 return typeof candidate==='string'&&typeof expected==='string'&&/^[a-f0-9]{64}$/.test(candidate)&&/^[a-f0-9]{64}$/.test(expected)&&timingSafeEqual(Buffer.from(candidate,'ascii'),Buffer.from(expected,'ascii'));
}
export async function readJson(request,limit=JSON_LIMIT){
 if(!Number.isSafeInteger(limit)||limit<1||limit>48*1024*1024)throw new Error('请求大小限制无效');
 if(!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers['content-type']??''))throw failure('请求必须使用 JSON 格式',415);
 const length=request.headers['content-length'];
 if(length!==undefined&&(!/^\d+$/.test(length)||Number(length)>limit))throw failure(`工程文件超过${limit/1024/1024} MB`,413);
 let size=0;const chunks=[];
 for await(const chunk of request){size+=chunk.length;if(size>limit)throw failure(`工程文件超过${limit/1024/1024} MB`,413);chunks.push(chunk);}
 let body;try{body=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw failure('请求不是有效的JSON');}
 // JSON "null" parses successfully but every endpoint expects an object.
 if(body===null||typeof body!=='object'||Array.isArray(body))throw failure('请求内容无效');
 return body;
}
