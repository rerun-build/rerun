import * as React from "react";
import { Img, Link, Section, Text } from "@react-email/components";
import { Button } from "./Button";
import { theme, text } from "../theme";

export interface NewsletterSectionImage {
  src: string;
  width: number;
  height?: number;
  alt: string;
  href?: string;
}

export interface NewsletterSectionProps {
  label?: string;
  title: string;
  body: React.ReactNode;
  image?: NewsletterSectionImage;
  cta?: { href: string; label: string };
}

export function NewsletterSection({
  label,
  title,
  body,
  image,
  cta,
}: NewsletterSectionProps) {
  return (
    <Section style={block}>
      <table
        role="presentation"
        width="100%"
        cellPadding={0}
        cellSpacing={0}
        border={0}
        style={ruleTable}
      >
        <tbody>
          <tr>
            <td height={1} style={rule}>
              &nbsp;
            </td>
          </tr>
        </tbody>
      </table>
      {label ? <Text style={kicker}>{label}</Text> : null}
      <Text style={title_}>{title}</Text>
      {image ? <SectionImage {...image} /> : null}
      <Text style={text.paragraph}>{body}</Text>
      {cta ? (
        <Section style={ctaWrap}>
          <Button href={cta.href}>{cta.label}</Button>
        </Section>
      ) : null}
    </Section>
  );
}

function SectionImage({ src, width, height, alt, href }: NewsletterSectionImage) {
  const img = <Img src={src} width={width} height={height} alt={alt} style={art} />;
  return href ? (
    <Link href={href} style={artLink}>
      {img}
    </Link>
  ) : (
    img
  );
}

const block: React.CSSProperties = {
  margin: "24px 0 0",
};

const ruleTable: React.CSSProperties = {
  borderCollapse: "collapse",
  margin: "0 0 20px",
};

const rule: React.CSSProperties = {
  backgroundColor: theme.surface.border,
  fontSize: 0,
  height: "1px",
  lineHeight: "1px",
};

const kicker: React.CSSProperties = {
  ...text.label,
  margin: "0 0 8px",
};

const title_: React.CSSProperties = {
  color: theme.text.strong,
  fontSize: "17px",
  fontWeight: 500,
  letterSpacing: "-0.01em",
  lineHeight: "24px",
  margin: "0 0 10px",
};

const artLink: React.CSSProperties = {
  color: theme.text.strong,
  display: "block",
  textDecoration: "none",
};

const art: React.CSSProperties = {
  border: 0,
  borderRadius: theme.radius.inner,
  display: "block",
  height: "auto",
  margin: "0 0 14px",
  maxWidth: "100%",
  width: "100%",
};

const ctaWrap: React.CSSProperties = {
  margin: "18px 0 0",
};
