import * as React from "react";
import { Heading, Img, Link, Section, Text } from "@react-email/components";
import { Layout } from "../components/Layout";
import { Button } from "../components/Button";
import { emailTranslator, type EmailLocale } from "../i18n";
import { theme, text } from "../theme";

// One email for the whole program. `outreach` writes to someone whose listing we prefilled from
// their public work and who never asked for anything, `application` answers someone who applied:
// same link, same box, only the opening changes.
export type CreatorInviteContext = "outreach" | "application";

export interface CreatorInviteProps {
  firstName: string;
  joinUrl: string;
  appUrl: string;
  context: CreatorInviteContext;
  cardImageUrl?: string;
  unsubscribeUrl?: string;
  locale?: EmailLocale;
}

// This one keeps the expert card as its visual: a portrait of the recipient's own listing beats
// any generic illustration, so it gets no hero band.
export default function CreatorInvite({
  firstName,
  joinUrl,
  appUrl,
  context,
  cardImageUrl,
  unsubscribeUrl,
  locale,
}: CreatorInviteProps) {
  const t = emailTranslator(locale);
  const outreach = context === "outreach";

  return (
    <Layout
      preview={outreach ? t("creatorInvite.previewOutreach") : t("creatorInvite.previewApplication")}
      appUrl={appUrl}
      unsubscribeUrl={unsubscribeUrl}
      unsubscribeLabel={unsubscribeUrl ? t("creatorInvite.unsubscribe") : undefined}
      locale={locale}
    >
      <Heading style={text.heading}>
        {outreach
          ? t("creatorInvite.headingOutreach", { firstName })
          : t("creatorInvite.headingApplication", { firstName })}
      </Heading>

      <Text style={text.paragraph}>
        {outreach ? t("creatorInvite.introOutreach") : t("creatorInvite.introApplication")}
      </Text>

      {cardImageUrl ? (
        <Section style={cardWrap}>
          <Link href={joinUrl} style={cardLinkWrap}>
            <Img
              src={cardImageUrl}
              width="340"
              alt={t("creatorInvite.cardAlt", { firstName })}
              style={card}
            />
          </Link>
        </Section>
      ) : null}

      <Text style={text.paragraph}>{t("creatorInvite.sandbox")}</Text>

      <Section style={cta}>
        <Button href={joinUrl}>{t("creatorInvite.button")}</Button>
      </Section>

      <Text style={text.paragraph}>{t("creatorInvite.conditions")}</Text>
      <Text style={small}>
        {t.rich("creatorInvite.fallbackLink", {
          url: joinUrl,
          link: (chunks) => (
            <Link href={joinUrl} style={inlineLink}>
              {chunks}
            </Link>
          ),
        })}
      </Text>

      <Text style={signoff}>{t("creatorInvite.signoff")}</Text>
    </Layout>
  );
}

CreatorInvite.PreviewProps = {
  firstName: "Alex",
  joinUrl: "https://app.rerun.build/creator/join/q3qmbe89",
  appUrl: "https://app.rerun.build",
  context: "outreach",
  cardImageUrl: "https://app.rerun.build/experts/alex-mercier/card.png",
  unsubscribeUrl: "https://rerun.build/community/experts/unsubscribe/q3qmbe89",
} satisfies CreatorInviteProps;

const cardWrap: React.CSSProperties = {
  margin: "24px 0",
  textAlign: "center",
};

const cardLinkWrap: React.CSSProperties = {
  color: theme.brand.light,
  display: "inline-block",
  textDecoration: "none",
};

const card: React.CSSProperties = {
  display: "block",
  margin: "0 auto",
  borderRadius: "16px",
};

const cta: React.CSSProperties = {
  margin: "24px 0",
};

const small: React.CSSProperties = {
  ...text.footnote,
  margin: "0 0 16px",
  wordBreak: "break-all",
};

const inlineLink: React.CSSProperties = {
  color: theme.brand.light,
  textDecoration: "underline",
};

const signoff: React.CSSProperties = {
  ...text.paragraph,
  color: theme.text.faint,
  margin: "24px 0 0",
};
