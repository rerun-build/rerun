export const COOKIE_SETTINGS_EVENT = 'rerun:cookie-settings'

export function openCookieSettings() {
    window.dispatchEvent(new CustomEvent(COOKIE_SETTINGS_EVENT))
}
