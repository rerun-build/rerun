'use client'

import { useBrand } from '@/components/brand/BrandProvider'
import { openCrisp, sendToCrisp } from '@/lib/crisp'
import { useSession } from '@/supabase/session/SessionProvider'
import { isWhiteLabel } from '@rerun/contracts'
import { SUPPORT_CHAT_ENABLED } from '@rerun/cloud/support'

function mailTo(address: string, body?: string) {
    window.location.assign(`mailto:${address}${body ? `?body=${encodeURIComponent(body)}` : ''}`)
}

// Who answers for the product: the team of Rerun in its support chat, or the organization by email.
export function useSupport() {
    const brand = useBrand()
    const { session, workspace } = useSession()
    const email = session?.user?.email

    if (isWhiteLabel(brand)) {
        const address = brand.supportEmail
        return {
            available: address !== null,
            open: () => address && mailTo(address),
            send: (text: string) => address && mailTo(address, text),
        }
    }
    return {
        available: SUPPORT_CHAT_ENABLED,
        open: () => openCrisp(email),
        send: (text: string) => sendToCrisp({ email, workspaceId: workspace?.id, text }),
    }
}
