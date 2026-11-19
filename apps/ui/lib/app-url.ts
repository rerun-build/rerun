export const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://moldwright.robagentic.tech'

export function notificationUrl(notificationId: string): string {
    return `${APP_URL}/?notification=${encodeURIComponent(notificationId)}`
}
