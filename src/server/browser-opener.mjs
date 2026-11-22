import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {systemDirectory} from './windows-system.mjs';
export async function openSystemBrowser(origin,{systemRoot,windir,access=fs.access,spawnProcess=spawn,onError=console.error}={}){
 if(!/^http:\/\/127\.0\.0\.1:\d+$/.test(origin))throw new Error('浏览器目标必须是本机编辑器地址');
 const directory=systemDirectory({systemRoot,windir}),executable=path.win32.join(directory,'rundll32.exe'),dll=path.win32.join(directory,'url.dll');
 await access(executable);await access(dll);
 const child=spawnProcess(executable,[dll+',FileProtocolHandler',origin],{cwd:directory,shell:false,windowsHide:true,stdio:'ignore'});
 child.on('error',onError);child.unref();return executable;
}
