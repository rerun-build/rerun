export const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.rerun.build'

// The board reads it once hydrated and opens the conversation the notification is about.
export function notificationUrl(notificationId: string, appUrl: string = APP_URL): string {
    return `${appUrl}/?notification=${encodeURIComponent(notificationId)}`
}
