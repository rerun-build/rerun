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
  /** "12 March", preformatted. */
  endsLabel: string;
  daysLeft: number;
  /** Until when the paused workspace is saved, "10 June". Preformatted. */
  keptUntilLabel: string;
  billingUrl: string;
  /** A capture of the workspace's board, signed by the sender. Without it the usual banner shows. */
  boardUrl?: string;
  appUrl: string;
  unsubscribeUrl?: string;
  locale?: EmailLocale;
}

/**
 * One component for the whole countdown. Only the heading and the preview change with `daysLeft`:
 * the fact being reported is the same one three times, and rewriting it each time is how three
 * reminders end up contradicting each other.
 *
 * It says the workspace is paused rather than deleted, because that is exactly what happens: its
 * machine is archived and the archive kept until `keptUntilLabel`, which a new subscription restores.
 */
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
  billingUrl: "https://app.rerun.build/?billing=1",
  appUrl: "https://app.rerun.build",
} satisfies SubscriptionEndingProps;

const meta: React.CSSProperties = {
  margin: "0 0 4px",
};

const cta: React.CSSProperties = {
  margin: "24px 0",
};
