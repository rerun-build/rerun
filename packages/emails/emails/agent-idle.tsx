import * as React from "react";
import { Heading, Section, Text } from "@react-email/components";
import { Layout } from "../components/Layout";
import { Button } from "../components/Button";
import { MetaTable } from "../components/MetaTable";
import { strong } from "../components/rich";
import { formatNumber } from "@moldwright/i18n/format";
import { emailTranslator, type EmailLocale } from "../i18n";
import { text } from "../theme";

export interface AgentIdleProps {
  agentName: string;
  createdLabel: string;
  agentUrl: string;
  boardUrl?: string;
  appUrl: string;
  unsubscribeUrl?: string;
  locale?: EmailLocale;
}

export default function AgentIdle({
  agentName,
  createdLabel,
  agentUrl,
  boardUrl,
  appUrl,
  unsubscribeUrl,
  locale,
}: AgentIdleProps) {
  const t = emailTranslator(locale);
  return (
    <Layout
      preview={t("agentIdle.preview", { agentName })}
      hero={{ scene: "agent-idle", board: boardUrl }}
      appUrl={appUrl}
      unsubscribeUrl={unsubscribeUrl}
      locale={locale}
    >
      <Heading style={text.heading}>{t("agentIdle.heading", { agentName })}</Heading>
      <Text style={text.paragraph}>{t.rich("agentIdle.body", { agentName, strong })}</Text>

      <Section style={meta}>
        <MetaTable
          rows={[
            { label: t("common.meta.coworker"), value: agentName },
            { label: t("common.meta.created"), value: createdLabel },
            { label: t("common.meta.runs"), value: formatNumber(0, locale) },
          ]}
        />
      </Section>

      <Section style={cta}>
        <Button href={agentUrl}>{t("agentIdle.button", { agentName })}</Button>
      </Section>
      <Text style={text.footnote}>{t("agentIdle.footnote")}</Text>
    </Layout>
  );
}

AgentIdle.PreviewProps = {
  agentName: "Atlas",
  createdLabel: "3 hours ago",
  agentUrl: "https://moldwright.robagentic.tech/?agent=8f2b",
  appUrl: "https://moldwright.robagentic.tech",
  unsubscribeUrl: "https://moldwright.robagentic.tech/unsubscribe",
} satisfies AgentIdleProps;

const meta: React.CSSProperties = {
  margin: "0 0 4px",
};

const cta: React.CSSProperties = {
  margin: "24px 0",
};
