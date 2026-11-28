import {defaultInterfaceLanguage, isInterfaceLanguage} from './interface-language.mjs';

const defaultColors = Object.freeze({ speaker: "#f6be84", text: "#faf3e7", accent: "#eeb67e" });

export function resolveSubtitleSettings(settings) {
  if (settings !== undefined && (!settings || typeof settings !== "object" || Array.isArray(settings))) {
    throw new Error("字幕设置格式无效");
  }
  const mode = settings === undefined ? "game" : settings.mode;
  if (mode !== "game" && mode !== "theater") throw new Error("字幕模式无效");
  const fontLanguage = settings?.fontLanguage ?? defaultInterfaceLanguage;
  if (!isInterfaceLanguage(fontLanguage)) throw new Error("字幕字形无效");

  const overrides = settings?.colors;
  if (overrides !== undefined && (!overrides || typeof overrides !== "object" || Array.isArray(overrides))) {
    throw new Error("小剧场字幕配色格式无效");
  }
  const colors = { ...defaultColors };
  for (const part of Object.keys(colors)) {
    const color = overrides?.[part];
    if (color === undefined) continue;
    if (typeof color !== "string" || !/^#[0-9a-f]{6}$/i.test(color)) {
      throw new Error("小剧场字幕颜色格式无效");
    }
    colors[part] = color;
  }
  return { mode, fontLanguage, colors };
}
