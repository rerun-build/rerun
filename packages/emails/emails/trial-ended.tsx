import * as React from "react";
import { Heading, Section, Text } from "@react-email/components";
import { Layout } from "../components/Layout";
import { Button } from "../components/Button";
import { MetaTable } from "../components/MetaTable";
import { strong } from "../components/rich";
import { formatNumber } from "@rerun/i18n/format";
import { emailTranslator, type EmailLocale } from "../i18n";
import { text } from "../theme";

/**
 * What the trial actually produced. Left out for a workspace that did nothing, so the email makes
 * no claim rather than printing a row of zeros.
 */
export interface TrialSummary {
  agents: number;
  runs: number;
}

/**
 * Why the trial did not turn into a plan. A declined first charge is usually a card asking for a
 * 3-D Secure confirmation off-session: that person wants to pay, and the email says so.
 */
export type TrialEndedReason = "no_card" | "payment_failed";

export interface TrialEndedProps {
  reason: TrialEndedReason;
  workspaceName: string | null;
  /** "12 March", preformatted. */
  trialEndedLabel: string;
  /** When the workspace is paused, "13 March, 14:00 UTC" style. Preformatted. */
  pausedLabel: string;
  /** Until when the paused workspace is saved, "11 June". Preformatted. */
  keptUntilLabel: string;
  summary?: TrialSummary;
  /** Where the button goes: the open invoice for a declined charge, the plans page otherwise. */
  billingUrl: string;
  /** A capture of the workspace's board, signed by the sender. Without it the usual banner shows. */
  boardUrl?: string;
  appUrl: string;
  unsubscribeUrl?: string;
  locale?: EmailLocale;
}

/**
 * The one email that has to be read. Nothing is deleted at the end of a trial: the workspace is
 * paused and saved, and the email says until when, so that the date reads as a reason to come
 * back rather than a threat. The summary of what the trial produced sits right next to it: the
 * argument for staying is the work already done.
 */
export default function TrialEnded({
  reason,
  workspaceName,
  trialEndedLabel,
  pausedLabel,
  keptUntilLabel,
  summary,
  billingUrl,
  boardUrl,
  appUrl,
  unsubscribeUrl,
  locale,
}: TrialEndedProps) {
  const t = emailTranslator(locale);
  const workspace = workspaceName ?? t("common.yourWorkspace");

  return (
    <Layout
      preview={t("trialEnded.preview", { reason, pausedAt: pausedLabel })}
      hero={{ scene: "trial-ended", board: boardUrl }}
      appUrl={appUrl}
      unsubscribeUrl={unsubscribeUrl}
      locale={locale}
    >
      <Heading style={text.heading}>{t("trialEnded.heading", { reason })}</Heading>
      <Text style={text.paragraph}>
        {t.rich("trialEnded.ended", { reason, workspace, date: trialEndedLabel, strong })}
      </Text>
      <Text style={text.paragraph}>
        {t.rich("trialEnded.paused", { reason, pausedAt: pausedLabel, keptUntil: keptUntilLabel, strong })}
      </Text>

      <Section style={meta}>
        <MetaTable
          rows={[
            { label: t("common.meta.trialEnded"), value: trialEndedLabel },
            { label: t("common.meta.workspacePaused"), value: pausedLabel },
            { label: t("common.meta.savedUntil"), value: keptUntilLabel },
            ...(summary
              ? [
                  { label: t("common.meta.coworkers"), value: formatNumber(summary.agents, locale) },
                  { label: t("common.meta.runs"), value: formatNumber(summary.runs, locale) },
                ]
              : []),
          ]}
        />
      </Section>

      <Section style={cta}>
        <Button href={billingUrl}>{t("trialEnded.button", { reason })}</Button>
      </Section>
      <Text style={text.footnote}>{t("trialEnded.footnote", { keptUntil: keptUntilLabel })}</Text>
    </Layout>
  );
}

TrialEnded.PreviewProps = {
  reason: "no_card",
  workspaceName: "Acme",
  trialEndedLabel: "12 March",
  pausedLabel: "12 March, 16:00 UTC",
  keptUntilLabel: "10 June",
  summary: { agents: 3, runs: 41 },
  billingUrl: "https://app.rerun.build/?billing=1",
  appUrl: "https://app.rerun.build",
} satisfies TrialEndedProps;

const meta: React.CSSProperties = {
  margin: "0 0 4px",
};

const cta: React.CSSProperties = {
  margin: "24px 0",
};
