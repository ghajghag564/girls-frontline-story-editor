# 第三方依赖

| 依赖 | 使用方式与许可 |
| --- | --- |
| Node.js 24.x | 本地服务与测试的解释器。Node.js 本体采用 MIT，随附第三方代码的许可列于该发行版的许可文件。 [验收使用的 Node.js 24.22.1 许可](https://github.com/nodejs/node/blob/v24.22.1/LICENSE) |
| Koffi 3.3.3 | 由 npm 锁定文件安装，提供原生函数调用接口。主包内含 MIT 许可文本 `package/LICENSE.txt`。Windows x64 使用可选包 `@koromix/koffi-win32-x64@3.3.3`，该包元数据标为 MIT。 [Koffi 3.3.3 主包](https://registry.npmjs.org/koffi/-/koffi-3.3.3.tgz) · [Windows x64 包](https://registry.npmjs.org/@koromix/koffi-win32-x64/-/koffi-win32-x64-3.3.3.tgz) |
| Purism Core 1.1.0 | 读取 MOC3 的外部模型运行库。Windows x64 使用 v6 ABI。上游及本仓库随附的兼容补丁采用 MIT。 [上游许可](https://github.com/SakuraMotion/PurismCore/blob/1069334965522df5d0b791e97f01e26b19c45456/LICENSE) · [构建](docs/PURISM.md) |
| Windows Media Foundation | Windows 自带的 H.264、AAC、FLAC 和可选 H.265。源码版提供项目的调用程序源码，由使用者自行构建。 [构建说明](src/native/BUILD.md) · [微软编解码器说明](https://learn.microsoft.com/en-us/windows/apps/develop/media-authoring-processing/supported-codecs) |
| FFmpeg | 作为可选编码器由使用者安装，编辑器通过独立进程调用。按 FFmpeg 上游说明，启用 `libx264` 或 `libx265` 的组合构建适用 GPL。分发附带 FFmpeg 的安装包时，发行方应按实际构建所适用的条款履行许可声明及相应源码义务。 [FFmpeg 外部库许可](https://github.com/FFmpeg/FFmpeg/blob/master/LICENSE.md#compatible-libraries) · [分发说明](https://ffmpeg.org/legal.html) |
| 系统及本地字体 | 源码版读取系统字体或用户配置的本地字体文件。HarmonyOS Sans 适用华为字体许可，Inter 和思源黑体采用 SIL Open Font License 1.1。[字体配置](docs/LOCAL_ASSETS.md#可选字体) · [Inter 许可](https://github.com/rsms/inter/blob/v4.1/LICENSE.txt) · [思源黑体许可](https://github.com/adobe-fonts/source-han-sans/blob/2.005R/LICENSE.txt) |

运行组件的安装和路径配置见 [本地配置](docs/LOCAL_ASSETS.md)。
