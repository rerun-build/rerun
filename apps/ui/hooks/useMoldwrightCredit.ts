'use client'

import { moldwrightCreditOf, type MoldwrightCredit } from '@/lib/engine/ai-sources'
import { useSession } from '@/supabase/session/SessionProvider'

export function useMoldwrightCredit(): MoldwrightCredit {
    const { workspace } = useSession()
    return moldwrightCreditOf(workspace)
}
