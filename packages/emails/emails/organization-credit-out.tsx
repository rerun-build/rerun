import * as React from "react";
import { Heading, Section, Text } from "@react-email/components";
import { Layout } from "../components/Layout";
import { Button } from "../components/Button";
import { strong } from "../components/rich";
import type { Brand } from "@rerun/contracts";
import { emailTranslator, type EmailLocale } from "../i18n";
import { text } from "../theme";

export interface OrganizationCreditOutProps {
  workspaceName: string | null;
  /** The console, on the workspace that ran out. */
  consoleUrl: string;
  /** A capture of the workspace's board, signed by the sender. Without it the usual banner shows. */
  boardUrl?: string;
  appUrl: string;
  locale?: EmailLocale;
  brand?: Brand;
}

/** To the team of an organization: one of the workspaces it runs has no credit left. */
export default function OrganizationCreditOut({
  workspaceName,
  consoleUrl,
  boardUrl,
  appUrl,
  locale,
  brand,
}: OrganizationCreditOutProps) {
  const t = emailTranslator(locale, brand?.name);
  return (
    <Layout
      preview={t("organizationCreditOut.preview")}
      hero={{ scene: "budget-exhausted", board: boardUrl }}
      appUrl={appUrl}
      locale={locale}
      brand={brand}
    >
      <Heading style={text.heading}>{t("organizationCreditOut.heading")}</Heading>
      <Text style={text.paragraph}>
        {workspaceName
          ? t.rich("organizationCreditOut.bodyNamed", { workspaceName, strong })
          : t("organizationCreditOut.bodyUnnamed")}
      </Text>
      <Text style={text.paragraph}>{t("organizationCreditOut.members")}</Text>
      <Section style={cta}>
        <Button href={consoleUrl}>{t("organizationCreditOut.button")}</Button>
      </Section>
    </Layout>
  );
}

OrganizationCreditOut.PreviewProps = {
  workspaceName: "Acme",
  consoleUrl: "https://app.rerun.build/organization",
  appUrl: "https://app.rerun.build",
} satisfies OrganizationCreditOutProps;

const cta: React.CSSProperties = {
  margin: "24px 0 0",
};
