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
        {/* Declaring the scheme is what stops iOS Mail and the Gmail apps from running their
            own inversion pass over greys that are already dark. */}
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

// The lockup points at the site, not at the app: the CTAs already carry `appUrl`.
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

// Colour stated rather than left to react-email, whose `Link` defaults to its own blue. It is
// only ever seen when images are blocked: what is painted then is the `alt`, and the alt reads
// "Rerun" right next to the wordmark.
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

// Weight 500, per the design system rule that headings are medium and never bold.
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
