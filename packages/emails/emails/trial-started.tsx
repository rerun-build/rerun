import * as React from "react";
import { Heading, Section, Text } from "@react-email/components";
import { Layout } from "../components/Layout";
import { Button } from "../components/Button";
import { MetaTable } from "../components/MetaTable";
import { strong } from "../components/rich";
import { emailTranslator, type EmailLocale } from "../i18n";
import { text } from "../theme";

export interface TrialStartedProps {
  workspaceName: string | null;
  trialDays: number;
  trialEndsLabel: string;
  monthlyPriceLabel: string;
  includedLabel: string;
  hasCard?: boolean;
  workspaceUrl: string;
  boardUrl?: string;
  appUrl: string;
  unsubscribeUrl?: string;
  locale?: EmailLocale;
}

export default function TrialStarted({
  workspaceName,
  trialDays,
  trialEndsLabel,
  monthlyPriceLabel,
  includedLabel,
  hasCard = true,
  workspaceUrl,
  boardUrl,
  appUrl,
  unsubscribeUrl,
  locale,
}: TrialStartedProps) {
  const t = emailTranslator(locale);
  const workspace = workspaceName ?? t("common.yourWorkspace");

  return (
    <Layout
      preview={t("trialStarted.preview", { trialDays })}
      hero={{ scene: "trial-started", board: boardUrl }}
      appUrl={appUrl}
      unsubscribeUrl={unsubscribeUrl}
      locale={locale}
    >
      <Heading style={text.heading}>{t("trialStarted.heading")}</Heading>
      <Text style={text.paragraph}>
        {t.rich("trialStarted.body", { workspace, trialDays, strong })}
      </Text>

      <Section style={meta}>
        <MetaTable
          rows={[
            { label: t("common.meta.workspace"), value: workspace },
            { label: t("common.meta.included"), value: includedLabel },
            { label: t("common.meta.trialEnds"), value: trialEndsLabel },
            { label: t("common.meta.then"), value: t("trialStarted.perMonth", { price: monthlyPriceLabel }) },
          ]}
        />
      </Section>

      <Section style={cta}>
        <Button href={workspaceUrl}>{t("trialStarted.button")}</Button>
      </Section>
      <Text style={text.footnote}>
        {hasCard
          ? t("trialStarted.footnoteCard", { date: trialEndsLabel, price: monthlyPriceLabel })
          : t("trialStarted.footnoteNoCard", { date: trialEndsLabel, price: monthlyPriceLabel })}
      </Text>
    </Layout>
  );
}

TrialStarted.PreviewProps = {
  workspaceName: "Acme",
  trialDays: 5,
  trialEndsLabel: "12 March",
  monthlyPriceLabel: "$49",
  includedLabel: "3 coworkers and 350 credits",
  workspaceUrl: "https://moldwright.robagentic.tech",
  appUrl: "https://moldwright.robagentic.tech",
  unsubscribeUrl: "https://moldwright.robagentic.tech/unsubscribe",
} satisfies TrialStartedProps;

const meta: React.CSSProperties = {
  margin: "0 0 4px",
};

const cta: React.CSSProperties = {
  margin: "24px 0",
};
