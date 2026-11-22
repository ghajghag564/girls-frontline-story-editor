import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import fs from 'node:fs/promises';
import path from 'node:path';
import {checkRequestSource,validSessionToken,readJson,JSON_LIMIT,HTTP_LIMITS} from '../src/server/request-security.mjs';
import {SafeDirectory} from '../src/server/safe-files.mjs';
const origin='http://127.0.0.1:37991';
const request=(headers={})=>({headers:{host:'127.0.0.1:37991',...headers}});
test('local navigation and same-origin traffic remain permitted',()=>{
 for(const site of [undefined,'none','same-origin'])assert.doesNotThrow(()=>checkRequestSource(request({'sec-fetch-site':site}),origin));
 assert.doesNotThrow(()=>checkRequestSource(request({origin}),origin));
});
test('DNS rebinding, foreign Origin, cross-site and same-site other-port requests rejected',()=>{
 for(const headers of [{host:'evil.example:37991'},{host:'127.1:37991'},{origin:'http://127.0.0.1:37992'},{origin:'null'},{'sec-fetch-site':'cross-site'},{'sec-fetch-site':'same-site'}])assert.throws(()=>checkRequestSource(request(headers),origin),e=>e.status===403);
});
test('compressed requests never reach a decoder',()=>{
 for(const encoding of ['br','gzip','deflate'])assert.throws(()=>checkRequestSource(request({'content-encoding':encoding}),origin),e=>e.status===415);
});
test('tokens require exact random hex bytes; Unicode does not throw or authenticate',()=>{
 const token='ab'.repeat(32);assert.equal(validSessionToken(token,token),true);
 for(const candidate of [undefined,[],token+'0','ac'.repeat(32),'é'.repeat(64),'A'.repeat(64)])assert.equal(validSessionToken(candidate,token),false);
});
const body=(chunks,headers={})=>Object.assign(Readable.from(chunks),{headers:{'content-type':'application/json',...headers}});
test('JSON handles UTF-8 and rejects wrong MIME, malformed JSON and announced oversized bodies',async()=>{
 assert.deepEqual(await readJson(body([Buffer.from('{"text":"角色台词"}')])),{text:'角色台词'});
 await assert.rejects(readJson(body([Buffer.from('{}')],{'content-type':'text/plain'})),e=>e.status===415);
 await assert.rejects(readJson(body([Buffer.from('{')])),e=>e.status===400);
 await assert.rejects(readJson(body([] ,{'content-length':String(JSON_LIMIT+1)})),e=>e.status===413);
});
test('chunked oversized body rejected even without Content-Length',async()=>{
 await assert.rejects(readJson(body([Buffer.alloc(JSON_LIMIT,32),Buffer.from('x')])),e=>e.status===413);
});
test('path traversal, absolute paths, alternate streams and Windows device paths rejected',async()=>{
 const files=new SafeDirectory(path.resolve('.source-checks/security/fixture'));
 for(const p of ['../escape','C:/outside-workspace/file','file:stream','a/../../escape','a\\b','CON','a/NUL.txt','a.']){
  await assert.rejects(files.resolve(p));
 }
});
test('server request limits are finite and allow one 4K frame without increasing JSON limits',()=>{
 assert.equal(JSON_LIMIT,4194304);assert.ok(HTTP_LIMITS.headersTimeout<=10000);assert.ok(HTTP_LIMITS.requestTimeout<=120000);assert.ok(HTTP_LIMITS.maxHeaderSize<=16384);
});
test('production export cannot fall back to the old development FFmpeg',async()=>{
 const text=await fs.readFile(new URL('../src/server/export-service.mjs',import.meta.url),'utf8');
 assert.equal(text.includes('imageio_ffmpeg'),false);
 assert.match(text,/'-protocol_whitelist','file','-f','flac'/);
 const guard=text.indexOf('!==asset.sha256'),decode=text.indexOf("this.command(['-hide_banner','-loglevel','error'");assert.ok(guard>=0&&decode>guard);
});
