'use client'

import { TeamView } from '@/ee/components/organization/TeamView'

const noop = () => {}
const refuse = async () => ({ ok: false as const })

export default function TeamLoading() {
    return <TeamView people={null} invitations={[]} block={null} onInvite={refuse} onRoleChange={noop} onRemove={noop} onRevoke={noop} />
}
