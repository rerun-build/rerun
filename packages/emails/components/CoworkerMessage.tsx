import * as React from "react";
import { Heading, Section, Text } from "@react-email/components";
import { Bubble } from "./Bubble";
import { Button } from "./Button";
import { Layout } from "./Layout";
import type { HeroVariant } from "../assets";
import { emailTranslator, type EmailLocale } from "../i18n";
import { text } from "../theme";

export interface CoworkerMessageProps {
  /** What the coworker says: the bubble, and the line an inbox shows under the subject. */
  message: string;
  /** Why this recipient gets the email, e.g. "You started this run." */
  reason?: string;
  portraitUrl?: string;
  /** The close-up of the coworker on its board, signed by the sender. Without it the usual banner shows. */
  boardUrl?: string;
  appUrl: string;
  /** Opens the conversation the email is about. Without it the button opens the board. */
  conversationUrl?: string;
  unsubscribeUrl?: string;
  locale?: EmailLocale;
}

/** One coworker, what it says, and the one thing to do about it. */
export function CoworkerMessage({
  variant,
  heading,
  action,
  message,
  reason,
  portraitUrl,
  boardUrl,
  appUrl,
  conversationUrl,
  unsubscribeUrl,
  locale,
}: CoworkerMessageProps & { variant: HeroVariant; heading: string; action: string }) {
  const t = emailTranslator(locale);
  return (
    <Layout preview={message} hero={{ variant, closeUp: boardUrl }} appUrl={appUrl} unsubscribeUrl={unsubscribeUrl} locale={locale}>
      <Heading style={{ ...text.heading, margin: "0 0 20px" }}>{heading}</Heading>
      <Bubble portraitUrl={portraitUrl} locale={locale}>
        {message}
      </Bubble>
      <Section style={{ margin: "24px 0 0" }}>
        <Button href={conversationUrl ?? appUrl}>{conversationUrl ? action : t("common.openRerun")}</Button>
      </Section>
      {reason ? <Text style={{ ...text.footnote, margin: "16px 0 0" }}>{reason}</Text> : null}
    </Layout>
  );
}
