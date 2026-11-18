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
  slug: "2026-09-18-what-your-agent-thinks",
  subject: "See what your agent is thinking",
  preview:
    "Tiles that name their state, tool calls that wear their logo, and an error with a Reconnect button.",
  date: "2026-09-18",
} as const satisfies NewsletterMeta;

export default function WhatYourAgentThinks({
  appUrl,
  unsubscribeUrl,
}: NewsletterProps) {
  return (
    <NewsletterLayout
      meta={meta}
      title="See what your agent is thinking"
      intro="An agent that works without saying anything is hard to trust. Everything that shipped this week is about the same thing: reading what is going on, on the board and in the chat, without opening anything."
      appUrl={appUrl}
      unsubscribeUrl={unsubscribeUrl}
    >
      <NewsletterSection
        label="New"
        title="Read the reasoning behind an answer"
        body="The thinking block was in the chat, but no provider was ever asked to produce one, so it never showed up. Each is now asked in its own dialect, the Claude CLI, Codex, Anthropic, OpenAI, Google and OpenRouter included, and the thought opens above the answer it led to. It stays out of your search index and out of a run's output, since a thought belongs to the turn that had it."
        image={{
          src: newsletterMediaUrl(meta.slug, "thinking.png"),
          width: 456,
          alt: "A folded Thought for 12s line above an answer, opened on the model weighing what to do first",
          href: `${appUrl}/`,
        }}
        cta={{ href: `${appUrl}/`, label: "Open a conversation" }}
      />

      <NewsletterSection
        label="Improved"
        title="Your board says what it means"
        body="A tile only ever spoke through its colour, and nothing told you what amber or cyan stood for. Hovering one now names its state, and a cyan or red tile carries the number of conversations sitting in its To handle tab, so you can count what needs you without opening a single agent. The whole board also stops moving when the tab is hidden or the window goes behind another app, which your fan will notice before you do."
        image={{
          src: newsletterMediaUrl(meta.slug, "board.gif"),
          width: 456,
          alt: "Hovering three agent tiles on the board, each naming its state, the cyan one counting three conversations waiting",
          href: `${appUrl}/`,
        }}
        cta={{ href: `${appUrl}/`, label: "Open your board" }}
      />

      <NewsletterNotes
        title="Fixed and improved"
        notes={[
          {
            icon: "chat",
            title: "Tell an agent a rule once",
            body: "It offers to write the rule into a skill, in the same turn.",
          },
          {
            icon: "connector",
            title: "An expired token offers a Reconnect button",
            body: "The chat names the connection that ran out, not a stack trace.",
          },
          {
            icon: "display",
            title: "A run reads without unfolding it",
            body: "Tool rows stay folded while they run, and a connector call wears its logo.",
          },
          {
            icon: "file",
            title: "Attach a file to an answer",
            body: "A question from an agent now takes documents back, not just words.",
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

WhatYourAgentThinks.PreviewProps = {
  appUrl: "https://app.rerun.build",
  unsubscribeUrl: "https://app.rerun.build/unsubscribe?token=preview",
} satisfies NewsletterProps;

const sign: React.CSSProperties = {
  ...text.footnote,
  margin: "28px 0 0",
};
