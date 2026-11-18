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
  slug: "2026-09-04-voice-and-uploads",
  subject: "Talk to your agents, skip the typing",
  preview:
    "Reliable uploads, precise Box placement, and clearer agent states.",
  date: "2026-09-04",
} as const satisfies NewsletterMeta;

export default function VoiceAndUploads({
  appUrl,
  unsubscribeUrl,
}: NewsletterProps) {
  return (
    <NewsletterLayout
      meta={meta}
      title="Talk to your agents, skip the typing"
      note="This is the first Moldwright newsletter. Once a week you get one short email: what we shipped, tips to get more out of your agents, and what we learn building them. Nothing else, and the unsubscribe link at the bottom works from day one."
      intro="You can now talk to an agent instead of typing. The rest of this week's work gives you more control over the board, from individual file transfers to the exact spot where a new Box lands."
      appUrl={appUrl}
      unsubscribeUrl={unsubscribeUrl}
    >
      <NewsletterSection
        label="New"
        title="Speak instead of typing"
        body="Tap the mic, say what you need, then send. Moldwright transcribes the recording for your agent and keeps the original audio in the conversation."
        image={{
          src: newsletterMediaUrl(meta.slug, "voice-messages.gif"),
          width: 456,
          alt: "A Moldwright chat composer recording a voice message with an animated waveform",
          href: `${appUrl}/`,
        }}
        cta={{ href: `${appUrl}/`, label: "Talk to an agent" }}
      />

      <NewsletterSection
        label="Improved"
        title="Upload without babysitting files"
        body="Each file now shows its own progress and ETA, with controls to cancel or retry it. Uploads stream straight to your Box. A large transfer no longer ties up the interface or hides behind one generic loading state."
        image={{
          src: newsletterMediaUrl(meta.slug, "uploads-extended.png"),
          width: 456,
          alt: "The expanded upload tray showing per-file progress, errors, cancel, and retry controls",
          href: `${appUrl}/`,
        }}
        cta={{ href: `${appUrl}/`, label: "Upload your files" }}
      />

      <NewsletterSection
        label="New"
        title="Place each Box where it belongs"
        body="Hover a free side of an existing Box to see where the next one will land, then place it there. No more automatic stacking at the bottom of the board."
        cta={{ href: `${appUrl}/`, label: "Open your board" }}
      />

      <NewsletterSection
        label="Improved"
        title="Idle agents finally look idle"
        body="Idle agents have dropped the blue. They now pick up the neutral color of the theme, while movement and stronger color stay reserved for work in progress."
      />

      <Text style={sign}>
        Written by a Moldwright agent. Reply to this email if something is broken
        or missing, it reaches a person.
      </Text>
    </NewsletterLayout>
  );
}

VoiceAndUploads.PreviewProps = {
  appUrl: "https://app.rerun.build",
  unsubscribeUrl: "https://app.rerun.build/unsubscribe?token=preview",
} satisfies NewsletterProps;

const sign: React.CSSProperties = {
  ...text.footnote,
  margin: "28px 0 0",
};
