import * as React from "react";
import { Heading, Section, Text } from "@react-email/components";
import { Layout } from "../components/Layout";
import { Button } from "../components/Button";
import { MetaTable } from "../components/MetaTable";
import { Panel } from "../components/Panel";
import { strong } from "../components/rich";
import { emailTranslator, type EmailLocale } from "../i18n";
import { theme, text } from "../theme";

export interface RunFailedProps {
  agentName: string;
  runId: string;
  errorMessage: string;
  reason?: string;
  boardUrl?: string;
  appUrl: string;
  conversationUrl?: string;
  unsubscribeUrl?: string;
  locale?: EmailLocale;
}

export default function RunFailed({
  agentName,
  runId,
  errorMessage,
  reason,
  boardUrl,
  appUrl,
  conversationUrl,
  unsubscribeUrl,
  locale,
}: RunFailedProps) {
  const t = emailTranslator(locale);
  return (
    <Layout
      preview={t("runFailed.preview", { agentName })}
      hero={{ variant: "failed", board: boardUrl }}
      appUrl={appUrl}
      unsubscribeUrl={unsubscribeUrl}
      locale={locale}
    >
      <Heading style={text.heading}>{t("runFailed.heading")}</Heading>
      <Text style={text.paragraph}>{t.rich("runFailed.body", { agentName, strong })}</Text>
      {reason ? <Text style={reasonLine}>{reason}</Text> : null}
      <Panel tone="error" mono>
        {errorMessage}
      </Panel>
      <Section style={meta}>
        <MetaTable
          rows={[
            { label: t("common.meta.coworker"), value: agentName },
            ...(runId ? [{ label: t("common.meta.run"), value: runId }] : []),
          ]}
        />
      </Section>
      <Section style={cta}>
        <Button href={conversationUrl ?? appUrl}>
          {conversationUrl ? t("common.openConversation") : t("common.openRerun")}
        </Button>
      </Section>
    </Layout>
  );
}

RunFailed.PreviewProps = {
  agentName: "Atlas",
  runId: "run_4f2a9c",
  errorMessage: "Tool call timed out after 900s while waiting for the engine.",
  reason: "You follow Atlas's scheduled tasks.",
  appUrl: "https://app.rerun.build",
  conversationUrl: "https://app.rerun.build/?notification=preview",
} satisfies RunFailedProps;

const reasonLine: React.CSSProperties = {
  ...text.footnote,
  color: theme.text.muted,
  margin: "0 0 16px",
};

const meta: React.CSSProperties = {
  margin: "16px 0 0",
};

const cta: React.CSSProperties = {
  margin: "24px 0 0",
};
