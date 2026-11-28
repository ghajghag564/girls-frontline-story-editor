# 本地配置与素材目录

`editor.local.json` 中的相对路径以该配置文件所在的目录为准。也可以使用绝对路径。`workspaceDirectory` 用于保存工程、预览状态和导出文件，它需要与源码目录及素材目录分开。

```json
{
  "materialsDirectory": "./materials",
  "workspaceDirectory": "./workspace",
  "purismCore": "./dependencies/PurismCore.dll",
  "mediaFoundation": "./dependencies/media-foundation.exe",
  "ffmpeg": "./dependencies/ffmpeg.exe",
  "exampleProject": "./practice.gf2story.json"
}
```

`exampleProject` 是可选的本地工程，首次打开空工作区会预览它。已有工程可以从「打开」选择或导入。练习副本、自动保存和 MP4 分别写入工作区的 `userdata/` 和 `exports/`。

`mediaFoundation` 指向自行构建的 Windows 调用程序。`ffmpeg` 指向自行安装的 FFmpeg，可用于备用，也可单独使用。未准备的字段直接从配置中移除。两项都省略时，可继续编辑和预览。配置更新后重启编辑器即可重新检测。 [Windows 导出构建](../src/native/BUILD.md)

## 配置素材

`materialsDirectory` 填写包含 `assets/` 的父目录。编辑器依据 `assets/catalog.json` 中的相对路径读取本机素材，通过 `assets/asset-hashes.json` 核对文件。

```text
materials/
  assets/
    catalog.json
    asset-hashes.json
    …
```

自建素材目录时，先写 `assets/catalog.json`，顶层包含 `version`、`backgrounds`、`characters` 和 `music`。没有对应素材的列表填写 `[]`。`version` 是自选的短字符串，素材编号 `id` 使用字母、数字、下划线或连字符。同一分类的编号彼此唯一，路径相对 `assets/`，分隔符为 `/`。

| 分类 | 目录字段 |
| --- | --- |
| 背景 | `id`、`name`、`path` 指向 PNG。`width`、`height` 为像素尺寸。可选 `thumbnail`。 |
| 人物 | `id`、`name`、`modelPath` 指向 MOC3。`textures` 每项含 `index` 和 PNG 的 `path`，索引对应模型贴图槽。可选 `styleName`、`thumbnail`、`framing.bounds` 和 `defaultPlacement`。 |
| 参数与表情 | `parameters` 每项含 `id`、`min`、`max`、`default`。`expressions` 每项含 `id`、`name`、`parameters`，表情参数含 `id`、`value`，可选 `blend` 为 `Overwrite`、`Add` 或 `Multiply`。可选 `fadeIn`、`fadeOut` 以秒计。 |
| 眼睛与嘴部 | 可选 `eyeBlink` 支持 `enabled`、`mean` 和 `parameterIds`。口型使用模型实际提供的 `ParamMouthOpenY`，依工程时间轴与标点驱动。 |
| 配乐 | `id`、`name`、`path` 指向双声道 48 kHz FLAC。`samples` 是每声道样本数，`duration` 是秒数。可选以样本编号表示的 `loop.start` 与 `loop.end`。 |

凡在目录中写有 `sha256` 的素材都按该值校验。更新目录后，从源码根目录运行下面的命令，为明确列出的本地文件记录大小与 SHA-256。

```powershell
node scripts/index-materials.mjs 'C:/GFSE-local/materials'
```

编辑器支持从界面导入 JPG 或 PNG 作为静态人物和背景。目录中的模型通过贴图槽编号关联 PNG。工程会保存背景取景，以及人物的站位和大小。

在「音乐 → 导入本地音频」加入的音频经浏览器解码后保存至 `workspaceDirectory` 下的 `userdata/local-audio`。项目文件保存音频引用。跨工作区迁移工程时，需一并迁移相应的本地音频资料。

本地 MP4 或 WebM 可导入为视频背景或过场，单个文件最长 10 分钟、最大 128 MiB。视频保存在 `workspaceDirectory` 下的 `userdata/local-video`，可读取的原声保存在 `userdata/local-audio`。跨工作区迁移工程时，一并迁移引用的文件。

## 可选字体

系统字体可直接使用。想采用玩家版同款字体时，把有权使用的原版文件放到素材目录的 `assets/fonts`，重新运行 `scripts/index-materials.mjs` 后重启编辑器。字体文件名按下表放置。

| 字体 | 文件名 |
| --- | --- |
| HarmonyOS Sans SC Medium、Bold | `story-medium.ttf` 和 `story-bold.ttf` |
| Inter 4.1 | `InterVariable.woff2` |
| 思源黑体台湾版 2.005R | `SourceHanSansTW-VF.ttf.woff2` |
| 思源黑体日本版 2.005R | `SourceHanSansJP-VF.ttf.woff2` |

「字幕样式 → 字幕字形」会将选择写入工程。字体按各自的许可使用。[第三方依赖与许可](../THIRD_PARTY_NOTICES.md)

## 人物与表情显示名

人物与造型可在本地素材清单的 characters 各项中提供 displayNames 对象。使用 zh-TW、en 或 ja 作为键，每种语言可设置 name 和 styleName。未填写的字段使用清单中的原名，简体中文读取原名。搜索支持原名、译名和素材 ID。模型表情使用编辑器提供的通用译名，工程保存的素材 ID 和手写发言名按原值读取。
