import * as React from "react";
import {
  Body,
  Container,
  Head,
  Html,
  Img,
  Link,
  Preview,
  Section,
} from "@react-email/components";
import { Footer } from "./Footer";
import { Hero, type HeroProps } from "./Hero";
import { LOGO_SIZE, LOGO_URL } from "../assets";
import type { EmailLocale } from "../i18n";
import { theme } from "../theme";

export interface LayoutProps {
  preview: string;
  children: React.ReactNode;
  hero?: HeroProps;
  appUrl?: string;
  unsubscribeUrl?: string;
  unsubscribeLabel?: string;
  locale?: EmailLocale;
}

export function Layout({
  preview,
  children,
  hero,
  unsubscribeUrl,
  unsubscribeLabel,
  locale = "en",
}: LayoutProps) {
  return (
    <Html lang={locale}>
      <Head>
        <meta name="color-scheme" content="dark" />
        <meta name="supported-color-schemes" content="dark" />
        <style>{HEAD_STYLE}</style>
      </Head>
      <Preview>{preview}</Preview>
      <Body className="rr-frame" style={body}>
        <Section style={header}>
          <table align="left" role="presentation" style={lockup}>
            <tbody>
              <tr>
                <td style={logoCell}>
                  <Link href={SITE_URL} style={logoLink}>
                    <Img
                      src={LOGO_URL}
                      width={LOGO_SIZE}
                      height={LOGO_SIZE}
                      alt="Rerun"
                      style={logo}
                    />
                  </Link>
                </td>
                <td style={brandCell}>
                  <Link href={SITE_URL} style={brand}>
                    Rerun
                  </Link>
                </td>
              </tr>
            </tbody>
          </table>
        </Section>
        <Container style={container}>
          {hero ? <Hero {...hero} /> : null}
          <Section className="rr-content" style={hero ? content : { ...content, paddingTop: "34px" }}>
            {children}
          </Section>
        </Container>
        <Footer unsubscribeUrl={unsubscribeUrl} unsubscribeLabel={unsubscribeLabel} locale={locale} />
      </Body>
    </Html>
  );
}

const SITE_URL = "https://rerun.build";

const HEAD_STYLE = `
  :root { color-scheme: dark; supported-color-schemes: dark; }
  @media only screen and (max-width: 600px) {
    .rr-content { padding: 24px 20px !important; }
    .rr-frame { padding: 20px 12px !important; }
  }
`;

const body: React.CSSProperties = {
  backgroundColor: theme.surface.page,
  color: theme.text.body,
  fontFamily: theme.font.sans,
  margin: 0,
  padding: "36px 16px",
};

const header: React.CSSProperties = {
  margin: "0 auto 18px",
  maxWidth: `${theme.width.card}px`,
  textAlign: "left",
};

const lockup: React.CSSProperties = {
  borderCollapse: "collapse",
};

const logoCell: React.CSSProperties = {
  paddingRight: "10px",
  verticalAlign: "middle",
};

const logoLink: React.CSSProperties = {
  color: theme.text.strong,
  display: "block",
  textDecoration: "none",
};

const logo: React.CSSProperties = {
  display: "block",
};

const brandCell: React.CSSProperties = {
  verticalAlign: "middle",
};

const brand: React.CSSProperties = {
  color: theme.text.strong,
  fontSize: "17px",
  fontWeight: 500,
  letterSpacing: "-0.02em",
  textDecoration: "none",
};

const container: React.CSSProperties = {
  backgroundColor: theme.surface.card,
  border: `1px solid ${theme.surface.border}`,
  borderRadius: theme.radius.card,
  margin: "0 auto",
  maxWidth: `${theme.width.card}px`,
  overflow: "hidden",
};

const content: React.CSSProperties = {
  padding: "28px 32px 32px",
};
