import * as React from "react";
import { Heading, Section, Text } from "@react-email/components";
import { Layout } from "../components/Layout";
import { Button } from "../components/Button";
import { MetaTable } from "../components/MetaTable";
import { strong } from "../components/rich";
import { emailTranslator, type EmailLocale } from "../i18n";
import { text } from "../theme";

export interface TrialEndingProps {
  workspaceName: string | null;
  /** "12 March", preformatted. */
  trialEndsLabel: string;
  daysLeft: number;
  /** Until when the workspace is saved once paused, "11 June". Preformatted. */
  keptUntilLabel: string;
  billingUrl: string;
  /** A capture of the workspace's board, signed by the sender. Without it the usual banner shows. */
  boardUrl?: string;
  appUrl: string;
  unsubscribeUrl?: string;
  locale?: EmailLocale;
}

/**
 * Has to read true for both kinds of trial: the one every account starts at signup without a card,
 * and the one that came out of Checkout with a card. Nothing in the database says which, so the
 * copy states the condition instead of asserting the state.
 */
export default function TrialEnding({
  workspaceName,
  trialEndsLabel,
  daysLeft,
  keptUntilLabel,
  billingUrl,
  boardUrl,
  appUrl,
  unsubscribeUrl,
  locale,
}: TrialEndingProps) {
  const t = emailTranslator(locale);
  const workspace = workspaceName ?? t("common.yourWorkspace");

  return (
    <Layout
      preview={t("trialEnding.preview", { date: trialEndsLabel })}
      hero={{ scene: "trial-ending", board: boardUrl }}
      appUrl={appUrl}
      unsubscribeUrl={unsubscribeUrl}
      locale={locale}
    >
      <Heading style={text.heading}>{t("trialEnding.heading", { daysLeft })}</Heading>
      <Text style={text.paragraph}>
        {t.rich("trialEnding.endsOn", { workspace, date: trialEndsLabel, strong })}
      </Text>
      <Text style={text.paragraph}>
        {t("trialEnding.nothingDeleted", { keptUntil: keptUntilLabel })}
      </Text>

      <Section style={meta}>
        <MetaTable
          rows={[
            { label: t("common.meta.workspace"), value: workspace },
            { label: t("common.meta.trialEnds"), value: trialEndsLabel },
          ]}
        />
      </Section>

      <Section style={cta}>
        <Button href={billingUrl}>{t("trialEnding.button")}</Button>
      </Section>
      <Text style={text.footnote}>{t("trialEnding.footnote", { date: trialEndsLabel })}</Text>
    </Layout>
  );
}

TrialEnding.PreviewProps = {
  workspaceName: "Acme",
  trialEndsLabel: "12 March",
  daysLeft: 1,
  keptUntilLabel: "10 June",
  billingUrl: "https://app.rerun.build/?billing=1",
  appUrl: "https://app.rerun.build",
} satisfies TrialEndingProps;

const meta: React.CSSProperties = {
  margin: "0 0 4px",
};

const cta: React.CSSProperties = {
  margin: "24px 0",
};
