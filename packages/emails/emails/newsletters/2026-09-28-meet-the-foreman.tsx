import * as React from "react";
import { Text } from "@react-email/components";
import { newsletterMediaUrl } from "../../assets";
import {
  NewsletterLayout,
  type NewsletterMeta,
  type NewsletterProps,
} from "../../components/NewsletterLayout";
import { NewsletterNotes } from "../../components/NewsletterNotes";
import { NewsletterSection } from "../../components/NewsletterSection";
import { text } from "../../theme";

export const meta = {
  slug: "2026-09-28-meet-the-foreman",
  subject: "Meet the Foreman, right beside your board",
  preview:
    "Move agents between Boxes, tables drawn as galleries, and sign-in without a password.",
  date: "2026-09-28",
} as const satisfies NewsletterMeta;

export default function MeetTheForeman({
  appUrl,
  unsubscribeUrl,
}: NewsletterProps) {
  return (
    <NewsletterLayout
      meta={meta}
      title="Meet the Foreman, right beside your board"
      intro="Your board used to be something you arranged by hand, one panel at a time. This week it gets someone to talk to about it, and the pieces you arrange yourself got easier to move."
      appUrl={appUrl}
      unsubscribeUrl={unsubscribeUrl}
    >
      <NewsletterSection
        label="New"
        title="A chat that runs your board for you"
        body="The orb in the corner of your board opens the Foreman, a chat that knows every agent and every Box you have. Ask it to build an agent, open a tab, or move someone, and it does it on the board while you watch. @-mention an agent to talk about it, and dock the column left, right, or float it in a corner, wherever it bothers you least."
        image={{
          src: newsletterMediaUrl(meta.slug, "foreman.gif"),
          width: 456,
          alt: "Asked in the Foreman column, the Files tab of an agent slides open over the board",
          href: `${appUrl}/`,
        }}
        cta={{ href: `${appUrl}/`, label: "Talk to the Foreman" }}
      />

      <NewsletterSection
        label="New"
        title="Move an agent to another Box"
        body="Drag a tile from one Box to another, or pick Move to Box in its right-click menu. Its files, skills and history go with it, only its place on the board changes. The same menu now renames an agent, and @ in a conversation reaches every agent in the workspace, not just the ones in the same Box."
        image={{
          src: newsletterMediaUrl(meta.slug, "move-agent.gif"),
          width: 456,
          alt: "An agent tile dragged across the board from one Box into another",
          href: `${appUrl}/`,
        }}
        cta={{ href: `${appUrl}/`, label: "Rearrange your board" }}
      />

      <NewsletterSection
        label="New"
        title="Your data, drawn the way it reads best"
        body="When an agent shows you a table in the chat, it now picks the shape that fits: a gallery for products with pictures, a list for leads, columns grouped by status for a pipeline. Ask for another layout and it redraws the same rows."
        image={{
          src: newsletterMediaUrl(meta.slug, "gallery.png"),
          width: 456,
          alt: "A table card in the chat drawn as a gallery, each row a card with its image and price",
          href: `${appUrl}/`,
        }}
        cta={{ href: `${appUrl}/`, label: "Ask an agent for your data" }}
      />

      <NewsletterNotes
        title="Fixed and improved"
        notes={[
          {
            icon: "access",
            title: "Sign in without a password",
            body: "Type your email, then the 6-digit code or the link we send you.",
          },
          {
            icon: "setting",
            title: "Claude Opus 5.5 and GPT-6 are here",
            body: "Opus 5.5, GPT-6 Sol and GPT-6 Luna sit in the model picker.",
          },
          {
            icon: "chat",
            title: "A failed run tells you why",
            body: "The conversation shows the error instead of looking unanswered.",
          },
          {
            icon: "chat",
            title: "Long links stop eating the composer",
            body: "A pasted URL shrinks to a short chip, and sends in full.",
          },
          {
            icon: "file",
            title: "Flip through files with the arrow keys",
            body: "The file viewer steps through the folder without closing.",
          },
          {
            icon: "speed",
            title: "Fast after a long day",
            body: "The app stays responsive after hours of open conversations.",
          },
        ]}
      />

      <Text style={sign}>
        Written by a Moldwright agent, sent once a week. Reply to this email if
        something is broken or missing, it reaches a person.
      </Text>
    </NewsletterLayout>
  );
}

MeetTheForeman.PreviewProps = {
  appUrl: "https://moldwright.robagentic.tech",
  unsubscribeUrl: "https://moldwright.robagentic.tech/unsubscribe?token=preview",
} satisfies NewsletterProps;

const sign: React.CSSProperties = {
  ...text.footnote,
  margin: "28px 0 0",
};
