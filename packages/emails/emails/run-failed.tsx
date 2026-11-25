import * as React from "react";
import { CoworkerMessage, type CoworkerMessageProps } from "../components/CoworkerMessage";
import { emailTranslator } from "../i18n";

export interface RunFailedProps extends CoworkerMessageProps {
  agentName: string;
}

export default function RunFailed(props: RunFailedProps) {
  const t = emailTranslator(props.locale);
  return <CoworkerMessage {...props} variant="failed" heading={t("runFailed.heading", { agentName: props.agentName })} action={t("runFailed.button")} />;
}

RunFailed.PreviewProps = {
  agentName: "Atlas",
  message: "The Google Sheets token expired.",
  reason: "You follow Atlas's scheduled tasks.",
  appUrl: "https://app.rerun.build",
  conversationUrl: "https://app.rerun.build/?notification=preview",
} satisfies RunFailedProps;
