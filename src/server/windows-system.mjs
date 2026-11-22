import path from 'node:path';
// The supported portable Windows build pins system tools; environment variables cannot redirect them.
export function systemDirectory({systemRoot=process.env.SystemRoot,windir=process.env.windir}={}){
 for(const value of [systemRoot,windir])if(value!==undefined&&value!==''){
  if(typeof value!=='string'||path.win32.normalize(value).replace(/[\\/]+$/,'').toLowerCase()!=='c:\\windows')throw new Error('此发行版只支持 Windows 系统目录 C:\\Windows；拒绝由 SystemRoot/windir 指向其他目录。');
 }
 return 'C:\\Windows\\System32';
}
