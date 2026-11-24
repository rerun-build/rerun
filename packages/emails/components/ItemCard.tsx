import * as React from "react";
import { Link, Section, Text } from "@react-email/components";
import { SplitRow, SplitTable } from "./MetaTable";
import { theme, text } from "../theme";

export interface ItemCardProps {
  title: string;
  /** Right-hand cell of the title row: a count, a duration, a price. */
  meta?: React.ReactNode;
  /** The line under the title: where it came from, what it needs. */
  label?: string;
  /** The body line. */
  body?: string;
  /** Makes the title a link. */
  href?: string;
  /** A text link under the body, for a list where each card has its own destination. */
  action?: { href: string; label: string };
  locale?: string;
}

/**
 * One framed row inside a card: a held-back notification, a recommended setup. `Panel` cannot do
 * this, it drops its children into a single `<Text>` and a title plus two lines would come out as
 * paragraphs nested inside a paragraph.
 */
export function ItemCard({ title, meta, label, body, href, action, locale }: ItemCardProps) {
  return (
    <Section style={card}>
      <SplitTable>
        <SplitRow
          left={
            href ? (
              <Link href={href} style={cardTitle}>
                {title}
              </Link>
            ) : (
              <span style={cardTitle}>{title}</span>
            )
          }
          right={meta ? <span style={cardMeta}>{meta}</span> : null}
          locale={locale}
        />
      </SplitTable>
      {label ? <Text style={cardLabel}>{label}</Text> : null}
      {body ? <Text style={label ? cardBody : cardBodyAlone}>{body}</Text> : null}
      {action ? (
        <Text style={cardAction}>
          <Link href={action.href} style={cardActionLink}>
            {action.label}
          </Link>
        </Text>
      ) : null}
    </Section>
  );
}

const card: React.CSSProperties = {
  backgroundColor: theme.surface.inset,
  border: `1px solid ${theme.surface.border}`,
  borderRadius: theme.radius.inner,
  margin: "0 0 10px",
  padding: "12px 16px",
};

const cardTitle: React.CSSProperties = {
  color: theme.text.strong,
  fontSize: "14px",
  fontWeight: 500,
  textDecoration: "none",
};

const cardMeta: React.CSSProperties = {
  color: theme.text.muted,
  fontFamily: theme.font.mono,
  fontSize: "12px",
  fontVariantNumeric: "tabular-nums",
  // A long title steals the width and would otherwise break "10 min" across two lines.
  whiteSpace: "nowrap",
};

const cardLabel: React.CSSProperties = {
  ...text.label,
  letterSpacing: "0.02em",
  margin: "4px 0 8px",
  textTransform: "none",
};

const cardBody: React.CSSProperties = {
  ...text.mono,
  color: theme.text.muted,
};

// `text.mono` carries no margin at all, which is right under a label that already spaces itself.
// With no label the body is what directly follows the title, and would sit flush against it.
const cardBodyAlone: React.CSSProperties = {
  ...cardBody,
  marginTop: "8px",
};

const cardAction: React.CSSProperties = {
  margin: "10px 0 0",
};

const cardActionLink: React.CSSProperties = {
  color: theme.brand.light,
  fontSize: "13px",
  fontWeight: 500,
  textDecoration: "none",
};
