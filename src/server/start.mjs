import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import {readLocalConfig} from './local-config.mjs';
import {systemDirectory} from './windows-system.mjs';
import {runLauncher} from './launcher.mjs';

const sourceRoot = fileURLToPath(new URL('../../', import.meta.url));
try {
  const {values} = parseArgs({options:{config:{type:'string'}, 'no-browser':{type:'boolean'}, help:{type:'boolean'}}});
  if (values.help) {
    console.log('中文\n用法  node src/server/start.mjs --config <本地配置.json> [--no-browser]\n\nEnglish\nUsage  node src/server/start.mjs --config <local-config.json> [--no-browser]');
  } else {
    if (!values.config) {
      throw Object.assign(new Error('请用 --config 指定本地配置文件。'), {
        englishMessage:'Use --config to specify a local configuration file.',
      });
    }
    if (process.platform !== 'win32' || process.arch !== 'x64' || !process.versions.node.startsWith('24.')) {
      throw Object.assign(new Error('完整编辑器需要 Windows x64 和 Node.js 24.x。'), {
        englishMessage:'The editor requires Windows x64 and Node.js 24.x.',
      });
    }
    systemDirectory();
    await runLauncher(await readLocalConfig(values.config, sourceRoot), {noBrowser:values['no-browser']});
  }
} catch (error) {
  console.error(
    '启动失败。' + error.message + '\n\nStartup failed. ' +
    (error.englishMessage ?? 'See the details above.'),
  );
  process.exitCode = 1;
}
