import * as React from "react";
import { Heading, Section, Text } from "@react-email/components";
import { Layout } from "../components/Layout";
import { Button } from "../components/Button";
import { Panel } from "../components/Panel";
import { strong } from "../components/rich";
import { emailTranslator, type EmailLocale } from "../i18n";
import { text } from "../theme";

export interface AutomateAgentProps {
  agentName: string;
  manualRuns: number;
  /** "the last two weeks", preformatted. */
  periodLabel: string;
  /** The last thing the agent reported. No panel without it. */
  lastResult?: string;
  scheduleUrl: string;
  /** A capture of the workspace's board, signed by the sender. Without it the usual banner shows. */
  boardUrl?: string;
  appUrl: string;
  unsubscribeUrl?: string;
  locale?: EmailLocale;
}

export default function AutomateAgent({
  agentName,
  manualRuns,
  periodLabel,
  lastResult,
  scheduleUrl,
  boardUrl,
  appUrl,
  unsubscribeUrl,
  locale,
}: AutomateAgentProps) {
  const t = emailTranslator(locale);
  return (
    <Layout
      preview={t("automateAgent.preview", { agentName, manualRuns })}
      hero={{ scene: "automate-agent", board: boardUrl }}
      appUrl={appUrl}
      unsubscribeUrl={unsubscribeUrl}
      locale={locale}
    >
      <Heading style={text.heading}>{t("automateAgent.heading", { agentName })}</Heading>
      <Text style={text.paragraph}>
        {t.rich("automateAgent.body", { agentName, manualRuns, period: periodLabel, strong })}
      </Text>

      {lastResult ? <Panel>{lastResult}</Panel> : null}

      <Text style={{ ...text.paragraph, margin: lastResult ? "16px 0" : "0 0 16px" }}>
        {t("automateAgent.workflowWorks")}
      </Text>

      <Section style={cta}>
        <Button href={scheduleUrl}>{t("automateAgent.button")}</Button>
      </Section>
      <Text style={text.footnote}>{t("automateAgent.footnote")}</Text>
    </Layout>
  );
}

AutomateAgent.PreviewProps = {
  agentName: "Atlas",
  manualRuns: 4,
  periodLabel: "the last two weeks",
  lastResult:
    "Checked 84 invoices against the Stripe payouts, 2 did not match and are listed in the Notion page.",
  scheduleUrl: "https://app.rerun.build/?agent=8f2b",
  appUrl: "https://app.rerun.build",
  unsubscribeUrl: "https://app.rerun.build/unsubscribe",
} satisfies AutomateAgentProps;

const cta: React.CSSProperties = {
  margin: "24px 0",
};
