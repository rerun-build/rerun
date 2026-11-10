import * as React from "react";
import { Heading, Section, Text } from "@react-email/components";
import { Layout } from "../components/Layout";
import { Button } from "../components/Button";
import { strong } from "../components/rich";
import { emailTranslator, type EmailLocale } from "../i18n";
import { theme, text } from "../theme";

export interface BudgetExhaustedProps {
  workspaceName: string | null;
  /** A capture of the workspace's board, signed by the sender. Without it the usual banner shows. */
  boardUrl?: string;
  appUrl: string;
  unsubscribeUrl?: string;
  locale?: EmailLocale;
}

export default function BudgetExhausted({
  workspaceName,
  boardUrl,
  appUrl,
  unsubscribeUrl,
  locale,
}: BudgetExhaustedProps) {
  const t = emailTranslator(locale);
  return (
    <Layout
      preview={t("budgetExhausted.preview")}
      hero={{ scene: "budget-exhausted", board: boardUrl }}
      appUrl={appUrl}
      unsubscribeUrl={unsubscribeUrl}
      locale={locale}
    >
      <Heading style={text.heading}>{t("budgetExhausted.heading")}</Heading>
      <Text style={text.paragraph}>
        {workspaceName
          ? t.rich("budgetExhausted.bodyNamed", { workspaceName, strong })
          : t("budgetExhausted.bodyUnnamed")}
      </Text>
      <Text style={hint}>{t("budgetExhausted.ownKeys")}</Text>
      <Section style={cta}>
        <Button href={appUrl}>{t("budgetExhausted.button")}</Button>
      </Section>
    </Layout>
  );
}

BudgetExhausted.PreviewProps = {
  workspaceName: "Acme",
  appUrl: "https://app.rerun.build",
} satisfies BudgetExhaustedProps;

const hint: React.CSSProperties = {
  ...text.footnote,
  borderLeft: `2px solid ${theme.surface.border}`,
  margin: "0 0 4px",
  paddingLeft: "12px",
};

const cta: React.CSSProperties = {
  margin: "24px 0 0",
};
