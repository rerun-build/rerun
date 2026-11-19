import * as React from "react";
import { Heading, Section, Text } from "@react-email/components";
import { Layout } from "../components/Layout";
import { Button } from "../components/Button";
import { MetaTable } from "../components/MetaTable";
import { strong } from "../components/rich";
import { emailTranslator, type EmailLocale } from "../i18n";
import { text } from "../theme";

export interface SubscriptionEndingProps {
  workspaceName: string | null;
  endsLabel: string;
  daysLeft: number;
  keptUntilLabel: string;
  billingUrl: string;
  boardUrl?: string;
  appUrl: string;
  unsubscribeUrl?: string;
  locale?: EmailLocale;
}

export default function SubscriptionEnding({
  workspaceName,
  endsLabel,
  daysLeft,
  keptUntilLabel,
  billingUrl,
  boardUrl,
  appUrl,
  unsubscribeUrl,
  locale,
}: SubscriptionEndingProps) {
  const t = emailTranslator(locale);
  const workspace = workspaceName ?? t("common.yourWorkspace");

  return (
    <Layout
      preview={t("subscriptionEnding.preview", { date: endsLabel })}
      hero={{ scene: "subscription-ending", board: boardUrl }}
      appUrl={appUrl}
      unsubscribeUrl={unsubscribeUrl}
      locale={locale}
    >
      <Heading style={text.heading}>
        {t("subscriptionEnding.heading", { daysLeft: Math.max(daysLeft, 1) })}
      </Heading>
      <Text style={text.paragraph}>
        {t.rich("subscriptionEnding.cancelled", { workspace, date: endsLabel, strong })}
      </Text>
      <Text style={text.paragraph}>
        {t.rich("subscriptionEnding.nothingDeleted", { keptUntil: keptUntilLabel, strong })}
      </Text>

      <Section style={meta}>
        <MetaTable
          rows={[
            { label: t("common.meta.workspace"), value: workspace },
            { label: t("common.meta.accessEnds"), value: endsLabel },
            { label: t("common.meta.savedUntil"), value: keptUntilLabel },
          ]}
        />
      </Section>

      <Section style={cta}>
        <Button href={billingUrl}>{t("subscriptionEnding.button")}</Button>
      </Section>
      <Text style={text.footnote}>{t("subscriptionEnding.footnote", { date: endsLabel })}</Text>
    </Layout>
  );
}

SubscriptionEnding.PreviewProps = {
  workspaceName: "Acme",
  endsLabel: "12 March",
  daysLeft: 7,
  keptUntilLabel: "10 June",
  billingUrl: "https://moldwright.robagentic.tech/?billing=1",
  appUrl: "https://moldwright.robagentic.tech",
} satisfies SubscriptionEndingProps;

const meta: React.CSSProperties = {
  margin: "0 0 4px",
};

const cta: React.CSSProperties = {
  margin: "24px 0",
};
