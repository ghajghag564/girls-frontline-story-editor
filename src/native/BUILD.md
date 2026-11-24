# Windows MP4 导出调用程序

调用程序使用 Windows Media Foundation 编码 H.264、AAC 及可用的 H.265，并解码双声道 48 kHz FLAC。它从编辑器接收 RGBA 画面和混音。编解码器由本机 Windows 提供。 [微软编解码器说明](https://learn.microsoft.com/en-us/windows/apps/develop/media-authoring-processing/supported-codecs)

使用 WinLibs MinGW-w64 GCC 15.2.0 x86-64（MSVCRT、POSIX、SEH），从源码根目录构建到外部依赖目录。

```powershell
$dependencies = 'C:/GFSE-local/dependencies'
New-Item -ItemType Directory -Path $dependencies -Force | Out-Null
g++ -std=c++17 -O2 -s -static -Wall -Wextra -municode src/native/media-foundation.cpp -o (Join-Path $dependencies 'media-foundation.exe') -lmfreadwrite -lmfplat -lmfuuid -lole32
```

把生成的 `media-foundation.exe` 填入本地配置中的 `mediaFoundation` 字段。可同时用 `ffmpeg` 设置备用。依赖以启动时的文件哈希为准，更新二进制后重启编辑器。 [本地配置](../../docs/LOCAL_ASSETS.md)
