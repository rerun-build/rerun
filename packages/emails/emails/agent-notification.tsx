import * as React from "react";
import { CoworkerMessage, type CoworkerMessageProps } from "../components/CoworkerMessage";
import { emailTranslator, type EmailTranslator } from "../i18n";

// What a coworker waits on someone for. A run that broke has its own RunFailed template.
export type AgentNotificationKind = "question" | "approval" | "connector";

export interface AgentNotificationProps extends CoworkerMessageProps {
  agentName: string;
  kind: AgentNotificationKind;
  /** The app a `connector` waits for, as people call it. */
  app?: string;
  /** The coworker waits for something the hub has no shorter word for: the button only opens the conversation. */
  opensConversation?: boolean;
}

export function agentNotificationTitle({ kind, agentName, app }: Pick<AgentNotificationProps, "kind" | "agentName" | "app">, t: EmailTranslator): string {
  if (kind !== "connector") return t(`agentNotification.${kind}.heading`, { agentName });
  return app ? t("agentNotification.connector.heading", { agentName, app }) : t("agentNotification.connector.headingUnnamed", { agentName });
}

function actionLabel({ kind, app, opensConversation }: AgentNotificationProps, t: EmailTranslator): string {
  if (opensConversation) return t("common.openConversation");
  if (kind !== "connector") return t(`agentNotification.${kind}.button`);
  return app ? t("agentNotification.connector.button", { app }) : t("common.openConversation");
}

export default function AgentNotification(props: AgentNotificationProps) {
  const t = emailTranslator(props.locale);
  return <CoworkerMessage {...props} variant={props.kind} heading={agentNotificationTitle(props, t)} action={actionLabel(props, t)} />;
}

AgentNotification.PreviewProps = {
  agentName: "Atlas",
  kind: "question",
  message: "I found two candidate database schemas. Which one should I use for the migration?",
  reason: "You started this run.",
  appUrl: "https://app.rerun.build",
  conversationUrl: "https://app.rerun.build/?notification=preview",
} satisfies AgentNotificationProps;
