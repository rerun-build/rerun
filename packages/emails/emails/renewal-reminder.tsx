import * as React from "react";
import { Heading, Section, Text } from "@react-email/components";
import { Layout } from "../components/Layout";
import { Button } from "../components/Button";
import { MetaTable } from "../components/MetaTable";
import { strong } from "../components/rich";
import { emailTranslator, type EmailLocale } from "../i18n";
import { text } from "../theme";

export interface RenewalReminderProps {
  workspaceName: string | null;
  /** "29 October", preformatted. */
  renewsLabel: string;
  daysLeft: number;
  /** "$49.00", preformatted. Left out when Stripe could not quote the invoice. */
  amountLabel?: string;
  billingUrl: string;
  /** A capture of the workspace's board, signed by the sender. Without it the usual banner shows. */
  boardUrl?: string;
  appUrl: string;
  unsubscribeUrl?: string;
  locale?: EmailLocale;
}

/**
 * The reminder a paying customer asked for from the cancel flow instead of cancelling on the spot.
 * It keeps the promise made there and nothing more: the date, the amount, and how to cancel before
 * the card is charged.
 */
export default function RenewalReminder({
  workspaceName,
  renewsLabel,
  daysLeft,
  amountLabel,
  billingUrl,
  boardUrl,
  appUrl,
  unsubscribeUrl,
  locale,
}: RenewalReminderProps) {
  const t = emailTranslator(locale);
  const workspace = workspaceName ?? t("common.yourWorkspace");

  return (
    <Layout
      preview={t("renewalReminder.preview", { date: renewsLabel })}
      hero={{ scene: "trial-ending", board: boardUrl }}
      appUrl={appUrl}
      unsubscribeUrl={unsubscribeUrl}
      locale={locale}
    >
      <Heading style={text.heading}>{t("renewalReminder.heading", { daysLeft })}</Heading>
      <Text style={text.paragraph}>
        {t.rich("renewalReminder.body", { workspace, date: renewsLabel, strong })}
      </Text>

      <Section style={meta}>
        <MetaTable
          rows={[
            { label: t("common.meta.workspace"), value: workspace },
            { label: t("common.meta.renewsOn"), value: renewsLabel },
            ...(amountLabel ? [{ label: t("common.meta.amount"), value: amountLabel }] : []),
          ]}
        />
      </Section>

      <Section style={cta}>
        <Button href={billingUrl}>{t("renewalReminder.button")}</Button>
      </Section>
      <Text style={text.footnote}>{t("renewalReminder.footnote", { date: renewsLabel })}</Text>
    </Layout>
  );
}

RenewalReminder.PreviewProps = {
  workspaceName: "Acme",
  renewsLabel: "29 October",
  daysLeft: 7,
  amountLabel: "$49.00",
  billingUrl: "https://app.rerun.build/?billing=1",
  appUrl: "https://app.rerun.build",
} satisfies RenewalReminderProps;

const meta: React.CSSProperties = {
  margin: "0 0 4px",
};

const cta: React.CSSProperties = {
  margin: "24px 0",
};
