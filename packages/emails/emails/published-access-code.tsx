import * as React from "react";
import { Heading, Section, Text } from "@react-email/components";
import { Layout } from "../components/Layout";
import { emailTranslator, type EmailLocale } from "../i18n";
import { text, theme } from "../theme";

export interface PublishedAccessCodeProps {
  code: string;
  workspaceName: string;
  pageTitle: string;
  expiresInMinutes: number;
  appUrl: string;
  locale?: EmailLocale;
}

export default function PublishedAccessCode({
  code,
  workspaceName,
  pageTitle,
  expiresInMinutes,
  appUrl,
  locale,
}: PublishedAccessCodeProps) {
  const t = emailTranslator(locale);
  return (
    <Layout preview={t("publishedAccessCode.preview", { pageTitle, code })} appUrl={appUrl} locale={locale}>
      <Heading style={text.heading}>{t("publishedAccessCode.heading", { pageTitle })}</Heading>
      <Text style={text.paragraph}>
        {t("publishedAccessCode.body", { workspaceName })}
      </Text>
      <Section style={codeBox}>
        <Text style={codeText}>{code}</Text>
      </Section>
      <Text style={text.footnote}>
        {t("publishedAccessCode.footnote", { minutes: expiresInMinutes })}
      </Text>
    </Layout>
  );
}

PublishedAccessCode.PreviewProps = {
  code: "482913",
  workspaceName: "Acme",
  pageTitle: "Q3 proposal for Northwind",
  expiresInMinutes: 10,
  appUrl: "https://app.rerun.build",
} satisfies PublishedAccessCodeProps;

const codeBox: React.CSSProperties = {
  backgroundColor: theme.surface.inset,
  border: `1px solid ${theme.surface.border}`,
  borderRadius: theme.radius.inner,
  margin: "8px 0 0",
  padding: "16px 0",
  textAlign: "center",
};

const codeText: React.CSSProperties = {
  color: theme.text.strong,
  fontFamily: theme.font.mono,
  fontSize: "28px",
  fontWeight: 500,
  letterSpacing: "0.3em",
  lineHeight: "36px",
  margin: 0,
};
