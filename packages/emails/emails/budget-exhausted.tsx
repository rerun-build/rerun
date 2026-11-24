import * as React from "react";
import type { Brand } from "@rerun/contracts";
import { AlertMessage } from "../components/AlertMessage";
import { emailTranslator, type EmailLocale } from "../i18n";

export interface BudgetExhaustedProps {
  /** When the credit of the month comes back, "1 December", preformatted. Left out when none does. */
  resetLabel?: string;
  creditsUrl: string;
  /** The close-up of the team asleep around its credit, signed by the sender. Without it the usual banner shows. */
  boardUrl?: string;
  appUrl: string;
  unsubscribeUrl?: string;
  locale?: EmailLocale;
  brand?: Brand;
}

export default function BudgetExhausted({ resetLabel, creditsUrl, boardUrl, appUrl, unsubscribeUrl, locale, brand }: BudgetExhaustedProps) {
  const t = emailTranslator(locale, brand?.name);
  return (
    <AlertMessage
      hero={{ scene: "budget-exhausted", closeUp: boardUrl }}
      heading={t("budgetExhausted.heading")}
      body={resetLabel ? t("budgetExhausted.body", { date: resetLabel }) : t("budgetExhausted.bodyNoReset")}
      action={{ label: t("budgetExhausted.button"), href: creditsUrl }}
      appUrl={appUrl}
      unsubscribeUrl={unsubscribeUrl}
      locale={locale}
      brand={brand}
    />
  );
}

BudgetExhausted.PreviewProps = {
  resetLabel: "1 December",
  creditsUrl: "https://app.rerun.build/?billing=1",
  appUrl: "https://app.rerun.build",
} satisfies BudgetExhaustedProps;
