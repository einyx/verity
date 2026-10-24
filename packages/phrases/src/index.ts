import type { LanguageTag } from '@logto/language-kit';
import { languages, findSupportedLanguageTag } from '@logto/language-kit';
import type { DeepPartial, NormalizeKeyPaths } from '@silverhand/essentials';
import { z } from 'zod/v3';

import ar from './locales/ar/index.js';
import demoChatar from './locales/ar/translation/demo-chat.js';
import de from './locales/de/index.js';
import demoChatde from './locales/de/translation/demo-chat.js';
import en from './locales/en/index.js';
import demoChatEn from './locales/en/translation/demo-chat.js';
import es from './locales/es/index.js';
import demoChates from './locales/es/translation/demo-chat.js';
import faIR from './locales/fa-ir/index.js';
import demoChatfaIr from './locales/fa-ir/translation/demo-chat.js';
import fr from './locales/fr/index.js';
import demoChatfr from './locales/fr/translation/demo-chat.js';
import it from './locales/it/index.js';
import demoChatit from './locales/it/translation/demo-chat.js';
import ja from './locales/ja/index.js';
import demoChatja from './locales/ja/translation/demo-chat.js';
import ko from './locales/ko/index.js';
import demoChatko from './locales/ko/translation/demo-chat.js';
import plPL from './locales/pl-pl/index.js';
import demoChatplPl from './locales/pl-pl/translation/demo-chat.js';
import ptBR from './locales/pt-br/index.js';
import demoChatptBr from './locales/pt-br/translation/demo-chat.js';
import ptPT from './locales/pt-pt/index.js';
import demoChatptPt from './locales/pt-pt/translation/demo-chat.js';
import ru from './locales/ru/index.js';
import demoChatru from './locales/ru/translation/demo-chat.js';
import th from './locales/th/index.js';
import demoChatth from './locales/th/translation/demo-chat.js';
import trTR from './locales/tr-tr/index.js';
import demoChattrTr from './locales/tr-tr/translation/demo-chat.js';
import zhCN from './locales/zh-cn/index.js';
import demoChatzhCn from './locales/zh-cn/translation/demo-chat.js';
import zhHK from './locales/zh-hk/index.js';
import demoChatzhHk from './locales/zh-hk/translation/demo-chat.js';
import zhTW from './locales/zh-tw/index.js';
import demoChatzhTw from './locales/zh-tw/translation/demo-chat.js';
import type { LocalePhrase } from './types.js';

export type { LocalePhrase } from './types.js';

export type DefaultLocale = 'en';
export type I18nKey = NormalizeKeyPaths<typeof en.translation>;

export const builtInLanguages = [
  'ar',
  'de',
  'en',
  'es',
  'fa-IR',
  'fr',
  'it',
  'ja',
  'ko',
  'pl-PL',
  'pt-BR',
  'pt-PT',
  'ru',
  'th',
  'tr-TR',
  'zh-CN',
  'zh-HK',
  'zh-TW',
] as const;

export const builtInLanguageOptions = builtInLanguages.map((languageTag) => ({
  value: languageTag,
  title: languages[languageTag],
}));

export const builtInLanguageTagGuard = z.enum(builtInLanguages);

export type BuiltInLanguageTag = z.infer<typeof builtInLanguageTagGuard>;

export type Errors = typeof en.errors;
export type LogtoErrorCode = NormalizeKeyPaths<Errors>;
export type LogtoErrorI18nKey = `errors:${LogtoErrorCode}`;

export type AdminConsoleKey = NormalizeKeyPaths<typeof en.translation.admin_console>;

export const getDefaultLanguageTag = (language: string): LanguageTag =>
  builtInLanguageTagGuard.parse(
    findSupportedLanguageTag(language ? [language] : [], builtInLanguages)
  );

export const isBuiltInLanguageTag = (language: string): language is BuiltInLanguageTag =>
  builtInLanguageTagGuard.safeParse(language).success;

export type Resource = Record<
  Exclude<BuiltInLanguageTag, DefaultLocale>,
  DeepPartial<LocalePhrase>
> & {
  [key in DefaultLocale]: LocalePhrase;
};

const resource: Resource = {
  ar,
  de,
  en,
  es,
  'fa-IR': faIR,
  fr,
  it,
  ja,
  ko,
  'pl-PL': plPL,
  'pt-BR': ptBR,
  'pt-PT': ptPT,
  ru,
  th,
  'tr-TR': trTR,
  'zh-CN': zhCN,
  'zh-HK': zhHK,
  'zh-TW': zhTW,
};

export default resource;

/** Landing demo chat copy by locale tag. Exported on its own so the chat bundle stays small. */
/** English demo chat copy, the fallback for every locale. */

export const demoChatByLocale: Readonly<Record<string, typeof demoChatEn>> = Object.freeze({
  ar: demoChatar,
  de: demoChatde,
  en: demoChatEn,
  es: demoChates,
  'fa-ir': demoChatfaIr,
  fr: demoChatfr,
  it: demoChatit,
  ja: demoChatja,
  ko: demoChatko,
  'pl-pl': demoChatplPl,
  'pt-br': demoChatptBr,
  'pt-pt': demoChatptPt,
  ru: demoChatru,
  th: demoChatth,
  'tr-tr': demoChattrTr,
  'zh-cn': demoChatzhCn,
  'zh-hk': demoChatzhHk,
  'zh-tw': demoChatzhTw,
});

export { default as demoChatEn } from './locales/en/translation/demo-chat.js';
