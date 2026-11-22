# Girls' Frontline Story Editor

简体中文 · [English](README.en.md)

《少女前线2：追放》的非官方同人剧情编辑器。把对白、旁白和停顿编排成场景，为本地人物模型设置出入场、站位和表情，随后在浏览器预览并导出横屏 MP4。

本项目与游戏运营方及权利人无隶属关系。

**0.1.27-rc.7 · Windows x64 · 本地运行**

![编辑器实机截图，显示场景列表、舞台预览、条目设置和时间轴](docs/images/editor.png)

*截图使用空素材清单和自写对白，展示编辑界面与时间轴。*

## 可以做什么

- **编排剧情。** 将故事拆成多个场景，调整条目顺序、打字速度、停留和转场。
- **预览演出。** 用本地模型、贴图、背景和配乐编排舞台，拖动时间轴检查人物站位、表情和音乐衔接。
- **保存和导出。** 保存本地工程，从完整作品中选择一段，输出 16:9 的 H.264 或 H.265 MP4。

仓库收录范围限于编辑器源码、测试、配置模板、文档、编辑器实机截图和标明许可的兼容补丁。模型、图像、配乐和练习工程均由使用者自行配置。游戏素材的使用依据相应权利人的许可。 [源码与功能范围](docs/SOURCE_SCOPE.md) · [素材权利](ASSET_RIGHTS.md)

## 在本机启动

1. 准备 Node.js 24.x、Windows x64 的 Purism Core 1.1.0 v6 版本和 FFmpeg。FFmpeg 需要支持 FLAC 解码、AAC 编码，及 `libx264` 或 `libx265`。 [运行依赖与构建方法](THIRD_PARTY_NOTICES.md)
2. 将 [配置模板](local-config.example.json) 复制到源码目录之外，命名为 `editor.local.json`。填入素材目录、独立工作区、Purism Core DLL 和 FFmpeg 可执行文件的路径。相对路径以配置文件所在位置为准。 [素材目录格式](docs/LOCAL_ASSETS.md)
3. 有素材目录和校验清单时，可直接执行下面的启动命令。只想打开空白工程时，先在素材目录中创建 `assets/catalog.json`，写入 `{"version":"local","backgrounds":[],"characters":[],"music":[]}`，再在源码目录运行 `node scripts/index-materials.mjs 'C:/GFSE-local/materials'`。按你的实际路径替换命令中的示例路径。

```powershell
npm.cmd ci --ignore-scripts
node src/server/start.mjs --config 'C:/GFSE-local/editor.local.json'
```

终端会打印本机编辑器地址。启动时加 `--no-browser` 可手动打开该地址。配置 `exampleProject` 后，新工作区会显示本地练习工程，并可通过「建立练习副本」另存。

## 验证源码

```powershell
node scripts/verify-manifest.mjs
node scripts/check.mjs
```

这些命令检查发布清单、JavaScript 语法及独立测试。

## 许可与署名

本项目免费提供，采用**源码可见、非商业许可**。项目原创代码适用 **PolyForm Noncommercial 1.0.0**，具体许可范围以原文为准。OSI 的开源定义要求允许商业用途。 [许可证](LICENSE.md) · [适用范围](LICENSE_SCOPE.md) · [OSI 开源定义](https://opensource.org/osd)

本项目使用 Sakura Motion Project 的 **Purism Core 1.1.0** 读取 MOC3。上游与随附的兼容补丁均采用 **MIT**。本项目与 Live2D Inc. 无隶属关系。 [第三方依赖](THIRD_PARTY_NOTICES.md) · [Purism Core 构建说明](docs/PURISM.md)

软件作者为章帅瑛，协作开发为一只鲍鱼吖。 [作者署名](AUTHORS) · [素材权利](ASSET_RIGHTS.md)
