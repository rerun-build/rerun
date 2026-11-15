import * as React from "react";
import { Link, Section, Text } from "@react-email/components";
import { SplitRow, SplitTable } from "./MetaTable";
import { theme, text } from "../theme";

export interface ItemCardProps {
  title: string;
  meta?: React.ReactNode;
  label?: string;
  body?: string;
  href?: string;
  action?: { href: string; label: string };
}

export function ItemCard({ title, meta, label, body, href, action }: ItemCardProps) {
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
