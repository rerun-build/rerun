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
  keywords: ["Rerun", "AI agents", "autonomous agents", "agent orchestration", "AI workforce", "no-code agents"],
  authors: [{ name: site.name }],
  metadataBase: new URL(site.url),
  // iOS Safari otherwise wraps what looks like a phone number or an address in a link before React
  // hydrates, and the markup no longer matches the server's (React error #418).
  formatDetection: { telephone: false, email: false, address: false },
  // Next resolves the OpenGraph and Twitter titles against their own template, never against
  // `title.template`, so the suffix has to be declared here for child pages to inherit it.
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
  // Chrome Android otherwise leaves the layout viewport at its full height under an open keyboard,
  // so `dvh` and anything `fixed` keep sizing against a screen half of which is the keyboard.
  interactiveWidget: "resizes-content",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const [locale, messages] = await Promise.all([getLocale(), getMessages()]);
  return (
    <html
      lang={locale}
      suppressHydrationWarning
      className={cn("h-full", "antialiased", geistSans.variable, geistMono.variable, "font-sans", inter.variable)}
    >
      <body className="min-h-full flex flex-col">
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
