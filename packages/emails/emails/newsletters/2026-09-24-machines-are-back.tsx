import * as React from "react";
import { Heading, Section, Text } from "@react-email/components";
import { Button } from "../../components/Button";
import { Layout } from "../../components/Layout";
import type {
  NewsletterMeta,
  NewsletterProps,
} from "../../components/NewsletterLayout";
import { text } from "../../theme";

export const meta = {
  slug: "2026-09-24-machines-are-back",
  subject: "New Moldwright machines just opened up",
  preview: "A limited batch, first come, first served.",
  date: "2026-09-24",
  audience: "waitlist",
} as const satisfies NewsletterMeta;

export default function MachinesAreBack({
  appUrl,
  unsubscribeUrl,
}: NewsletterProps) {
  return (
    <Layout
      preview={meta.preview}
      hero={{ scene: "workspace-invite" }}
      appUrl={appUrl}
      unsubscribeUrl={unsubscribeUrl}
    >
      <Heading style={text.heading}>Machines are back</Heading>
      <Text style={text.paragraph}>
        You signed up for Moldwright while every machine was taken, so you landed
        on the waitlist. We just brought a new batch of machines online.
      </Text>
      <Text style={text.paragraph}>
        There aren&apos;t enough for everyone on the list. They go to whoever
        finishes setup first, and when they run out the waitlist comes back
        until the next batch.
      </Text>
      <Text style={text.paragraph}>
        Your answers from your first visit are saved, so you pick up right
        where you left off.
      </Text>
      <Section style={cta}>
        <Button href={appUrl}>Get my machine</Button>
      </Section>
      <Text style={text.footnote}>
        If you see the waitlist screen again, this batch is gone. The page
        unlocks on its own as soon as a machine frees up.
      </Text>
    </Layout>
  );
}

MachinesAreBack.PreviewProps = {
  appUrl: "https://moldwright.robagentic.tech",
  unsubscribeUrl: "https://moldwright.robagentic.tech/unsubscribe",
} satisfies NewsletterProps;

const cta: React.CSSProperties = {
  margin: "24px 0",
};
