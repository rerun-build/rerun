export type InAppBrowser = 'x' | 'instagram' | 'facebook' | 'linkedin' | 'tiktok' | 'whatsapp' | 'webview'

const NAMED_IN_APP_BROWSERS: [RegExp, InAppBrowser][] = [
    [/Twitter/i, 'x'],
    [/Instagram/i, 'instagram'],
    [/FBAN|FBAV|FB_IAB/, 'facebook'],
    [/LinkedInApp/i, 'linkedin'],
    [/musical_ly|Bytedance|TikTok/i, 'tiktok'],
    [/WA4A|WhatsApp/i, 'whatsapp'],
]

export function detectInAppBrowser(userAgent: string): InAppBrowser | null {
    for (const [pattern, browser] of NAMED_IN_APP_BROWSERS) {
        if (pattern.test(userAgent)) return browser
    }
    if (/; wv\)/.test(userAgent)) return 'webview'
    if (/AppleWebKit/.test(userAgent) && !/Safari\//.test(userAgent)) return 'webview'
    return null
}

export type MobileOs = 'ios' | 'android'

export function detectMobileOs(userAgent: string): MobileOs | null {
    if (/Android/i.test(userAgent)) return 'android'
    if (/iPhone|iPad|iPod/i.test(userAgent)) return 'ios'
    return null
}
