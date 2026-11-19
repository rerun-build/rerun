import * as React from "react";
import { Text } from "@react-email/components";
import {
  NewsletterLayout,
  type NewsletterMeta,
  type NewsletterProps,
} from "../../components/NewsletterLayout";
import { NewsletterSection } from "../../components/NewsletterSection";
import { text } from "../../theme";

export const meta = {
  slug: "2026-09-03-tour-and-templates",
  subject: "Your agents now come with a map",
  preview: "A guided board, recommended templates, and fewer emails you did not ask for.",
  date: "2026-09-03",
} as const satisfies NewsletterMeta;

export default function TourAndTemplates({
  appUrl,
  unsubscribeUrl,
}: NewsletterProps) {
  return (
    <NewsletterLayout
      meta={meta}
      title="Your agents now come with a map"
      intro="Three things shipped this week, and all of them are about the same problem: knowing what to build first."
      appUrl={appUrl}
      unsubscribeUrl={unsubscribeUrl}
    >
      <NewsletterSection
        label="New"
        title="A guided tour of the board"
        body="First time on a Box, the isometric board now walks you through it: what an agent is, where its connectors plug in, and what happens when two of them talk to each other. Four slides, skippable, and it never comes back once you have seen it."
        cta={{ href: `${appUrl}/`, label: "Open your board" }}
      />

      <NewsletterSection
        label="Improved"
        title="Templates that show themselves"
        body="A recommended template used to be a name and a line of description. It now shows the card its author captured, so you can see the agents inside before you install anything."
      />

      <NewsletterSection
        label="Fixed"
        title="Fewer emails, better timed"
        body="Run notifications were capable of arriving three at a time from the same schedule. They are now capped per source and rolled into an hourly digest, and every one of them carries a working one-click unsubscribe."
        cta={{ href: unsubscribeUrl, label: "Review your email settings" }}
      />

      <Text style={sign}>
        Written by hand, sent once a week. Reply to this email if something is
        broken or missing, it reaches a person.
      </Text>
    </NewsletterLayout>
  );
}

TourAndTemplates.PreviewProps = {
  appUrl: "https://moldwright.robagentic.tech",
  unsubscribeUrl: "https://moldwright.robagentic.tech/unsubscribe?token=preview",
} satisfies NewsletterProps;

const sign: React.CSSProperties = {
  ...text.footnote,
  margin: "28px 0 0",
};
