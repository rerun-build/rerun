import * as React from "react";
import { Link, Section, Text } from "@react-email/components";
import { emailTranslator, type EmailLocale } from "../i18n";
import { theme, text } from "../theme";

export interface FooterProps {
  unsubscribeUrl?: string;
  unsubscribeLabel?: string;
  locale?: EmailLocale;
}

export function Footer({
  unsubscribeUrl,
  unsubscribeLabel,
  locale,
}: FooterProps) {
  const t = emailTranslator(locale);
  return (
    <Section style={footer}>
      <table role="presentation" width="100%" cellPadding={0} cellSpacing={0} border={0} style={ruleTable}>
        <tbody>
          <tr>
            <td height={1} style={rule}>
              &nbsp;
            </td>
          </tr>
        </tbody>
      </table>
      <Text style={tagline}>{t("common.footer.tagline")}</Text>
      <Text style={legal}>
        {t("common.footer.copyright")}
        {unsubscribeUrl ? (
          <>
            <span style={dot}>·</span>
            <Link href={unsubscribeUrl} style={link}>
              {unsubscribeLabel ?? t("common.footer.unsubscribe")}
            </Link>
          </>
        ) : null}
      </Text>
    </Section>
  );
}

const footer: React.CSSProperties = {
  margin: "0 auto",
  maxWidth: `${theme.width.card}px`,
  textAlign: "left",
};

const ruleTable: React.CSSProperties = {
  borderCollapse: "collapse",
  margin: "24px 0 18px",
};

const rule: React.CSSProperties = {
  backgroundColor: theme.surface.border,
  fontSize: 0,
  height: "1px",
  lineHeight: "1px",
};

const tagline: React.CSSProperties = {
  ...text.footnote,
  color: theme.text.muted,
  margin: 0,
  maxWidth: "400px",
};

const legal: React.CSSProperties = {
  ...text.footnote,
  color: theme.text.faint,
  margin: "6px 0 0",
};

const dot: React.CSSProperties = {
  color: theme.surface.border,
  margin: "0 8px",
};

const link: React.CSSProperties = {
  color: theme.text.faint,
  textDecoration: "underline",
};
