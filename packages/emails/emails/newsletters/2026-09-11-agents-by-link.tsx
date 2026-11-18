import * as React from "react";
import { Text } from "@react-email/components";
import { newsletterMediaUrl } from "../../assets";
import {
  NewsletterLayout,
  type NewsletterMeta,
  type NewsletterProps,
} from "../../components/NewsletterLayout";
import { NewsletterSection } from "../../components/NewsletterSection";
import { text } from "../../theme";

export const meta = {
  slug: "2026-09-11-agents-by-link",
  subject: "Hand someone one of your agents",
  preview:
    "Queued messages, an editor for your files, and attachments you can finally see.",
  date: "2026-09-11",
} as const satisfies NewsletterMeta;

export default function AgentsByLink({
  appUrl,
  unsubscribeUrl,
}: NewsletterProps) {
  return (
    <NewsletterLayout
      meta={meta}
      title="Hand someone one of your agents"
      intro="Until this week, an agent you built could only ever run on your own board. It now travels: one link, and someone else gets a working copy of it."
      appUrl={appUrl}
      unsubscribeUrl={unsubscribeUrl}
    >
      <NewsletterSection
        label="New"
        title="Send an agent to someone by link"
        body="Open Share agent in the panel rail, decide whether its memories, its database and its files travel with it, and you get a link. Whoever opens it sees the card above, then drops a working copy on their own board with your API keys and your connected accounts left behind. The copy is frozen the moment you create the link, so renaming or deleting your own agent afterwards changes nothing for them."
        image={{
          src: newsletterMediaUrl(meta.slug, "share-card.png"),
          width: 456,
          alt: "The card a share link opens on: the agent on an isometric board, what it comes with, and an Add to my board button",
          href: `${appUrl}/`,
        }}
        cta={{ href: `${appUrl}/`, label: "Share an agent" }}
      />

      <NewsletterSection
        label="New"
        title="Write while your agent is working"
        body="A message typed during a run used to be turned away. It now waits in a strip above the composer and leaves on its own the second the run ends. Send now stops the run and sends immediately, and a queued message follows you from one tab to the next."
        image={{
          src: newsletterMediaUrl(meta.slug, "queued.gif"),
          width: 456,
          alt: "A message waiting in a Queued strip above the composer, then sent on its own when the run finishes",
          href: `${appUrl}/`,
        }}
        cta={{ href: `${appUrl}/`, label: "Open your board" }}
      />

      <NewsletterSection
        label="New"
        title="Edit a file without leaving Moldwright"
        body="A file in the Files panel now opens in a real editor, syntax highlighting included, so a two-word correction no longer means downloading it, fixing it and sending it back. If one of your agents rewrote the file while you had it open, you are told before anything is overwritten."
        cta={{ href: `${appUrl}/`, label: "Open your files" }}
      />

      <NewsletterSection
        label="Improved"
        title="See what you attached"
        body="Files sent with a message now show up as thumbnails above the bubble instead of a line of raw text, and a click opens them full size. Dropping a whole folder into the composer works too, subfolders and all, and a file that failed to transfer stops the send instead of leaving silently without it."
      />

      <NewsletterSection
        label="Improved"
        title="New models, already on the shelf"
        body="Every provider catalog has been refreshed, GPT-6 Astra and the 1M context variants included, with their power ratings and context windows brought up to date. Claude and OpenRouter now start on Sonnet 5."
        cta={{ href: `${appUrl}/`, label: "Pick a model" }}
      />

      <NewsletterSection
        label="Improved"
        title="Fewer tabs in the agent panel"
        body="Connectors and MCP, Database and Memories, Scheduled and Triggers, Monitoring and Logs: each pair now shares a single button, with a switch under the panel header to move between the two. Expert mode is gone, so no tab is hidden behind a setting anymore."
      />

      <Text style={sign}>
        Written by a Moldwright agent, sent once a week. Reply to this email if
        something is broken or missing, it reaches a person.
      </Text>
    </NewsletterLayout>
  );
}

AgentsByLink.PreviewProps = {
  appUrl: "https://app.rerun.build",
  unsubscribeUrl: "https://app.rerun.build/unsubscribe?token=preview",
} satisfies NewsletterProps;

const sign: React.CSSProperties = {
  ...text.footnote,
  margin: "28px 0 0",
};
