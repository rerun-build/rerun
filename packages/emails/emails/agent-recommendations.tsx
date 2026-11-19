import * as React from "react";
import { Heading, Section, Text } from "@react-email/components";
import { Layout } from "../components/Layout";
import { Button } from "../components/Button";
import { TemplateCard } from "../components/TemplateCard";
import { strong } from "../components/rich";
import { formatDuration } from "@moldwright/i18n/format";
import { emailTranslator, type EmailLocale } from "../i18n";
import { text } from "../theme";

export interface RecommendedTemplate {
  title: string;
  line: string;
  setupMinutes: number;
  url: string;
  imageUrl?: string;
}

export interface AgentRecommendationsProps {
  companyName: string | null;
  websiteDomain: string | null;
  templates: RecommendedTemplate[];
  browseUrl: string;
  appUrl: string;
  unsubscribeUrl?: string;
  locale?: EmailLocale;
}

export default function AgentRecommendations({
  companyName,
  websiteDomain,
  templates,
  browseUrl,
  appUrl,
  unsubscribeUrl,
  locale,
}: AgentRecommendationsProps) {
  const t = emailTranslator(locale);
  const company = companyName ?? t("agentRecommendations.yourCompany");

  return (
    <Layout
      preview={t("agentRecommendations.preview", { count: templates.length, company })}
      hero={{ scene: "agent-recommendations" }}
      appUrl={appUrl}
      unsubscribeUrl={unsubscribeUrl}
      locale={locale}
    >
      <Heading style={text.heading}>{t("agentRecommendations.heading", { company })}</Heading>
      <Text style={text.paragraph}>
        {websiteDomain
          ? t.rich("agentRecommendations.bodyWithSite", { domain: websiteDomain, strong })
          : t("agentRecommendations.bodyWithoutSite")}
      </Text>

      {templates.map((template) => (
        <TemplateCard
          key={template.url}
          title={template.title}
          href={template.url}
          imageUrl={template.imageUrl}
          meta={formatDuration(template.setupMinutes * 60_000, locale)}
          line={template.line}
          locale={locale}
        />
      ))}

      <Section style={cta}>
        <Button href={browseUrl}>{t("agentRecommendations.button")}</Button>
      </Section>
      <Text style={text.footnote}>{t("agentRecommendations.footnote")}</Text>
    </Layout>
  );
}

AgentRecommendations.PreviewProps = {
  companyName: "Acme",
  websiteDomain: "acme.com",
  templates: [
    {
      title: "Turn slow Shopify stock into bundles and campaigns",
      line: "Finds what has stopped selling and drafts the bundle and the campaign to move it",
      setupMinutes: 5,
      url: "https://moldwright.robagentic.tech/?template=shopify-dead-stock-bundles",
      imageUrl: "https://moldwright.robagentic.tech/og/templates/shopify-dead-stock-bundles/email-card",
    },
    {
      title: "Log Fireflies call notes to HubSpot weekly",
      line: "Files every call of the week on the right deal, once you have approved the batch",
      setupMinutes: 5,
      url: "https://moldwright.robagentic.tech/?template=log-call-notes-to-hubspot",
      imageUrl: "https://moldwright.robagentic.tech/og/templates/log-call-notes-to-hubspot/email-card",
    },
    {
      title: "Compile a daily news digest and send it via Gmail",
      line: "Ranks and summarises your sources every morning and drops the digest in your inbox",
      setupMinutes: 5,
      url: "https://moldwright.robagentic.tech/?template=daily-news-digest-gmail",
      imageUrl: "https://moldwright.robagentic.tech/og/templates/daily-news-digest-gmail/email-card",
    },
  ],
  browseUrl: "https://moldwright.robagentic.tech",
  appUrl: "https://moldwright.robagentic.tech",
  unsubscribeUrl: "https://moldwright.robagentic.tech/unsubscribe",
} satisfies AgentRecommendationsProps;

const cta: React.CSSProperties = {
  margin: "22px 0 18px",
};
