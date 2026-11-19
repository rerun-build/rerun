import { DEFAULT_LOCALE, mergeMessages, type Locale } from "@moldwright/i18n";
import german from "@moldwright/i18n/messages/de/emails.json";
import english from "@moldwright/i18n/messages/en/emails.json";
import spanish from "@moldwright/i18n/messages/es/emails.json";
import french from "@moldwright/i18n/messages/fr/emails.json";
import portuguese from "@moldwright/i18n/messages/pt/emails.json";
import { createTranslator } from "use-intl/core";

export type { Locale as EmailLocale };

const PACKS: Record<Locale, typeof english | Partial<typeof english>> = {
  en: english,
  fr: french,
  es: spanish,
  pt: portuguese,
  de: german,
};

export function emailTranslator(locale: Locale = DEFAULT_LOCALE) {
  const emails = mergeMessages({} as typeof english, english, locale === DEFAULT_LOCALE ? undefined : PACKS[locale]);
  return createTranslator({ locale, messages: { emails }, namespace: "emails" });
}

export type EmailTranslator = ReturnType<typeof emailTranslator>;
