import { DEFAULT_LOCALE, mergeMessages, type Locale } from "@rerun/i18n";
import english from "@rerun/i18n/messages/en/emails.json";
import spanish from "@rerun/i18n/messages/es/emails.json";
import french from "@rerun/i18n/messages/fr/emails.json";
import { createTranslator } from "use-intl/core";

export type { Locale as EmailLocale };

const PACKS: Record<Locale, typeof english | Partial<typeof english>> = {
  en: english,
  fr: french,
  es: spanish,
};

// Built synchronously: an email is rendered once, outside any request, by code that already knows
// its reader. Merging over an empty base drops the translator notes (`_context`) of the source, and
// a key missing from a pack reads in English.
export function emailTranslator(locale: Locale = DEFAULT_LOCALE) {
  const emails = mergeMessages({} as typeof english, english, locale === DEFAULT_LOCALE ? undefined : PACKS[locale]);
  return createTranslator({ locale, messages: { emails }, namespace: "emails" });
}

export type EmailTranslator = ReturnType<typeof emailTranslator>;
