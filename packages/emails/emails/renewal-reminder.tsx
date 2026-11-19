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
  renewsLabel: string;
  daysLeft: number;
  amountLabel?: string;
  billingUrl: string;
  boardUrl?: string;
  appUrl: string;
  unsubscribeUrl?: string;
  locale?: EmailLocale;
}

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
  billingUrl: "https://moldwright.robagentic.tech/?billing=1",
  appUrl: "https://moldwright.robagentic.tech",
} satisfies RenewalReminderProps;

const meta: React.CSSProperties = {
  margin: "0 0 4px",
};

const cta: React.CSSProperties = {
  margin: "24px 0",
};
