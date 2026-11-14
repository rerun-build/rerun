import * as React from "react";
import { Heading, Section, Text } from "@react-email/components";
import { Layout } from "./Layout";
import { Panel } from "./Panel";
import { text } from "../theme";

export interface NewsletterProps {
  appUrl: string;
  unsubscribeUrl: string;
}

export type NewsletterAudience = "product" | "waitlist";

export interface NewsletterMeta {
  slug: string;
  subject: string;
  preview: string;
  date: string;
  audience?: NewsletterAudience;
}

export interface NewsletterLayoutProps extends NewsletterProps {
  meta: NewsletterMeta;
  title: string;
  intro: React.ReactNode;
  note?: React.ReactNode;
  children: React.ReactNode;
}

const ISSUE_DATE = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

export function NewsletterLayout({
  meta,
  title,
  intro,
  note,
  children,
  appUrl,
  unsubscribeUrl,
}: NewsletterLayoutProps) {
  return (
    <Layout
      preview={meta.preview}
      hero={{ newsletter: meta.slug }}
      appUrl={appUrl}
      unsubscribeUrl={unsubscribeUrl}
      unsubscribeLabel="Unsubscribe from product updates"
    >
      <Text style={issue}>
        Product update · {ISSUE_DATE.format(new Date(meta.date))}
      </Text>
      <Heading style={heading}>{title}</Heading>
      {note ? (
        <Panel tone="brand" style={noteFrame}>
          {note}
        </Panel>
      ) : null}
      <Text style={text.paragraph}>{intro}</Text>
      <Section>{children}</Section>
    </Layout>
  );
}

const issue: React.CSSProperties = {
  ...text.label,
  margin: "0 0 12px",
};

const heading: React.CSSProperties = {
  ...text.heading,
  margin: "0 0 12px",
};

const noteFrame: React.CSSProperties = {
  margin: "0 0 16px",
};
