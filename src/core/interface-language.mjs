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
