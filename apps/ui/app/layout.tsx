import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Inter } from "next/font/google";
import "./globals.css";
import { cn } from "@/lib/utils";
import { site } from "@/lib/site";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AffiliateTracking } from "@rerun/cloud/support";
import { AppChrome } from "@/components/layout/AppChrome";
import { CookieConsent } from "@/components/layout/CookieConsent";
import { DeployUpdateWatcher } from "@/components/deploy-update/DeployUpdateWatcher";
import { DesktopShellBridge } from "@/components/desktop-shell/DesktopShellBridge";
import { OpenInDesktopPrompt } from "@/components/desktop-shell/OpenInDesktopPrompt";
import { ShellTitleBar } from "@/components/desktop-shell/ShellTitleBar";
import { requestDesktopShell } from "@/lib/desktop-shell/server";
import { DESKTOP_SHELL_ATTRIBUTE } from "@rerun/contracts";
import { DomMutationGuard } from "@rerun/ui/dom-guard";
import { RegisterSW } from "@/components/pwa/RegisterSW";
import { ThemeCookieBootstrap, ThemeProvider } from "@rerun/ui/theme";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";
import { TimeZoneCookie } from "@/components/layout/TimeZoneCookie";
import { UiLocaleProvider } from "@rerun/ui/locale";

const inter = Inter({subsets:['latin'],variable:'--font-sans'});

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: site.title,
    template: site.titleTemplate,
  },
  description: site.description,
  applicationName: site.name,
  keywords: ["Moldwright", "AI agents", "autonomous agents", "agent orchestration", "AI workforce", "no-code agents"],
  authors: [{ name: site.name }],
  metadataBase: new URL(site.url),
  formatDetection: { telephone: false, email: false, address: false },
  openGraph: {
    type: "website",
    siteName: site.name,
    title: { default: site.title, template: site.titleTemplate },
    description: site.description,
    images: [
      { url: site.ogImage, ...site.ogImageSize, alt: site.title },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: { default: site.title, template: site.titleTemplate },
    description: site.description,
    images: [site.ogImage],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: site.name,
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fafafa" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0a" },
  ],
  viewportFit: "cover",
  interactiveWidget: "resizes-content",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const [locale, messages, desktopShell] = await Promise.all([getLocale(), getMessages(), requestDesktopShell()]);
  return (
    <html
      lang={locale}
      suppressHydrationWarning
      {...(desktopShell ? { [DESKTOP_SHELL_ATTRIBUTE]: desktopShell.platform } : {})}
      className={cn("h-full", "antialiased", geistSans.variable, geistMono.variable, "font-sans", inter.variable)}
    >
      <body className="min-h-full flex flex-col">
        {desktopShell && <ShellTitleBar />}
        <DomMutationGuard />
        <ThemeCookieBootstrap />
        <script
          dangerouslySetInnerHTML={{
            __html: `window.__pwaPrompt=null;addEventListener('beforeinstallprompt',function(e){e.preventDefault();window.__pwaPrompt=e;dispatchEvent(new Event('pwa-can-install'))});addEventListener('appinstalled',function(){window.__pwaPrompt=null;dispatchEvent(new Event('pwa-installed'))});`,
          }}
        />
        <NextIntlClientProvider>
          <UiLocaleProvider locale={locale} messages={{ kit: messages.kit }}>
            <TimeZoneCookie />
            <ThemeProvider>
              <TooltipProvider>
                {children}
                <Toaster />
                <AppChrome>
                  <CookieConsent />
                  <AffiliateTracking />
                  <DeployUpdateWatcher />
                  <DesktopShellBridge />
                  <OpenInDesktopPrompt />
                  <RegisterSW />
                </AppChrome>
              </TooltipProvider>
            </ThemeProvider>
          </UiLocaleProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
