import * as React from "react";
import { isWhiteLabel, RERUN_BRAND, type Brand } from "@rerun/contracts";
import { Link, Section, Text } from "@react-email/components";
import { emailTranslator, type EmailLocale } from "../i18n";
import { theme, text } from "../theme";
import { readingSides } from "./direction";

export interface FooterProps {
  unsubscribeUrl?: string;
  unsubscribeLabel?: string;
  locale?: EmailLocale;
  brand?: Brand;
}

export function Footer({
  unsubscribeUrl,
  unsubscribeLabel,
  locale,
  brand = RERUN_BRAND,
}: FooterProps) {
  const t = emailTranslator(locale, brand.name);
  const sides = readingSides(locale);
  return (
    <Section style={{ ...footer, textAlign: sides.start }}>
      <table role="presentation" width="100%" cellPadding={0} cellSpacing={0} border={0} style={ruleTable}>
        <tbody>
          <tr>
            <td height={1} style={rule}>
              &nbsp;
            </td>
          </tr>
        </tbody>
      </table>
      {isWhiteLabel(brand) ? null : <Text style={tagline}>{t("common.footer.tagline")}</Text>}
      <Text style={legal}>
        {t("common.footer.copyright")}
        {brand.supportEmail ? (
          <>
            <span style={dot}>·</span>
            <Link href={`mailto:${brand.supportEmail}`} style={link}>
              {brand.supportEmail}
            </Link>
          </>
        ) : null}
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
