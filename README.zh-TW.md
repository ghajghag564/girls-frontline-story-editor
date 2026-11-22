# Girls' Frontline Story Editor

[简体中文](README.md) · 繁體中文 · [English](README.en.md)

《少女前線2：追放》的非官方同人劇情編輯器。把對白、旁白和停頓編排成場景，為本機人物模型設定登場、退場、站位與表情，再於瀏覽器預覽並匯出橫式 MP4。

本專案與遊戲營運方及權利人無隸屬關係。

**0.1.27-rc.7 · Windows x64 · 在本機執行**

![編輯器實機截圖，顯示場景列表、舞台預覽、條目設定和時間軸](docs/images/editor.png)

*截圖使用空白素材清單及自寫對白，展示編輯介面與時間軸。*

## 功能

- **編排劇情。** 將故事拆成多個場景，調整條目順序、文字顯示速度、停留時間與轉場。
- **預覽演出。** 使用本機模型、貼圖、背景與配樂編排舞台，拖曳時間軸檢查人物站位、表情及音樂銜接。
- **儲存與匯出。** 將專案儲存在本機，從完整作品選取片段，匯出 16:9 的 H.264 或 H.265 MP4。

本儲存庫收錄編輯器原始碼、測試、設定範本、文件、編輯器實機截圖及標明授權的相容性修補檔。模型、圖像、配樂及練習專案由使用者自行準備與設定。遊戲素材請依各權利人的授權使用。 [原始碼與功能範圍](docs/SOURCE_SCOPE.md) · [素材權利](ASSET_RIGHTS.md)

## 在本機啟動

1. 準備 Node.js 24.x、採用 v6 ABI 的 Windows x64 版 Purism Core 1.1.0，以及 FFmpeg。FFmpeg 需支援 FLAC 解碼、AAC 編碼，以及 `libx264` 或 `libx265`。 [執行環境與建置方式](THIRD_PARTY_NOTICES.md)
2. 將[設定範本](local-config.example.json)複製到原始碼目錄之外，命名為 `editor.local.json`。填入素材目錄 `materialsDirectory`、獨立工作區 `workspaceDirectory`、Purism Core DLL `purismCore` 和 FFmpeg 執行檔 `ffmpeg` 的路徑。相對路徑以設定檔所在目錄為準。 [素材目錄格式](docs/LOCAL_ASSETS.md)
3. 備妥素材目錄和雜湊清單後，即可執行下方指令。若想開啟空白專案，先在素材目錄內建立 `assets/catalog.json`，寫入 `{"version":"local","backgrounds":[],"characters":[],"music":[]}`，再到原始碼目錄執行 `node scripts/index-materials.mjs 'C:/GFSE-local/materials'`。請將範例路徑換成你的實際路徑。

```powershell
npm.cmd ci --ignore-scripts
node src/server/start.mjs --config 'C:/GFSE-local/editor.local.json'
```

終端機會顯示本機編輯器網址。啟動時加上 `--no-browser` 即可自行開啟網址。設定 `exampleProject` 後，新工作區會顯示本機的練習專案，可以另存為副本。

## 驗證原始碼

```powershell
node scripts/verify-manifest.mjs
node scripts/check.mjs
```

這些指令會核對原始碼清單、檢查 JavaScript 語法並執行測試。

## 授權與署名

本專案免費提供，**可取得原始碼，採非商業授權**。專案原創程式碼採用 **PolyForm Noncommercial 1.0.0**，詳見授權條款原文。OSI 的開放原始碼定義要求允許商業用途。 [授權條款](LICENSE.md) · [適用範圍](LICENSE_SCOPE.md) · [OSI 開放原始碼定義](https://opensource.org/osd)

編輯器使用 Sakura Motion Project 的 **Purism Core 1.1.0** 讀取 MOC3 模型。上游函式庫及隨附的相容性修補檔均採 **MIT** 授權。本專案與 Live2D Inc. 無隸屬關係。 [第三方相依元件](THIRD_PARTY_NOTICES.md) · [Purism Core 建置說明](docs/PURISM.md)

軟體作者為章帅瑛，協作開發為一只鲍鱼吖。 [作者署名](AUTHORS) · [素材權利](ASSET_RIGHTS.md)
