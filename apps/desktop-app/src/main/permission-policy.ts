// What the web app may ask of the machine, decided without Electron. Electron grants every
// permission unless a handler says otherwise, so the default here is no, for any origin but the
// server's, and for the server only what one of its features uses.

const GRANTED_TO_APP = new Set([
    // Agent and assistant notifications.
    'notifications',
    // Pasting a code back (Claude plan) and into a coworker's screen; the copy buttons.
    'clipboard-read',
    'clipboard-sanitized-write',
    'fullscreen',
    // The screenshot attached to a message, through the system's own picker.
    'display-capture',
])

export type PermissionRequest = {
    permission: string
    requestingOrigin: string
    // For `media`: what the page asks for. Only the microphone is ever granted (voice notes).
    mediaTypes?: readonly string[]
    mediaType?: string
}

export function decidePermission(request: PermissionRequest, serverOrigin: string | null): boolean {
    if (!serverOrigin || request.requestingOrigin !== serverOrigin) return false
    if (request.permission === 'media') {
        if (request.mediaTypes) return request.mediaTypes.length > 0 && request.mediaTypes.every((type) => type === 'audio')
        // A permission check (no capture yet) only names one kind, and `unknown` for device listing.
        return request.mediaType !== 'video'
    }
    return GRANTED_TO_APP.has(request.permission)
}
