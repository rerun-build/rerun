import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Inter, Noto_Sans_Arabic, Noto_Sans_Hebrew } from "next/font/google";
import "./globals.css";
import { cn } from "@/lib/utils";
import { site } from "@/lib/site";
import { brandIcons } from "@/lib/brand/icons";
import { getBrand } from "@/lib/brand/server";
import { BrandProvider } from "@/components/brand/BrandProvider";
import { BrandStyle } from "@/components/brand/BrandStyle";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AffiliateTracking } from "@rerun/cloud/support";
import { AppChrome } from "@/components/layout/AppChrome";
import { CookieConsent } from "@/components/layout/CookieConsent";
import { DeployUpdateWatcher } from "@/components/deploy-update/DeployUpdateWatcher";
import { DesktopShellBridge } from "@/components/desktop-shell/DesktopShellBridge";
import { OpenInDesktopPrompt } from "@/components/desktop-shell/OpenInDesktopPrompt";
import { PageAttentionWatcher } from "@/components/layout/PageAttentionWatcher";
import { ShellTitleBar } from "@/components/desktop-shell/ShellTitleBar";
import { requestDesktopShell } from "@/lib/desktop-shell/server";
import { DESKTOP_SHELL_ATTRIBUTE, isWhiteLabel, TRIAL_DAYS, WHITE_LABEL_ATTRIBUTE } from "@rerun/contracts";
import { DomMutationGuard } from "@rerun/ui/dom-guard";
import { RegisterSW } from "@/components/pwa/RegisterSW";
import { ThemeCookieBootstrap, ThemeProvider } from "@rerun/ui/theme";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages, getTranslations } from "next-intl/server";
import { TimeZoneCookie } from "@/components/layout/TimeZoneCookie";
import { UiLocaleProvider } from "@rerun/ui/locale";
import { localeDirection } from "@rerun/i18n";

const inter = Inter({subsets:['latin'],variable:'--font-inter'});

// Inter has no Arabic nor Hebrew glyphs: these come next in `--font-sans`, and their unicode-range keeps
// them off the wire for a page that has none of those letters. Chinese uses the system's fonts.
const notoArabic = Noto_Sans_Arabic({ subsets: ["arabic"], variable: "--font-noto-arabic", preload: false });
const notoHebrew = Noto_Sans_Hebrew({ subsets: ["hebrew"], variable: "--font-noto-hebrew", preload: false });

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export async function generateMetadata(): Promise<Metadata> {
  const [t, brand] = await Promise.all([getTranslations("layout.site"), getBrand()]);
  const titleTemplate = `%s | ${brand.name}`;
  const title = t("title");
  const description = t("description", { trialDays: TRIAL_DAYS });
  const ogImages = isWhiteLabel(brand) ? [] : [{ url: site.ogImage, ...site.ogImageSize, alt: title }];
  return {
    title: {
      default: title,
      template: titleTemplate,
    },
    description,
    applicationName: brand.name,
    keywords: [brand.name, "AI agents", "autonomous agents", "agent orchestration", "AI workforce", "no-code agents"],
    authors: [{ name: brand.name }],
    metadataBase: new URL(site.url),
    icons: brandIcons(brand),
    // iOS Safari otherwise wraps what looks like a phone number or an address in a link before React
    // hydrates, and the markup no longer matches the server's (React error #418).
    formatDetection: { telephone: false, email: false, address: false },
    // Next resolves the OpenGraph and Twitter titles against their own template, never against
    // `title.template`, so the suffix has to be declared here for child pages to inherit it.
    openGraph: {
      type: "website",
      siteName: brand.name,
      title: { default: title, template: titleTemplate },
      description,
      images: ogImages,
    },
    twitter: {
      card: ogImages.length ? "summary_large_image" : "summary",
      title: { default: title, template: titleTemplate },
      description,
      images: ogImages.map(({ url }) => url),
    },
    appleWebApp: {
      capable: true,
      statusBarStyle: "black-translucent",
      title: brand.name,
    },
  };
}

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fafafa" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0a" },
  ],
  viewportFit: "cover",
  // Chrome Android otherwise leaves the layout viewport at its full height under an open keyboard,
  // so `dvh` and anything `fixed` keep sizing against a screen half of which is the keyboard.
  interactiveWidget: "resizes-content",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const [locale, messages, desktopShell, brand] = await Promise.all([getLocale(), getMessages(), requestDesktopShell(), getBrand()]);
  return (
    <html
      lang={locale}
      dir={localeDirection(locale)}
      suppressHydrationWarning
      {...(isWhiteLabel(brand) ? { [WHITE_LABEL_ATTRIBUTE]: '' } : {})}
      {...(desktopShell ? { [DESKTOP_SHELL_ATTRIBUTE]: desktopShell.platform } : {})}
      className={cn("h-full", "antialiased", geistSans.variable, geistMono.variable, "font-sans", inter.variable, notoArabic.variable, notoHebrew.variable)}
    >
      <head>
        <BrandStyle brand={brand} />
      </head>
      <body className="min-h-full flex flex-col">
        {desktopShell && <ShellTitleBar />}
        <DomMutationGuard />
        <ThemeCookieBootstrap />
        <script
          dangerouslySetInnerHTML={{
            __html: `window.__pwaPrompt=null;addEventListener('beforeinstallprompt',function(e){e.preventDefault();window.__pwaPrompt=e;dispatchEvent(new Event('pwa-can-install'))});addEventListener('appinstalled',function(){window.__pwaPrompt=null;dispatchEvent(new Event('pwa-installed'))});`,
          }}
        />
        <BrandProvider brand={brand}>
          <NextIntlClientProvider>
            <UiLocaleProvider locale={locale} messages={{ kit: messages.kit }}>
              <TimeZoneCookie />
              <ThemeProvider>
                <TooltipProvider>
                  {children}
                  <Toaster />
                  <AppChrome>
                    <CookieConsent />
                    {!isWhiteLabel(brand) && <AffiliateTracking />}
                    <DeployUpdateWatcher />
                    <DesktopShellBridge />
                    <PageAttentionWatcher />
                    {!isWhiteLabel(brand) && <OpenInDesktopPrompt />}
                    <RegisterSW />
                  </AppChrome>
                </TooltipProvider>
              </ThemeProvider>
            </UiLocaleProvider>
          </NextIntlClientProvider>
        </BrandProvider>
      </body>
    </html>
  );
}
