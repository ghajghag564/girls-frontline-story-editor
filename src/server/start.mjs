import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import {readLocalConfig} from './local-config.mjs';
import {systemDirectory} from './windows-system.mjs';
import {runLauncher} from './launcher.mjs';

const sourceRoot = fileURLToPath(new URL('../../', import.meta.url));
try {
  const {values} = parseArgs({options:{config:{type:'string'}, 'no-browser':{type:'boolean'}, help:{type:'boolean'}}});
  if (values.help) {
    console.log('用法  node src/server/start.mjs --config <本地配置.json> [--no-browser]');
  } else {
    if (!values.config) throw new Error('请用 --config 指定本地配置文件');
    if (process.platform !== 'win32' || process.arch !== 'x64' || !process.versions.node.startsWith('24.')) {
      throw new Error('完整编辑器需要 Windows x64 和 Node.js 24.x');
    }
    systemDirectory();
    await runLauncher(await readLocalConfig(values.config, sourceRoot), {noBrowser:values['no-browser']});
  }
} catch (error) {
  console.error('启动失败：' + error.message);
  process.exitCode = 1;
}
