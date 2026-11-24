import * as React from "react";
import { RERUN_BRAND, type Brand } from "@rerun/contracts";
import {
  Body,
  Container,
  Head,
  Html,
  Preview,
  Section,
} from "@react-email/components";
import { readingSides } from "./direction";
import { Footer } from "./Footer";
import { Hero, type HeroProps } from "./Hero";
import { Lockup } from "./Lockup";
import { assetOrigin } from "../assets";
import { localeDirection } from "@rerun/i18n";
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
  brand?: Brand;
}

export function Layout({
  preview,
  children,
  hero,
  appUrl,
  unsubscribeUrl,
  unsubscribeLabel,
  locale = "en",
  brand = RERUN_BRAND,
}: LayoutProps) {
  const sides = readingSides(locale);
  return (
    <Html lang={locale} dir={localeDirection(locale)}>
      <Head>
        <meta name="color-scheme" content="dark" />
        <meta name="supported-color-schemes" content="dark" />
        {/* Declaring the scheme is what stops iOS Mail and the Gmail apps from running their
            own inversion pass over greys that are already dark. */}
        <style>{HEAD_STYLE}</style>
      </Head>
      <Preview>{preview}</Preview>
      <Body className="rr-frame" style={body}>
        <Section style={{ ...header, textAlign: sides.start }}>
          <Lockup brand={brand} start={sides.start} />
        </Section>
        <Container style={container}>
          {hero ? <Hero {...hero} origin={assetOrigin(brand, appUrl)} /> : null}
          <Section className="rr-content" style={hero ? content : { ...content, paddingTop: "34px" }}>
            {children}
          </Section>
        </Container>
        <Footer unsubscribeUrl={unsubscribeUrl} unsubscribeLabel={unsubscribeLabel} locale={locale} brand={brand} />
      </Body>
    </Html>
  );
}

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
