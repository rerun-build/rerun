import * as React from "react";
import { Heading, Section, Text } from "@react-email/components";
import { Layout } from "../components/Layout";
import { Button } from "../components/Button";
import { MetaTable } from "../components/MetaTable";
import { strong } from "../components/rich";
import { emailTranslator, type EmailLocale } from "../i18n";
import { text } from "../theme";

export interface PaymentFailedProps {
  workspaceName: string | null;
  /** "$17.62", preformatted. Left out when the invoice carries no amount. */
  amountLabel?: string;
  /** "5 October", preformatted. */
  declinedLabel: string;
  /** When the workspace is paused if nothing is paid, "6 October, 06:10 UTC". Preformatted. */
  pausedLabel: string;
  /** Until when the paused workspace is saved, "3 January". Preformatted. */
  keptUntilLabel: string;
  /** The open invoice on Stripe's own page, where a 3-D Secure confirmation also happens. */
  billingUrl: string;
  /** A capture of the workspace's board, signed by the sender. Without it the usual banner shows. */
  boardUrl?: string;
  appUrl: string;
  unsubscribeUrl?: string;
  locale?: EmailLocale;
}

/**
 * A renewal that was declined leaves the workspace a day before it is paused, so this is the email
 * that says when the agents stop. The subscription is still there: paying the invoice keeps
 * everything on the same plan, which is why the button goes to the invoice and not to a new checkout.
 */
export default function PaymentFailed({
  workspaceName,
  amountLabel,
  declinedLabel,
  pausedLabel,
  keptUntilLabel,
  billingUrl,
  boardUrl,
  appUrl,
  unsubscribeUrl,
  locale,
}: PaymentFailedProps) {
  const t = emailTranslator(locale);
  const workspace = workspaceName ?? t("common.yourWorkspace");

  return (
    <Layout
      preview={t("paymentFailed.preview", { pausedAt: pausedLabel })}
      hero={{ scene: "trial-ended", board: boardUrl }}
      appUrl={appUrl}
      unsubscribeUrl={unsubscribeUrl}
      locale={locale}
    >
      <Heading style={text.heading}>{t("paymentFailed.heading")}</Heading>
      <Text style={text.paragraph}>
        {amountLabel
          ? t.rich("paymentFailed.declinedWithAmount", { workspace, amount: amountLabel, date: declinedLabel, strong })
          : t.rich("paymentFailed.declined", { workspace, date: declinedLabel, strong })}
      </Text>
      <Text style={text.paragraph}>
        {t.rich("paymentFailed.consequences", { pausedAt: pausedLabel, keptUntil: keptUntilLabel, strong })}
      </Text>

      <Section style={meta}>
        <MetaTable
          rows={[
            { label: t("common.meta.workspace"), value: workspace },
            ...(amountLabel ? [{ label: t("common.meta.amountDue"), value: amountLabel }] : []),
            { label: t("common.meta.declinedOn"), value: declinedLabel },
            { label: t("common.meta.workspacePaused"), value: pausedLabel },
            { label: t("common.meta.savedUntil"), value: keptUntilLabel },
          ]}
        />
      </Section>

      <Section style={cta}>
        <Button href={billingUrl}>{t("paymentFailed.button")}</Button>
      </Section>
      <Text style={text.footnote}>{t("paymentFailed.footnote")}</Text>
    </Layout>
  );
}

PaymentFailed.PreviewProps = {
  workspaceName: "Acme",
  amountLabel: "$49.00",
  declinedLabel: "12 March",
  pausedLabel: "13 March, 16:00 UTC",
  keptUntilLabel: "10 June",
  billingUrl: "https://app.rerun.build/?billing=1",
  appUrl: "https://app.rerun.build",
} satisfies PaymentFailedProps;

const meta: React.CSSProperties = {
  margin: "0 0 4px",
};

const cta: React.CSSProperties = {
  margin: "24px 0",
};
