import * as React from "react";
import { Heading, Section, Text } from "@react-email/components";
import { Button } from "./Button";
import type { HeroProps } from "./Hero";
import { Layout } from "./Layout";
import type { EmailLocale } from "../i18n";
import { text } from "../theme";

export interface AlertMessageProps {
  hero: HeroProps;
  heading: string;
  body: string;
  action: { label: string; href: string };
  appUrl: string;
  unsubscribeUrl?: string;
  locale?: EmailLocale;
}

/** What stopped coworkers, in one paragraph, and the one thing that starts them again. */
export function AlertMessage({ hero, heading, body, action, appUrl, unsubscribeUrl, locale }: AlertMessageProps) {
  return (
    <Layout preview={body} hero={hero} appUrl={appUrl} unsubscribeUrl={unsubscribeUrl} locale={locale}>
      <Heading style={text.heading}>{heading}</Heading>
      <Text style={{ ...text.paragraph, margin: 0 }}>{body}</Text>
      <Section style={{ margin: "24px 0 0" }}>
        <Button href={action.href}>{action.label}</Button>
      </Section>
    </Layout>
  );
}
