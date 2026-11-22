import 'server-only'

import { createHash, timingSafeEqual } from 'node:crypto'

const TELLA_AUTO_CAPTURE_HEADER = 'x-tella-auto-capture'

const digest = (value: string) => createHash('sha256').update(value).digest()

// Tella Auto Capture drives a browser to film the app and cannot solve a captcha. It sends its
// workspace's secret in this header on every request, which the page's JavaScript never sees.
// Compared on digests so neither the value nor its length leaks through timing.
export function isTellaAutoCapture(requestHeaders: Headers): boolean {
    const secret = process.env.TELLA_AUTO_CAPTURE_SECRET
    const given = requestHeaders.get(TELLA_AUTO_CAPTURE_HEADER)
    if (!secret || !given) return false
    return timingSafeEqual(digest(given), digest(secret))
}
