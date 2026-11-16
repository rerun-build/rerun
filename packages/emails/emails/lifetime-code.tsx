import * as React from "react";
import { Heading, Section, Text } from "@react-email/components";
import { Layout } from "../components/Layout";
import { Button } from "../components/Button";
import { emailTranslator, type EmailLocale } from "../i18n";
import { text, theme } from "../theme";

export interface LifetimeCodeProps {
  code: string;
  redeemUrl: string;
  appUrl: string;
  locale?: EmailLocale;
}

export default function LifetimeCode({ code, redeemUrl, appUrl, locale }: LifetimeCodeProps) {
  const t = emailTranslator(locale);
  return (
    <Layout preview={t("lifetimeCode.preview", { code })} appUrl={appUrl} locale={locale}>
      <Heading style={text.heading}>{t("lifetimeCode.heading")}</Heading>
      <Text style={text.paragraph}>{t("lifetimeCode.body")}</Text>
      <Section style={codeBox}>
        <Text style={codeText}>{code}</Text>
      </Section>
      <Section style={cta}>
        <Button href={redeemUrl}>{t("lifetimeCode.button")}</Button>
      </Section>
      <Text style={text.footnote}>{t("lifetimeCode.footnote")}</Text>
    </Layout>
  );
}

LifetimeCode.PreviewProps = {
  code: "RERUN-7KQ4-M2XW-9HTD",
  redeemUrl: "https://app.rerun.build/redeem?code=RERUN-7KQ4-M2XW-9HTD",
  appUrl: "https://app.rerun.build",
} satisfies LifetimeCodeProps;

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
  fontSize: "20px",
  fontWeight: 500,
  letterSpacing: "0.08em",
  lineHeight: "28px",
  margin: 0,
};

const cta: React.CSSProperties = {
  margin: "24px 0",
};
