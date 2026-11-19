import * as React from "react";
import { Heading, Section, Text } from "@react-email/components";
import { Layout } from "../components/Layout";
import { Button } from "../components/Button";
import { MetaTable } from "../components/MetaTable";
import { strong } from "../components/rich";
import { formatNumber } from "@moldwright/i18n/format";
import { emailTranslator, type EmailLocale } from "../i18n";
import { text } from "../theme";

export interface TrialSummary {
  agents: number;
  runs: number;
}

export type TrialEndedReason = "no_card" | "payment_failed";

export interface TrialEndedProps {
  reason: TrialEndedReason;
  workspaceName: string | null;
  trialEndedLabel: string;
  pausedLabel: string;
  keptUntilLabel: string;
  summary?: TrialSummary;
  billingUrl: string;
  boardUrl?: string;
  appUrl: string;
  unsubscribeUrl?: string;
  locale?: EmailLocale;
}

export default function TrialEnded({
  reason,
  workspaceName,
  trialEndedLabel,
  pausedLabel,
  keptUntilLabel,
  summary,
  billingUrl,
  boardUrl,
  appUrl,
  unsubscribeUrl,
  locale,
}: TrialEndedProps) {
  const t = emailTranslator(locale);
  const workspace = workspaceName ?? t("common.yourWorkspace");

  return (
    <Layout
      preview={t("trialEnded.preview", { reason, pausedAt: pausedLabel })}
      hero={{ scene: "trial-ended", board: boardUrl }}
      appUrl={appUrl}
      unsubscribeUrl={unsubscribeUrl}
      locale={locale}
    >
      <Heading style={text.heading}>{t("trialEnded.heading", { reason })}</Heading>
      <Text style={text.paragraph}>
        {t.rich("trialEnded.ended", { reason, workspace, date: trialEndedLabel, strong })}
      </Text>
      <Text style={text.paragraph}>
        {t.rich("trialEnded.paused", { reason, pausedAt: pausedLabel, keptUntil: keptUntilLabel, strong })}
      </Text>

      <Section style={meta}>
        <MetaTable
          rows={[
            { label: t("common.meta.trialEnded"), value: trialEndedLabel },
            { label: t("common.meta.workspacePaused"), value: pausedLabel },
            { label: t("common.meta.savedUntil"), value: keptUntilLabel },
            ...(summary
              ? [
                  { label: t("common.meta.coworkers"), value: formatNumber(summary.agents, locale) },
                  { label: t("common.meta.runs"), value: formatNumber(summary.runs, locale) },
                ]
              : []),
          ]}
        />
      </Section>

      <Section style={cta}>
        <Button href={billingUrl}>{t("trialEnded.button", { reason })}</Button>
      </Section>
      <Text style={text.footnote}>{t("trialEnded.footnote", { keptUntil: keptUntilLabel })}</Text>
    </Layout>
  );
}

TrialEnded.PreviewProps = {
  reason: "no_card",
  workspaceName: "Acme",
  trialEndedLabel: "12 March",
  pausedLabel: "12 March, 16:00 UTC",
  keptUntilLabel: "10 June",
  summary: { agents: 3, runs: 41 },
  billingUrl: "https://moldwright.robagentic.tech/?billing=1",
  appUrl: "https://moldwright.robagentic.tech",
} satisfies TrialEndedProps;

const meta: React.CSSProperties = {
  margin: "0 0 4px",
};

const cta: React.CSSProperties = {
  margin: "24px 0",
};
