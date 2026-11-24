import fs from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {checkDependency} from './local-config.mjs';

const codecs = ['h264', 'h265'];

function capture(executable, args, {signal, timeout} = {}) {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {windowsHide:true, stdio:['ignore', 'pipe', 'pipe']});
    let stdout = '', stderr = '', expired = false, spawnError;
    const abort = () => child.kill();
    const timer = timeout && setTimeout(() => {
      expired = true;
      abort();
    }, timeout);
    timer?.unref();
    signal?.addEventListener('abort', abort, {once:true});
    if (signal?.aborted) abort();
    child.stdout.on('data', chunk => { stdout = (stdout + chunk).slice(-150000); });
    child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-16000); });
    child.on('error', error => { spawnError = error; });
    child.on('close', code => {
      if (timer) clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      if (signal?.aborted) reject(signal.reason);
      else if (expired) reject(new Error('编码器检测超时'));
      else if (spawnError) reject(spawnError);
      else if (code !== 0) reject(new Error(stderr.trim().slice(-1500) || '音视频组件退出，状态 '+code));
      else resolve(stdout);
    });
  });
}

function windowsArgs(mode, settings, out, music, acceleration) {
  return [mode, settings.codec, String(settings.width), String(settings.height), String(settings.fps),
    String(Math.round(settings.bitrateMbps*1e6)), String(mode === 'probe' ? 2 : settings.frames),
    out, music ?? '-', acceleration];
}

function ffmpegArgs(settings, out, mixed) {
  const args = ['-hide_banner','-loglevel','warning','-y','-f','rawvideo','-pixel_format','rgba',
    '-video_size',settings.width+'x'+settings.height,'-framerate',String(settings.fps),'-protocol_whitelist','pipe','-i','pipe:0'];
  if (mixed) args.push('-f','f32le','-ar','48000','-ac','2','-protocol_whitelist','file','-i',mixed);
  args.push('-map','0:v:0');
  if (mixed) args.push('-map','1:a:0','-c:a','aac','-b:a','192k');
  else args.push('-an');
  args.push('-c:v',settings.codec === 'h264' ? 'libx264' : 'libx265','-preset','fast','-pix_fmt','yuv420p',
    '-b:v',settings.bitrateMbps+'M','-maxrate',settings.bitrateMbps+'M','-bufsize',(settings.bitrateMbps*2)+'M',
    '-frames:v',String(settings.frames),'-movflags','+faststart');
  if (settings.codec === 'h265') args.push('-tag:v','hvc1');
  return [...args, out];
}

export class ExportEncoder {
  constructor({mediaFoundation, ffmpeg}) {
    this.mediaFoundation = mediaFoundation;
    this.ffmpeg = ffmpeg;
    this.windowsCodecs = [];
    this.ffmpegCodecs = [];
    this.ffmpegHasAac = false;
  }

  get capabilities() {
    return {
      codecs:codecs.filter(codec => this.windowsCodecs.includes(codec) || this.ffmpegCodecs.includes(codec)),
      windowsCodecs:this.windowsCodecs,
      ffmpegCodecs:this.ffmpegCodecs,
    };
  }

  async initialize() {
    if (this.mediaFoundation) {
      try {
        const executable = await checkDependency(this.mediaFoundation);
        const info = await capture(executable, ['list'], {timeout:8000});
        const available = info.trim().split(/\s+/);
        this.windowsCodecs = codecs.filter(codec => available.includes(codec));
      } catch (error) {
        console.warn('Windows 编码组件不可用：'+error.message);
      }
    }
    if (this.ffmpeg) {
      try {
        const executable = await checkDependency(this.ffmpeg);
        const info = await capture(executable, ['-hide_banner', '-nostdin', '-encoders'], {timeout:8000});
        const names = new Set(Array.from(info.matchAll(/^\s*[VA][.A-Z]{5}\s+([a-z0-9_]+)/gm), match => match[1]));
        this.ffmpegCodecs = codecs.filter(codec => names.has(codec === 'h264' ? 'libx264' : 'libx265'));
        this.ffmpegHasAac = names.has('aac');
      } catch (error) {
        console.warn('FFmpeg 编码组件不可用：'+error.message);
      }
    }
  }

  async choose(settings, audio, probePath, signal) {
    if (this.windowsCodecs.includes(settings.codec)) {
      const executable = await checkDependency(this.mediaFoundation);
      const choices = settings.codec === 'h265' ? ['hardware', 'software'] : ['software', 'hardware'];
      for (const acceleration of choices) {
        signal.throwIfAborted();
        try {
          await capture(executable, windowsArgs('probe',settings,probePath,audio ? 'audio' : null,acceleration),
            {signal,timeout:12000});
          return {id:'windows', dependency:this.mediaFoundation, acceleration};
        } catch (error) {
          signal.throwIfAborted();
          console.warn('Windows 媒体编码档位检测失败：'+error.message);
        } finally {
          await fs.unlink(probePath).catch(error => { if (error.code !== 'ENOENT') throw error; });
        }
      }
    }
    if (this.ffmpegCodecs.includes(settings.codec) && (!audio || this.ffmpegHasAac)) {
      return {id:'ffmpeg', dependency:this.ffmpeg};
    }
    throw new Error('当前设备无法按所选设置导出。请更换编码、清晰度或帧率，或检查本地配置。');
  }

  async decode(backend, source, target, signal) {
    let executable = await checkDependency(backend.dependency);
    if (backend.id === 'windows') {
      try {
        await capture(executable, ['decode',source,target], {signal});
        return;
      } catch (error) {
        signal.throwIfAborted();
        if (!this.ffmpeg) throw new Error('Windows 无法解码此 FLAC 配乐。可配置外置 FFmpeg 后重试。',{cause:error});
        executable = await checkDependency(this.ffmpeg);
      }
    }
    await capture(executable, ['-hide_banner','-loglevel','error','-nostdin','-y','-protocol_whitelist','file',
      '-f','flac','-i',source,'-f','f32le','-ar','48000','-ac','2',target],{signal});
  }

  async command(backend, settings, output, mixed, signal) {
    const executable = await checkDependency(backend.dependency);
    const args = backend.id === 'windows'
      ? windowsArgs('encode',settings,output,mixed,backend.acceleration)
      : ffmpegArgs(settings,output,mixed);
    signal.throwIfAborted();
    return {executable,args};
  }
}

