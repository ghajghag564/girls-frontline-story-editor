import { defaultInterfaceLanguage, interfaceLanguages, isInterfaceLanguage, halfwidthTraditionalPunctuation } from '../core/interface-language.mjs';
import { messages } from './translations.mjs';

const columns = { 'zh-TW': 0, en: 1, ja: 2 };
const bindings = [];
const selectors = [];
let language = defaultInterfaceLanguage;

export function interfaceLanguage() {
  return language;
}

function format(message, values) {
  return message.replace(/\{(\d+)\}/g, (token, index) => index < values.length ? String(values[index]) : token);
}

export function t(key, ...values) {
  const translation = messages[key]?.[columns[language]];
  const template = language === 'zh-TW' && translation !== undefined
    ? halfwidthTraditionalPunctuation(translation) : translation ?? key;
  return format(template, values);
}

const escape = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const patterns = Object.keys(messages).filter(key => /\{\d+\}/.test(key))
  .map(key => {
    const parts = key.split(/(\{\d+\})/);
    const slots = [];
    const expression = parts.map((part, index) => {
      if (index % 2 === 0) return escape(part);
      slots.push(Number(part.slice(1, -1)));
      return '([\\s\\S]*?)';
    }).join('');
    const fixedLength = parts.filter((_, index) => index % 2 === 0).join('').length;
    return { key, slots, fixedLength, matcher: new RegExp('^' + expression + '$') };
  }).sort((a, b) => b.fixedLength - a.fixedLength);

// Resolve messages from the server and from UI status that survives a language change.
export function translateMessage(message) {
  if (language === defaultInterfaceLanguage || typeof message !== 'string') return message;
  if (Object.hasOwn(messages, message)) return t(message);
  if (!/[\u3400-\u9fff]/.test(message)) return message;
  for (const { key, slots, matcher } of patterns) {
    const match = matcher.exec(message);
    if (!match) continue;
    const values = [];
    slots.forEach((slot, index) => { values[slot] = match[index + 1]; });
    return t(key, ...values);
  }
  return message;
}

export function setInterfaceLanguage(value) {
  if (!isInterfaceLanguage(value)) return false;
  const changed = language !== value;
  language = value;
  document.documentElement.lang = language;
  for (const apply of bindings) apply();
  for (const select of selectors) select.value = language;
  return changed;
}

export function setupLanguageControls(preference, change) {
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.parentElement?.closest('script, style')) continue;
    const original = node.nodeValue;
    const key = original.trim();
    if (!Object.hasOwn(messages, key)) continue;
    bindings.push(() => { node.nodeValue = original.replace(key, () => t(key)); });
  }
  for (const node of document.querySelectorAll('[title], [aria-label], [placeholder], [alt]')) {
    for (const attribute of ['title', 'aria-label', 'placeholder', 'alt']) {
      const key = node.getAttribute(attribute);
      if (Object.hasOwn(messages, key)) bindings.push(() => node.setAttribute(attribute, t(key)));
    }
  }
  for (const select of document.querySelectorAll('[data-interface-language]')) {
    const options = Object.entries(interfaceLanguages).map(([value, label]) => {
      const option = new Option(label, value);
      option.lang = value;
      return option;
    });
    select.replaceChildren(...options);
    select.onchange = () => change(select.value);
    selectors.push(select);
  }
  setInterfaceLanguage(isInterfaceLanguage(preference) ? preference : defaultInterfaceLanguage);
}
