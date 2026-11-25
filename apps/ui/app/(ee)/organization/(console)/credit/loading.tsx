'use client'

import { CreditView } from '@/ee/components/organization/CreditView'

const noop = () => {}
const refuse = async () => ({ ok: false as const })

export default function CreditLoading() {
    return <CreditView reserveMicros={null} workspaces={[]} movements={null} hasMore={false} loadingMore={false} block={null} onLoadMore={noop} onAllocate={refuse} onTakeBack={refuse} />
}
