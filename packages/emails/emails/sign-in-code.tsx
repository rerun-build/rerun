import * as React from "react";
import { Heading, Section, Text } from "@react-email/components";
import { Layout } from "../components/Layout";
import { Button } from "../components/Button";
import { emailTranslator, type EmailLocale } from "../i18n";
import { text, theme } from "../theme";

export interface SignInCodeProps {
  code: string;
  // Left out for an account that is already signed in and confirms a new address: the code is
  // typed where it was asked for, and a sign-in link would lead that account nowhere.
  signInUrl?: string;
  expiresInMinutes: number;
  appUrl: string;
  locale?: EmailLocale;
}

export default function SignInCode({
  code,
  signInUrl,
  expiresInMinutes,
  appUrl,
  locale,
}: SignInCodeProps) {
  const t = emailTranslator(locale);
  return (
    <Layout preview={t("signInCode.preview", { code })} appUrl={appUrl} locale={locale}>
      <Heading style={text.heading}>
        {signInUrl ? t("signInCode.headingSignIn") : t("signInCode.headingConfirm")}
      </Heading>
      <Text style={text.paragraph}>
        {signInUrl ? t("signInCode.bodySignIn") : t("signInCode.bodyConfirm")}
      </Text>
      <Section style={codeBox}>
        <Text style={codeText}>{code}</Text>
      </Section>
      {signInUrl ? (
        <Section style={cta}>
          <Button href={signInUrl}>{t("signInCode.button")}</Button>
        </Section>
      ) : null}
      <Text style={text.footnote}>
        {signInUrl
          ? t("signInCode.footnoteSignIn", { minutes: expiresInMinutes })
          : t("signInCode.footnoteConfirm", { minutes: expiresInMinutes })}
      </Text>
    </Layout>
  );
}

SignInCode.PreviewProps = {
  code: "482913",
  signInUrl: "https://app.rerun.build/auth/confirm?token_hash=abc123&type=magiclink",
  expiresInMinutes: 15,
  appUrl: "https://app.rerun.build",
} satisfies SignInCodeProps;

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

const cta: React.CSSProperties = {
  margin: "24px 0",
};
