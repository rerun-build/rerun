'use client'

import type { AppSlug } from '@/lib/apps/types'
import { LinkedinProDialog } from './LinkedinProDialog'
import { WhatsappProDialog } from './WhatsappProDialog'

export function PaidAppDialogs({ apps }: { apps: AppSlug[] }) {
    return (
        <>
            {apps.includes('linkedin') && <LinkedinProDialog />}
            {apps.includes('whatsapp') && <WhatsappProDialog />}
        </>
    )
}
