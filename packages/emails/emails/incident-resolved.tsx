import * as React from "react";
import { Heading, Section, Text } from "@react-email/components";
import { Layout } from "../components/Layout";
import { Button } from "../components/Button";
import { MetaTable } from "../components/MetaTable";
import { strong } from "../components/rich";
import { emailTranslator, type EmailLocale } from "../i18n";
import { theme, text } from "../theme";

export interface IncidentResolvedProps {
  agentName: string;
  /** The source that recovered, e.g. `Schedule "weekly-export"`. */
  sourceLabel: string;
  /** Why this recipient gets the email, e.g. "You follow Atlas's scheduled tasks." */
  reason?: string;
  /** A capture of the workspace's board, signed by the sender. Without it the usual banner shows. */
  boardUrl?: string;
  appUrl: string;
  /** Opens the conversation of the run that worked. Without it the button opens the board. */
  conversationUrl?: string;
  unsubscribeUrl?: string;
  locale?: EmailLocale;
}

export default function IncidentResolved({
  agentName,
  sourceLabel,
  reason,
  boardUrl,
  appUrl,
  conversationUrl,
  unsubscribeUrl,
  locale,
}: IncidentResolvedProps) {
  const t = emailTranslator(locale);
  return (
    <Layout
      preview={t("incidentResolved.preview", { source: sourceLabel, agentName })}
      hero={{ variant: "done", board: boardUrl }}
      appUrl={appUrl}
      unsubscribeUrl={unsubscribeUrl}
      locale={locale}
    >
      <Heading style={text.heading}>{t("incidentResolved.heading")}</Heading>
      <Text style={text.paragraph}>
        {t.rich("incidentResolved.body", { source: sourceLabel, agentName, strong })}
      </Text>
      {reason ? <Text style={reasonLine}>{reason}</Text> : null}
      <Section style={meta}>
        <MetaTable
          rows={[
            { label: t("common.meta.coworker"), value: agentName },
            { label: t("common.meta.source"), value: sourceLabel },
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

IncidentResolved.PreviewProps = {
  agentName: "Atlas",
  sourceLabel: 'Schedule "weekly-export"',
  reason: "You follow Atlas's scheduled tasks.",
  appUrl: "https://app.rerun.build",
  conversationUrl: "https://app.rerun.build/?notification=preview",
} satisfies IncidentResolvedProps;

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
