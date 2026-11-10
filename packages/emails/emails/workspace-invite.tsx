import * as React from "react";
import { Heading, Section, Text } from "@react-email/components";
import { Layout } from "../components/Layout";
import { Button } from "../components/Button";
import { strong } from "../components/rich";
import { emailTranslator, type EmailLocale } from "../i18n";
import { text } from "../theme";

export interface WorkspaceInviteProps {
  workspaceName: string;
  inviteUrl: string;
  invitedByEmail?: string;
  /** A capture of the workspace's board, signed by the sender. Without it the usual banner shows. */
  boardUrl?: string;
  appUrl: string;
  locale?: EmailLocale;
}

export default function WorkspaceInvite({
  workspaceName,
  inviteUrl,
  invitedByEmail,
  boardUrl,
  appUrl,
  locale,
}: WorkspaceInviteProps) {
  const t = emailTranslator(locale);
  return (
    <Layout
      preview={t("workspaceInvite.preview", { workspaceName })}
      hero={{ scene: "workspace-invite", board: boardUrl }}
      appUrl={appUrl}
      locale={locale}
    >
      <Heading style={text.heading}>{t("workspaceInvite.heading")}</Heading>
      <Text style={text.paragraph}>
        {invitedByEmail
          ? t.rich("workspaceInvite.bodyWithInviter", { inviter: invitedByEmail, workspaceName, strong })
          : t.rich("workspaceInvite.bodyAnonymous", { workspaceName, strong })}
      </Text>
      <Text style={text.paragraph}>{t("workspaceInvite.pitch")}</Text>
      <Section style={cta}>
        <Button href={inviteUrl}>{t("workspaceInvite.button", { workspaceName })}</Button>
      </Section>
      <Text style={text.footnote}>{t("workspaceInvite.footnote")}</Text>
    </Layout>
  );
}

WorkspaceInvite.PreviewProps = {
  workspaceName: "Acme Inc.",
  inviteUrl: "https://app.rerun.build/invite/abc123",
  invitedByEmail: "ada@acme.com",
  appUrl: "https://app.rerun.build",
} satisfies WorkspaceInviteProps;

const cta: React.CSSProperties = {
  margin: "24px 0",
};
