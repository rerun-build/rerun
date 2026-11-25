import * as React from "react";
import { AlertMessage } from "../components/AlertMessage";
import { emailTranslator, type EmailLocale } from "../i18n";

export interface AppNoticeProps {
  appName: string;
  message: string;
  appUrl: string;
  unsubscribeUrl?: string;
  locale?: EmailLocale;
}

/** News of a paid app that costs money or stops the coworkers using it. */
export default function AppNotice({ appName, message, appUrl, unsubscribeUrl, locale }: AppNoticeProps) {
  const t = emailTranslator(locale);
  return (
    <AlertMessage
      hero={{ variant: "connector" }}
      heading={t("subjects.appNotice", { appName })}
      body={message}
      action={{ label: t("common.openRerun"), href: appUrl }}
      appUrl={appUrl}
      unsubscribeUrl={unsubscribeUrl}
      locale={locale}
    />
  );
}

AppNotice.PreviewProps = {
  appName: "LinkedIn",
  message: "The trial of LinkedIn ends tomorrow. Add a card to keep it connected.",
  appUrl: "https://app.rerun.build",
} satisfies AppNoticeProps;
