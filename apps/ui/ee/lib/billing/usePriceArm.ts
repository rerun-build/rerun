'use client'

import { parsePriceArm, type PriceArm } from '@/ee/lib/billing/plans'
import { useSession } from '@/supabase/session/SessionProvider'

export function usePriceArm(): PriceArm {
    return parsePriceArm(useSession().workspace?.price_arm)
}
