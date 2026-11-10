import * as React from "react";
import { Heading, Section, Text } from "@react-email/components";
import { Layout } from "../components/Layout";
import { Button } from "../components/Button";
import { MetaTable } from "../components/MetaTable";
import { strong } from "../components/rich";
import { emailTranslator, type EmailLocale } from "../i18n";
import { text } from "../theme";

export interface TrialFinalNoticeProps {
  /**
   * Whether Stripe holds a card for this trial. The two readers are in opposite situations: one is
   * about to be charged and must not be told their workspace is pausing, the other is about to see it paused.
   */
  hasCard: boolean;
  workspaceName: string | null;
  /** "12 March, 14:00 UTC", preformatted. */
  trialEndsLabel: string;
  /** When an unpaid workspace is paused, same format. */
  pausedLabel: string;
  /** Until when the paused workspace is saved, "11 June". Preformatted. */
  keptUntilLabel: string;
  billingUrl: string;
  /** A capture of the workspace's board, signed by the sender. Without it the usual banner shows. */
  boardUrl?: string;
  appUrl: string;
  unsubscribeUrl?: string;
  locale?: EmailLocale;
}

export default function TrialFinalNotice({
  hasCard,
  workspaceName,
  trialEndsLabel,
  pausedLabel,
  keptUntilLabel,
  billingUrl,
  boardUrl,
  appUrl,
  unsubscribeUrl,
  locale,
}: TrialFinalNoticeProps) {
  const t = emailTranslator(locale);
  const workspace = workspaceName ?? t("common.yourWorkspace");

  return (
    <Layout
      preview={
        hasCard
          ? t("trialFinalNotice.previewCard", { date: trialEndsLabel })
          : t("trialFinalNotice.previewNoCard", { date: trialEndsLabel })
      }
      hero={{ scene: "trial-ending", board: boardUrl }}
      appUrl={appUrl}
      unsubscribeUrl={unsubscribeUrl}
      locale={locale}
    >
      <Heading style={text.heading}>{t("trialFinalNotice.heading")}</Heading>
      {hasCard ? (
        <Text style={text.paragraph}>
          {t.rich("trialFinalNotice.bodyCard", { workspace, date: trialEndsLabel, strong })}
        </Text>
      ) : (
        <>
          <Text style={text.paragraph}>
            {t.rich("trialFinalNotice.noCard", { workspace, date: trialEndsLabel, strong })}
          </Text>
          <Text style={text.paragraph}>
            {t.rich("trialFinalNotice.noCardPause", { pausedAt: pausedLabel, keptUntil: keptUntilLabel, strong })}
          </Text>
        </>
      )}

      <Section style={meta}>
        <MetaTable
          rows={[
            { label: t("common.meta.workspace"), value: workspace },
            { label: t("common.meta.trialEnds"), value: trialEndsLabel },
            ...(hasCard ? [] : [{ label: t("common.meta.workspacePaused"), value: pausedLabel }]),
          ]}
        />
      </Section>

      <Section style={cta}>
        <Button href={billingUrl}>
          {hasCard ? t("trialFinalNotice.buttonCard") : t("trialFinalNotice.buttonNoCard")}
        </Button>
      </Section>
      {hasCard ? (
        <Text style={text.footnote}>
          {t("trialFinalNotice.footnoteCard", { date: trialEndsLabel })}
        </Text>
      ) : null}
    </Layout>
  );
}

TrialFinalNotice.PreviewProps = {
  hasCard: false,
  workspaceName: "Acme",
  trialEndsLabel: "12 March, 14:00 UTC",
  pausedLabel: "12 March, 16:00 UTC",
  keptUntilLabel: "10 June",
  billingUrl: "https://app.rerun.build/?billing=1",
  appUrl: "https://app.rerun.build",
} satisfies TrialFinalNoticeProps;

const meta: React.CSSProperties = {
  margin: "0 0 4px",
};

const cta: React.CSSProperties = {
  margin: "24px 0",
};
