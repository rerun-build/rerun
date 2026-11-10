import * as React from "react";
import { Heading, Section, Text } from "@react-email/components";
import { Layout } from "../components/Layout";
import { Button } from "../components/Button";
import { strong } from "../components/rich";
import { emailTranslator, type EmailLocale } from "../i18n";
import { text } from "../theme";

export interface TeamInviteProps {
  workspaceName: string;
  agentName: string;
  inviteUrl: string;
  /** A capture of the workspace's board, signed by the sender. Without it the usual banner shows. */
  boardUrl?: string;
  appUrl: string;
  unsubscribeUrl?: string;
  locale?: EmailLocale;
}

export default function TeamInvite({
  workspaceName,
  agentName,
  inviteUrl,
  boardUrl,
  appUrl,
  unsubscribeUrl,
  locale,
}: TeamInviteProps) {
  const t = emailTranslator(locale);
  return (
    <Layout
      preview={t("teamInvite.preview", { workspaceName })}
      hero={{ scene: "team-invite", board: boardUrl }}
      appUrl={appUrl}
      unsubscribeUrl={unsubscribeUrl}
      locale={locale}
    >
      <Heading style={text.heading}>{t("teamInvite.heading", { workspaceName })}</Heading>
      <Text style={text.paragraph}>{t.rich("teamInvite.firstRun", { agentName, strong })}</Text>
      <Text style={text.paragraph}>{t("teamInvite.access")}</Text>
      <Section style={cta}>
        <Button href={inviteUrl}>{t("teamInvite.button")}</Button>
      </Section>
      <Text style={text.footnote}>{t("teamInvite.footnote")}</Text>
    </Layout>
  );
}

TeamInvite.PreviewProps = {
  workspaceName: "Acme",
  agentName: "Atlas",
  inviteUrl: "https://app.rerun.build/?members=1",
  appUrl: "https://app.rerun.build",
  unsubscribeUrl: "https://app.rerun.build/unsubscribe",
} satisfies TeamInviteProps;

const cta: React.CSSProperties = {
  margin: "24px 0",
};
