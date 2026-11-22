import test from 'node:test';
import assert from 'node:assert/strict';
import {MusicTransport} from '../src/web/music.mjs';
function context(){return {currentTime:0,destination:{},resume:async()=>{},sources:[],createGain(){return {gain:{value:1,setValueAtTime(){},linearRampToValueAtTime(){}},connect(){},disconnect(){}};},createBufferSource(){const source={connect(){},disconnect(){},start(){},stop(){}};this.sources.push(source);return source;}};}
const asset={id:'music',sampleRate:48000,channels:2,samples:48000,loop:null};
const compiled={duration:10,voices:[{assetId:'music',start:0,offset:0,volume:1,fadeIn:0,loop:false,stopAt:null,fadeOut:0,stopGain:0}]};
test('finished BGM nodes release their AudioBuffer references and never restart',async()=>{
 const audio=context(),transport=new MusicTransport([asset],{createAudioContext:()=>audio});let loaded=0;transport.load=async()=>{loaded++;return {};};
 try{await transport.play(compiled,0);const first=audio.sources[0];assert.equal(transport.nodes.size,1);first.onended();assert.equal(transport.nodes.size,0);const count=loaded;audio.currentTime=3;await transport.schedule(transport.generation);assert.equal(loaded,count);assert.equal(audio.sources.length,1);}finally{transport.pause();}
});
test('an old source ending after seek cannot remove the replacement source',async()=>{
 const audio=context(),transport=new MusicTransport([asset],{createAudioContext:()=>audio});transport.load=async()=>({});
 try{await transport.play(compiled,0);const previous=audio.sources[0];await transport.seek(compiled,.2);const next=audio.sources[1];previous.onended();assert.equal(transport.nodes.get(0).source,next);assert.equal(transport.scheduled.size,1);}finally{transport.pause();}
});
