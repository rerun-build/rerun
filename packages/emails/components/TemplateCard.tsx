import * as React from "react";
import { Img, Link, Section, Text } from "@react-email/components";
import { ItemCard } from "./ItemCard";
import { EMAIL_CARD_WIDTH } from "../card";
import { emailTranslator, type EmailLocale } from "../i18n";
import { theme, text } from "../theme";

export interface TemplateCardProps {
  title: string;
  /** Where both the picture and the caption lead: the template, opened in the app. */
  href: string;
  /** What this setup delivers for this company. The one thing the picture cannot carry. */
  line: string;
  /** Only ever shown on the text fallback: next to the picture it would be one line too many. */
  meta?: React.ReactNode;
  /** The card of the template, captured at the width of this column. */
  imageUrl?: string;
  locale?: EmailLocale;
}

/**
 * A recommended template, shown as the very card the library draws, captured. There is no
 * conditional rendering in email: no `onerror`, no `:has`, no script. So the net for a reader with
 * images turned off is the `alt` of the picture, which carries the title and is itself the link,
 * plus the line written for this company under it. The title is deliberately not repeated there,
 * the picture already names the template.
 *
 * Without a capture the whole thing falls back to the text row it replaced.
 */
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
        {/* Width only, no height attribute: a stated height keeps the full box of the card reserved in
            a client that blocks remote images, which leaves a hole where the card should be. The
            capture is 456 wide, so the aspect ratio is the file's own. */}
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

// Stated rather than left to react-email, whose `Link` defaults to its own blue. It is only ever
// seen when images are blocked: what is painted then is the `alt`, and the alt is the title.
const imageLink: React.CSSProperties = {
  color: theme.text.strong,
  fontSize: "14px",
  fontWeight: 500,
  textDecoration: "none",
};

// No border and no radius: the capture is taken with the board's own frame, on this very surface,
// so drawing a second one would double the outline. Outlook squares CSS corners anyway.
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
