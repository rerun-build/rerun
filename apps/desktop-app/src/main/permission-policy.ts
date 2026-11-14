const GRANTED_TO_APP = new Set([
    'notifications',
    'clipboard-read',
    'clipboard-sanitized-write',
    'fullscreen',
    'display-capture',
])

export type PermissionRequest = {
    permission: string
    requestingOrigin: string
    mediaTypes?: readonly string[]
    mediaType?: string
}

export function decidePermission(request: PermissionRequest, serverOrigin: string | null): boolean {
    if (!serverOrigin || request.requestingOrigin !== serverOrigin) return false
    if (request.permission === 'media') {
        if (request.mediaTypes) return request.mediaTypes.length > 0 && request.mediaTypes.every((type) => type === 'audio')
        return request.mediaType !== 'video'
    }
    return GRANTED_TO_APP.has(request.permission)
}
