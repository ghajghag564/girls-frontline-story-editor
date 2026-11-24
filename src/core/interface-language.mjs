export const defaultInterfaceLanguage = 'zh-CN';
export const interfaceLanguages = Object.freeze({
  'zh-CN': '简体中文',
  'zh-TW': '繁體中文',
  en: 'English',
  ja: '日本語',
});

export function isInterfaceLanguage(value) {
  return typeof value === 'string' && Object.hasOwn(interfaceLanguages, value);
}

const traditionalPunctuation = {
  '、': ',', '。': '.', '「': '"', '」': '"', '『': "'", '』': "'",
  '“': '"', '”': '"', '‘': "'", '’': "'", '【': '[', '】': ']',
};

// Apply only to the built-in Traditional Chinese copy, before interpolation.
export function halfwidthTraditionalPunctuation(text) {
  return text
    .replace(/([，、。！？；：]+|…+)(?=[\p{L}\p{N}{])/gu, '$1 ')
    .replace(/([\p{L}\p{N}])(?=[（［【「『“‘])/gu, '$1 ')
    .replace(/([）］】」』”’])(?=[\p{L}\p{N}])/gu, '$1 ')
    .replace(/…+|[\uFF01-\uFF0F\uFF1A-\uFF20\uFF3B-\uFF40\uFF5B-\uFF5E、。「」『』“”‘’【】]/gu, mark => {
      if (mark.startsWith('…')) return '...';
      return traditionalPunctuation[mark] ?? String.fromCharCode(mark.charCodeAt(0) - 0xFEE0);
    });
}
