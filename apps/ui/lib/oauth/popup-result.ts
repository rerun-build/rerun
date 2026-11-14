import { randomBytes } from 'node:crypto'
import { NextResponse } from 'next/server'

const HTML_ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }

export const escapeHtml = (value: string): string => value.replace(/[&<>"']/g, char => HTML_ESCAPES[char]!)

export const scriptSafeJson = (value: unknown): string =>
    JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')

export type OAuthPopupResult = { channel: string; message: Record<string, unknown>; label: string }

export function oauthPopupResponse({ channel, message, label }: OAuthPopupResult): NextResponse {
    const nonce = randomBytes(16).toString('base64')
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
