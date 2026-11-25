import { randomBytes } from 'node:crypto'
import type { ActionRefusal } from '@/lib/i18n/action-error'
import { getTranslations } from 'next-intl/server'
import { NextResponse } from 'next/server'

const HTML_ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }

export const escapeHtml = (value: string): string => value.replace(/[&<>"']/g, char => HTML_ESCAPES[char]!)

// JSON.stringify leaves `<`, `>` and `&` alone, so a value holding `</script>` would close the
// script block it is printed into. U+2028/2029 are line terminators for JavaScript but not for JSON.
export const scriptSafeJson = (value: unknown): string =>
    JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')

export type OAuthPopupResult = { channel: string; message: Record<string, unknown>; label: string }

// The page an OAuth popup lands on after the provider redirects back. The provider's error text and
// the connected account's label end up in it, so every value is escaped for the context it is
// printed into, and the page carries a CSP that only runs the script it was born with.
export function oauthPopupResponse({ channel, message, label }: OAuthPopupResult): NextResponse {
    const nonce = randomBytes(16).toString('base64')
    // Providers that set Cross-Origin-Opener-Policy: same-origin on their authorize page
    // (e.g. Waalaxy) sever window.opener, so postMessage never reaches the app. BroadcastChannel
    // is same-origin and unaffected, so it delivers the result regardless of the opener link.
    const html = `<!doctype html><meta charset="utf-8">
<style nonce="${nonce}">body{font:14px system-ui;padding:24px}</style>
<body>
<script nonce="${nonce}">
  var msg = ${scriptSafeJson(message)}
  try { new BroadcastChannel(${scriptSafeJson(channel)}).postMessage(msg) } catch (e) {}
  try { if (window.opener) window.opener.postMessage(msg, window.location.origin) } catch (e) {}
  setTimeout(function () { try { window.close() } catch (e) {} }, 400)
</script>
<p>${escapeHtml(label)}</p>
</body>`
    return new NextResponse(html, {
        headers: {
            'Content-Type': 'text/html; charset=utf-8',
            'Content-Security-Policy': `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
            'X-Content-Type-Options': 'nosniff',
            'Referrer-Policy': 'no-referrer',
            'Cache-Control': 'no-store',
        },
    })
}

// The line a finished sign-in popup shows while it closes, in the reader's language. `account` is the
// address or the name the provider gave for who signed in.
export async function popupSuccessLabel(account?: string | null): Promise<string> {
    const t = await getTranslations('services.signInPopup')
    return account ? t('connectedAs', { account }) : t('connected')
}

// The line a failed sign-in popup shows while it closes, in the reader's language.
export async function popupFailureLabel(refusal: ActionRefusal): Promise<string> {
    const t = await getTranslations('errors')
    return t('authorizationFailedBecause', { reason: refusal.code ? t(refusal.code, refusal.params as never) : refusal.error })
}
