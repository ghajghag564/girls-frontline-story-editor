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
  if (!lock && !previous) {
    throw Object.assign(new Error('此工作目录的其他启动进程尚未完成，请稍后重试。'), {
      englishMessage:'Another launch in this workspace is in progress. Try again in a moment.',
    });
  }

  if (lock) {
    try {
      previous = await existing();
      if (!previous) {
        let stopping;
        const stop = () => stopping ??= (async () => {
          console.log('\n正在关闭编辑器……\n\nClosing the editor...');
          await app.close();
        })().catch(error => {
          console.error('关闭失败。' + error.message + '\n\nShutdown failed. See the details above.');
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
  const chinese = ['中文', '追放 · 剧情编辑器 v' + release.version, '编辑器地址：' + origin];
  const english = ['English', "Girls' Frontline Story Editor v" + release.version, 'Editor URL: ' + origin];
  if (previous) {
    chinese.push('已连接同一工作目录的现有服务。若修改了配置，请先保存并退出旧服务。');
    english.push('Connected to the editor running in this workspace. If you changed the configuration, save and exit the existing editor before relaunching.');
  } else {
    chinese.push('编辑器已启动，请保持此终端运行。完成后，在“工程”菜单选择“保存并退出”。');
    english.push('The editor is running. Keep this terminal open. When finished, choose "Save and exit" from the Project menu.');
  }
  console.log([...chinese, '', ...english].join('\n'));
  if (!noBrowser) {
    const failure = () => console.error('\n浏览器未能自动打开，请复制上方地址打开。\n\nCould not open the browser automatically. Open the URL above in your browser.');
    try {
      await openSystemBrowser(origin, {onError:failure});
    } catch {
      failure();
    }
  }
}
