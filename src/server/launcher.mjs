import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {openSystemBrowser} from './browser-opener.mjs';
import {startServer} from './server.mjs';
import {SafeDirectory} from './safe-files.mjs';
import {release} from '../core/release.mjs';

export function workspaceId(directory) {
  return createHash('sha256').update(directory.toLowerCase()).digest('hex');
}

export async function runLauncher(config, {noBrowser = false} = {}) {
  const files = new SafeDirectory(config.workspaceDirectory);
  const rootId = workspaceId(files.root);
  await files.initialize();
  await fs.mkdir(await files.resolve('userdata'), {recursive:true});
  const lockPath = await files.resolve('userdata/launch.lock');
  const sessionFile = 'userdata/server-session.json';

  async function existing() {
    try {
      const session = JSON.parse(await files.read(sessionFile));
      if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(session.origin)) return null;
      const response = await fetch(session.origin + '/health', {signal:AbortSignal.timeout(1500), redirect:'error'});
      if (!response.ok) return null;
      const status = await response.json();
      if (status.application === 'gf2-story-editor' && status.rootId === rootId) return session;
    } catch {
      // A session record is reusable only while its service responds with this workspace ID.
    }
    return null;
  }

  let lock, previous, app;
  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      lock = await fs.open(lockPath, 'wx');
      break;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      previous = await existing();
      if (previous) break;
      try {
        if (Date.now() - (await fs.stat(lockPath)).mtimeMs > 30000) {
          await fs.unlink(await files.resolve('userdata/launch.lock'));
        } else {
          await delay(100);
        }
      } catch (lockError) {
        if (lockError.code !== 'ENOENT') throw lockError;
      }
    }
  }
  if (!lock && !previous) throw new Error('此工作目录的其他启动进程尚未完成，请稍后重试');

  if (lock) {
    try {
      previous = await existing();
      if (!previous) {
        let stopping;
        const stop = () => stopping ??= app.close().catch(error => {
          console.error('关闭失败：' + error.message);
          process.exitCode = 1;
        });
        app = await startServer(config, {rootId, onShutdown:stop});
        await files.atomicWrite(sessionFile, JSON.stringify({origin:app.origin, rootId, pid:process.pid}));
        for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, stop);
      }
    } catch (error) {
      await app?.close();
      throw error;
    } finally {
      await lock.close();
      await fs.unlink(await files.resolve('userdata/launch.lock'));
    }
  }

  const origin = previous?.origin ?? app.origin;
  console.log("Girls' Frontline Story Editor v" + release.version);
  console.log('编辑器地址：' + origin);
  if (previous) console.log('已连接同一工作目录的现有服务。若修改了配置，请先保存并退出旧服务。');
  if (!noBrowser) {
    const failure = () => console.error('浏览器未能自动打开，请复制上方地址打开。');
    try {
      await openSystemBrowser(origin, {onError:failure});
    } catch {
      failure();
    }
  }
}
