import * as React from "react";
import { Img, Link, Section, Text } from "@react-email/components";
import { ItemCard } from "./ItemCard";
import { EMAIL_CARD_WIDTH } from "../card";
import { emailTranslator, type EmailLocale } from "../i18n";
import { theme, text } from "../theme";

export interface TemplateCardProps {
  title: string;
  href: string;
  line: string;
  meta?: React.ReactNode;
  imageUrl?: string;
  locale?: EmailLocale;
}

export function TemplateCard({
  title,
  href,
  line,
  meta,
  imageUrl,
  locale,
}: TemplateCardProps) {
  const actionLabel = emailTranslator(locale)("common.useThisCoworker");
  if (!imageUrl) {
    return (
      <ItemCard
        title={title}
        href={href}
        meta={meta}
        body={line}
        action={{ href, label: actionLabel }}
      />
    );
  }

  return (
    <Section style={card}>
      <Link href={href} style={imageLink}>
        <Img src={imageUrl} width={EMAIL_CARD_WIDTH} alt={title} style={image} />
      </Link>
      <Text style={cardBody}>{line}</Text>
      <Text style={cardAction}>
        <Link href={href} style={cardActionLink}>
          {actionLabel}
        </Link>
      </Text>
    </Section>
  );
}

const card: React.CSSProperties = {
  margin: "0 0 18px",
};

const imageLink: React.CSSProperties = {
  color: theme.text.strong,
  fontSize: "14px",
  fontWeight: 500,
  textDecoration: "none",
};

const image: React.CSSProperties = {
  border: 0,
  display: "block",
  height: "auto",
  maxWidth: `${EMAIL_CARD_WIDTH}px`,
  width: "100%",
};

const cardBody: React.CSSProperties = {
  ...text.mono,
  color: theme.text.muted,
  margin: "12px 0 8px",
};

const cardAction: React.CSSProperties = {
  margin: 0,
};

const cardActionLink: React.CSSProperties = {
  color: theme.brand.light,
  fontSize: "13px",
  fontWeight: 500,
  textDecoration: "none",
};
