import * as React from "react";
import { Heading, Section, Text } from "@react-email/components";
import { Layout } from "../components/Layout";
import { Button } from "../components/Button";
import { MetaTable } from "../components/MetaTable";
import { strong } from "../components/rich";
import { formatNumber } from "@rerun/i18n/format";
import { emailTranslator, type EmailLocale } from "../i18n";
import { text } from "../theme";

export interface SandboxIdleProps {
  lastActiveLabel: string;
  archiveLabel: string;
  agentCount: number;
  sandboxUrl: string;
  boardUrl?: string;
  appUrl: string;
  unsubscribeUrl?: string;
  locale?: EmailLocale;
}

export default function SandboxIdle({
  lastActiveLabel,
  archiveLabel,
  agentCount,
  sandboxUrl,
  boardUrl,
  appUrl,
  unsubscribeUrl,
  locale,
}: SandboxIdleProps) {
  const t = emailTranslator(locale);
  return (
    <Layout
      preview={t("sandboxIdle.preview", { date: archiveLabel })}
      hero={{ scene: "trial-ended", board: boardUrl }}
      appUrl={appUrl}
      unsubscribeUrl={unsubscribeUrl}
      locale={locale}
    >
      <Heading style={text.heading}>{t("sandboxIdle.heading", { date: archiveLabel })}</Heading>
      <Text style={text.paragraph}>
        {t.rich("sandboxIdle.unused", { lastActive: lastActiveLabel, strong })}
      </Text>
      <Text style={text.paragraph}>
        {t.rich("sandboxIdle.openBefore", { date: archiveLabel, strong })}
      </Text>

      <Section style={meta}>
        <MetaTable
          rows={[
            { label: t("common.meta.lastOpened"), value: lastActiveLabel },
            ...(agentCount > 0
              ? [{ label: t("common.meta.coworkers"), value: formatNumber(agentCount, locale) }]
              : []),
            { label: t("common.meta.archivedOn"), value: archiveLabel },
          ]}
        />
      </Section>

      <Section style={cta}>
        <Button href={sandboxUrl}>{t("sandboxIdle.button")}</Button>
      </Section>
    </Layout>
  );
}

SandboxIdle.PreviewProps = {
  lastActiveLabel: "4 September",
  archiveLabel: "6 October",
  agentCount: 2,
  sandboxUrl: "https://app.rerun.build",
  appUrl: "https://app.rerun.build",
} satisfies SandboxIdleProps;

const meta: React.CSSProperties = {
  margin: "0 0 4px",
};

const cta: React.CSSProperties = {
  margin: "24px 0",
};
