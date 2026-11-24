import * as React from "react";
import { Heading, Section, Text } from "@react-email/components";
import { Layout } from "../components/Layout";
import { Button } from "../components/Button";
import { strong } from "../components/rich";
import type { Brand } from "@rerun/contracts";
import { emailTranslator, type EmailLocale } from "../i18n";
import { text } from "../theme";

export interface CreatorPitchProps {
  firstName: string | null;
  /** The agent they actually built, when there is one worth naming. */
  agentName: string | null;
  creatorUrl: string;
  appUrl: string;
  unsubscribeUrl?: string;
  locale?: EmailLocale;
  brand?: Brand;
}

// No hero: this one is a proposition, not a report, and the band would dress it up.
export default function CreatorPitch({
  firstName,
  agentName,
  creatorUrl,
  appUrl,
  unsubscribeUrl,
  locale,
  brand,
}: CreatorPitchProps) {
  const t = emailTranslator(locale, brand?.name);
  return (
    <Layout
      preview={t("creatorPitch.preview")}
      hero={{ scene: "creator-pitch" }}
      appUrl={appUrl}
      unsubscribeUrl={unsubscribeUrl}
      locale={locale}
      brand={brand}
    >
      <Heading style={text.heading}>
        {firstName ? t("creatorPitch.headingNamed", { firstName }) : t("creatorPitch.heading")}
      </Heading>
      <Text style={text.paragraph}>
        {agentName
          ? t.rich("creatorPitch.bodyWithAgent", { agentName, strong })
          : t("creatorPitch.bodyWithoutAgent")}
      </Text>
      <Text style={text.paragraph}>{t("creatorPitch.creator")}</Text>
      <Section style={cta}>
        <Button href={creatorUrl}>{t("creatorPitch.button")}</Button>
      </Section>
      <Text style={text.footnote}>
        {agentName
          ? t("creatorPitch.footnoteWithAgent", { agentName })
          : t("creatorPitch.footnoteWithoutAgent")}
      </Text>
    </Layout>
  );
}

CreatorPitch.PreviewProps = {
  firstName: "Clément",
  agentName: "Atlas",
  creatorUrl: "https://app.rerun.build/creator",
  appUrl: "https://app.rerun.build",
  unsubscribeUrl: "https://app.rerun.build/unsubscribe",
} satisfies CreatorPitchProps;

const cta: React.CSSProperties = {
  margin: "24px 0",
};
