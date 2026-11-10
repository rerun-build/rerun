import * as React from "react";
import { Heading, Section, Text } from "@react-email/components";
import { Layout } from "../components/Layout";
import { Button } from "../components/Button";
import { MetaTable } from "../components/MetaTable";
import { strong } from "../components/rich";
import { formatNumber } from "@rerun/i18n/format";
import { emailTranslator, type EmailLocale } from "../i18n";
import { text } from "../theme";

export interface ArchiveExpiringProps {
  workspaceName: string | null;
  /** When the workspace was paused, "12 March". Preformatted. */
  pausedLabel: string;
  /** When the saved copy is deleted, "10 June". Preformatted. */
  deletionLabel: string;
  agentCount: number;
  billingUrl: string;
  /** An archived sandbox comes back through a request to us, not through a subscription. */
  sandbox?: boolean;
  /** A capture of the workspace's board, signed by the sender. Without it the usual banner shows. */
  boardUrl?: string;
  appUrl: string;
  unsubscribeUrl?: string;
  locale?: EmailLocale;
}

/**
 * The last word on a paused workspace, a week before its saved copy is deleted. Every email before
 * this one could truthfully say nothing was deleted; this one cannot, so it states the date and
 * says plainly that it is the last chance.
 */
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
