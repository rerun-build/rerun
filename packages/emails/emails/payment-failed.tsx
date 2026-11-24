import * as React from "react";
import type { Brand } from "@rerun/contracts";
import { AlertMessage } from "../components/AlertMessage";
import { emailTranslator, type EmailLocale } from "../i18n";

export interface PaymentFailedProps {
  workspaceName: string | null;
  /** "$17.62", preformatted. Left out when the invoice carries no amount. */
  amountLabel?: string;
  /** When the workspace is paused if nothing is paid, "6 October, 06:10 UTC". Preformatted. */
  pausedLabel: string;
  /** The first invoice of the plan rather than a renewal. */
  firstCharge?: boolean;
  /** The open invoice on Stripe's own page, where a 3-D Secure confirmation also happens. */
  billingUrl: string;
  /** The close-up of the team locked around its card, signed by the sender. Without it the usual banner shows. */
  boardUrl?: string;
  appUrl: string;
  unsubscribeUrl?: string;
  locale?: EmailLocale;
  brand?: Brand;
}

/**
 * A charge that was declined leaves the workspace a day before it is paused, so this is the email
 * that says when the coworkers stop. The subscription is still there: paying the invoice keeps
 * everything on the same plan, which is why the button goes to the invoice and not to a new checkout.
 */
export default function PaymentFailed({ workspaceName, amountLabel, pausedLabel, firstCharge = false, billingUrl, boardUrl, appUrl, unsubscribeUrl, locale, brand }: PaymentFailedProps) {
  const t = emailTranslator(locale, brand?.name);
  const workspace = workspaceName ?? t("common.yourWorkspace");
  const charge = firstCharge ? "first" : "renewal";
  return (
    <AlertMessage
      hero={{ scene: "trial-ended", closeUp: boardUrl }}
      heading={t("paymentFailed.heading")}
      body={amountLabel ? t(`paymentFailed.${charge}.bodyWithAmount`, { workspace, amount: amountLabel, pausedAt: pausedLabel }) : t(`paymentFailed.${charge}.body`, { workspace, pausedAt: pausedLabel })}
      action={{ label: t("paymentFailed.button"), href: billingUrl }}
      appUrl={appUrl}
      unsubscribeUrl={unsubscribeUrl}
      locale={locale}
      brand={brand}
    />
  );
}

PaymentFailed.PreviewProps = {
  workspaceName: "Acme",
  amountLabel: "$29.00",
  pausedLabel: "25 November, 16:00 UTC",
  billingUrl: "https://app.rerun.build/?billing=1",
  appUrl: "https://app.rerun.build",
} satisfies PaymentFailedProps;
