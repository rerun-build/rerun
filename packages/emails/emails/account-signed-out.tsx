import * as React from "react";
import type { Brand } from "@rerun/contracts";
import { AlertMessage } from "../components/AlertMessage";
import { emailTranslator, type EmailLocale, type EmailTranslator } from "../i18n";

// A subscription is signed in to, a key is replaced: the same stop, not the same way out.
export type AccountKind = "subscription" | "key";

const NAMES_SHOWN = 4;

export interface AccountSignedOutProps {
  kind: AccountKind;
  /** What people call the account: "Claude", "ChatGPT", "OpenAI". */
  account: string;
  /** The coworkers it stopped. Empty when they could not be told. */
  coworkers: string[];
  workspaceName: string | null;
  reconnectUrl: string;
  /** The close-up of the account and the coworkers it stopped, signed by the sender. Without it the usual banner shows. */
  boardUrl?: string;
  appUrl: string;
  unsubscribeUrl?: string;
  locale?: EmailLocale;
  brand?: Brand;
}

export function accountSignedOutSubject({ kind, account, coworkers }: Pick<AccountSignedOutProps, "kind" | "account" | "coworkers">, t: EmailTranslator): string {
  if (!coworkers.length) return t(`accountSignedOut.${kind}.heading`, { account });
  return t(`accountSignedOut.${kind}.subject`, { account, count: coworkers.length });
}

function namesOf(coworkers: string[], t: EmailTranslator, locale: EmailLocale = "en"): string {
  const hidden = coworkers.length - NAMES_SHOWN;
  const names = hidden > 0 ? [...coworkers.slice(0, NAMES_SHOWN), t("accountSignedOut.more", { count: hidden })] : coworkers;
  // English as the app writes it, without a comma before the last name.
  return new Intl.ListFormat(locale === "en" ? "en-GB" : locale, { type: "conjunction" }).format(names);
}

export default function AccountSignedOut({ kind, account, coworkers, workspaceName, reconnectUrl, boardUrl, appUrl, unsubscribeUrl, locale, brand }: AccountSignedOutProps) {
  const t = emailTranslator(locale, brand?.name);
  const workspace = workspaceName ?? t("common.yourWorkspace");
  const body = coworkers.length
    ? t(`accountSignedOut.${kind}.body`, { coworkers: namesOf(coworkers, t, locale), count: coworkers.length, workspace })
    : t(`accountSignedOut.${kind}.bodyUnnamed`, { account, workspace });
  return (
    <AlertMessage
      hero={{ variant: "failed", closeUp: boardUrl }}
      heading={t(`accountSignedOut.${kind}.heading`, { account })}
      body={body}
      action={{ label: t(`accountSignedOut.${kind}.button`, { account }), href: reconnectUrl }}
      appUrl={appUrl}
      unsubscribeUrl={unsubscribeUrl}
      locale={locale}
      brand={brand}
    />
  );
}

AccountSignedOut.PreviewProps = {
  kind: "subscription",
  account: "Claude",
  coworkers: ["Lead Scout", "Blog Writer", "Inbox Triage", "Weekly Report"],
  workspaceName: "Acme",
  reconnectUrl: "https://app.rerun.build/?reconnect=preview",
  appUrl: "https://app.rerun.build",
} satisfies AccountSignedOutProps;
