import * as React from "react";
import { Heading, Section, Text } from "@react-email/components";
import { Layout } from "../components/Layout";
import { Button } from "../components/Button";
import { Panel } from "../components/Panel";
import { strong } from "../components/rich";
import { emailTranslator, type EmailLocale } from "../i18n";
import { theme, text, type ToneName } from "../theme";

// All emailable kinds except `error`, which has its own RunFailed template.
export type AgentNotificationKind =
  | "done"
  | "info"
  | "question"
  | "approval"
  | "connector";

export interface AgentNotificationProps {
  agentName: string;
  kind: AgentNotificationKind;
  message: string;
  /** Why this recipient gets the email, e.g. "You started this conversation." */
  reason?: string;
  /** A capture of the workspace's board, signed by the sender. Without it the usual banner shows. */
  boardUrl?: string;
  appUrl: string;
  /** Opens the conversation the email is about. Without it the button opens the board. */
  conversationUrl?: string;
  unsubscribeUrl?: string;
  locale?: EmailLocale;
}

const TONES_BY_KIND: Record<AgentNotificationKind, ToneName> = {
  done: "done",
  info: "info",
  question: "question",
  approval: "approval",
  connector: "connector",
};

export default function AgentNotification({
  agentName,
  kind,
  message,
  reason,
  boardUrl,
  appUrl,
  conversationUrl,
  unsubscribeUrl,
  locale,
}: AgentNotificationProps) {
  const t = emailTranslator(locale);
  return (
    <Layout
      preview={t(`agentNotification.${kind}.preview`, { agentName })}
      hero={{ variant: kind, board: boardUrl }}
      appUrl={appUrl}
      unsubscribeUrl={unsubscribeUrl}
      locale={locale}
    >
      <Heading style={text.heading}>{t(`agentNotification.${kind}.heading`)}</Heading>
      <Text style={text.paragraph}>
        {t.rich(`agentNotification.${kind}.body`, { agentName, strong })}
      </Text>
      {reason ? <Text style={reasonLine}>{reason}</Text> : null}
      <Panel tone={TONES_BY_KIND[kind]}>{message}</Panel>
      <Section style={cta}>
        <Button href={conversationUrl ?? appUrl}>
          {conversationUrl ? t("common.openConversation") : t("common.openRerun")}
        </Button>
      </Section>
    </Layout>
  );
}

AgentNotification.PreviewProps = {
  agentName: "Atlas",
  kind: "question",
  message:
    "I found two candidate database schemas. Which one should I use for the migration?",
  reason: "You started this conversation.",
  appUrl: "https://app.rerun.build",
  conversationUrl: "https://app.rerun.build/?notification=preview",
} satisfies AgentNotificationProps;

const reasonLine: React.CSSProperties = {
  ...text.footnote,
  color: theme.text.muted,
  margin: "0 0 16px",
};

const cta: React.CSSProperties = {
  margin: "24px 0 0",
};
