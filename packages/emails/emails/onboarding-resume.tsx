import * as React from "react";
import { Heading, Section, Text } from "@react-email/components";
import { Layout } from "../components/Layout";
import { Button } from "../components/Button";
import { emailTranslator, type EmailLocale } from "../i18n";
import { text } from "../theme";

export interface OnboardingResumeProps {
  firstName: string | null;
  resumeUrl: string;
  appUrl: string;
  unsubscribeUrl?: string;
  locale?: EmailLocale;
}

// Nothing is stored while the survey is open, so this email never claims a saved position. What it
// promises is what is true: the questions come back on the next visit and they are short.
export default function OnboardingResume({
  firstName,
  resumeUrl,
  appUrl,
  unsubscribeUrl,
  locale,
}: OnboardingResumeProps) {
  const t = emailTranslator(locale);
  return (
    <Layout
      preview={t("onboardingResume.preview")}
      hero={{ scene: "onboarding-resume" }}
      appUrl={appUrl}
      unsubscribeUrl={unsubscribeUrl}
      locale={locale}
    >
      <Heading style={text.heading}>
        {firstName ? t("onboardingResume.headingNamed", { firstName }) : t("onboardingResume.heading")}
      </Heading>
      <Text style={text.paragraph}>{t("onboardingResume.leftEarly")}</Text>
      <Text style={text.paragraph}>{t("onboardingResume.whyItMatters")}</Text>
      <Section style={cta}>
        <Button href={resumeUrl}>{t("onboardingResume.button")}</Button>
      </Section>
      <Text style={text.footnote}>{t("onboardingResume.footnote")}</Text>
    </Layout>
  );
}

OnboardingResume.PreviewProps = {
  firstName: "Clément",
  resumeUrl: "https://app.rerun.build",
  appUrl: "https://app.rerun.build",
  unsubscribeUrl: "https://app.rerun.build/unsubscribe",
} satisfies OnboardingResumeProps;

const cta: React.CSSProperties = {
  margin: "24px 0",
};
