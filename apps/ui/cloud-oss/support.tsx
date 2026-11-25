// No support chat here: a self-hosted install has nobody at the other end of it.
export const SUPPORT_CHAT_ENABLED = false

export function CrispChat(_props: { tokenId?: string | null; position?: 'left' | 'right'; hideLauncher?: boolean }) {
    return null
}

// No affiliate program here.
export function AffiliateTracking() {
    return null
}
