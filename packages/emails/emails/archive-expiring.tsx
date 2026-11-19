import * as React from "react";
import { Heading, Section, Text } from "@react-email/components";
import { Layout } from "../components/Layout";
import { Button } from "../components/Button";
import { MetaTable } from "../components/MetaTable";
import { strong } from "../components/rich";
import { formatNumber } from "@moldwright/i18n/format";
import { emailTranslator, type EmailLocale } from "../i18n";
import { text } from "../theme";

export interface ArchiveExpiringProps {
  workspaceName: string | null;
  pausedLabel: string;
  deletionLabel: string;
  agentCount: number;
  billingUrl: string;
  sandbox?: boolean;
  boardUrl?: string;
  appUrl: string;
  unsubscribeUrl?: string;
  locale?: EmailLocale;
}

export default function ArchiveExpiring({
  workspaceName,
  pausedLabel,
  deletionLabel,
  agentCount,
  billingUrl,
  sandbox = false,
  boardUrl,
  appUrl,
  unsubscribeUrl,
  locale,
}: ArchiveExpiringProps) {
  const t = emailTranslator(locale);
  const kind = sandbox ? "sandbox" : "workspace";
  const workspace = workspaceName ?? t("common.yourWorkspace");

  return (
    <Layout
      preview={t("archiveExpiring.preview", { kind, date: deletionLabel })}
      hero={{ scene: "trial-ended", board: boardUrl }}
      appUrl={appUrl}
      unsubscribeUrl={unsubscribeUrl}
      locale={locale}
    >
      <Heading style={text.heading}>
        {t("archiveExpiring.heading", { kind, date: deletionLabel })}
      </Heading>
      <Text style={text.paragraph}>
        {workspaceName
          ? t.rich("archiveExpiring.statusNamed", { kind, workspaceName, pausedOn: pausedLabel, strong })
          : t.rich("archiveExpiring.statusUnnamed", { kind, pausedOn: pausedLabel, strong })}
      </Text>
      <Text style={text.paragraph}>
        {t.rich("archiveExpiring.deletion", { kind, date: deletionLabel, strong })}
      </Text>

      <Section style={meta}>
        <MetaTable
          rows={[
            { label: t("common.meta.workspace"), value: workspace },
            { label: sandbox ? t("common.meta.archivedSince") : t("common.meta.pausedSince"), value: pausedLabel },
            ...(agentCount > 0
              ? [{ label: t("common.meta.coworkersSaved"), value: formatNumber(agentCount, locale) }]
              : []),
            { label: t("common.meta.deletedOn"), value: deletionLabel },
          ]}
        />
      </Section>

      <Section style={cta}>
        <Button href={billingUrl}>{t("archiveExpiring.button", { kind })}</Button>
      </Section>
      <Text style={text.footnote}>{t("archiveExpiring.footnote", { kind })}</Text>
    </Layout>
  );
}

ArchiveExpiring.PreviewProps = {
  workspaceName: "Acme",
  pausedLabel: "12 March",
  deletionLabel: "10 June",
  agentCount: 3,
  billingUrl: "https://app.rerun.build/?billing=1",
  appUrl: "https://app.rerun.build",
} satisfies ArchiveExpiringProps;

const meta: React.CSSProperties = {
  margin: "0 0 4px",
};

const cta: React.CSSProperties = {
  margin: "24px 0",
};
