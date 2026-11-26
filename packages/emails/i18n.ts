import { DEFAULT_LOCALE, fillBrand, mergeMessages, type Locale } from "@rerun/i18n";
import arabic from "@rerun/i18n/messages/ar/emails.json";
import german from "@rerun/i18n/messages/de/emails.json";
import english from "@rerun/i18n/messages/en/emails.json";
import spanish from "@rerun/i18n/messages/es/emails.json";
import french from "@rerun/i18n/messages/fr/emails.json";
import hebrew from "@rerun/i18n/messages/he/emails.json";
import portuguese from "@rerun/i18n/messages/pt/emails.json";
import turkish from "@rerun/i18n/messages/tr/emails.json";
import chinese from "@rerun/i18n/messages/zh/emails.json";
import taiwanese from "@rerun/i18n/messages/zh-TW/emails.json";
import { createTranslator } from "use-intl/core";

export type { Locale as EmailLocale };

const PACKS: Record<Locale, typeof english | Partial<typeof english>> = {
  en: english,
  fr: french,
  es: spanish,
  pt: portuguese,
  de: german,
  tr: turkish,
  ar: arabic,
  zh: chinese,
  "zh-TW": taiwanese,
  he: hebrew,
};

// Built synchronously: an email is rendered once, outside any request, by code that already knows
// its reader. Merging over an empty base drops the translator notes (`_context`) of the source, and
// a key missing from a pack reads in English.
export function emailTranslator(locale: Locale = DEFAULT_LOCALE, brandName?: string) {
  const emails = fillBrand(mergeMessages({} as typeof english, english, locale === DEFAULT_LOCALE ? undefined : PACKS[locale]), brandName);
  return createTranslator({ locale, messages: { emails }, namespace: "emails" });
}

export type EmailTranslator = ReturnType<typeof emailTranslator>;
