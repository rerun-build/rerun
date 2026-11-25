'use client'

import { DomainsView } from '@/ee/components/organization/DomainsView'

const noop = () => {}
const refuse = async () => ({ ok: false as const })

export default function DomainsLoading() {
    return <DomainsView defaultHostname={null} domains={null} checkingId={null} block={null} onAdd={refuse} onCheck={noop} onRemove={noop} />
}
