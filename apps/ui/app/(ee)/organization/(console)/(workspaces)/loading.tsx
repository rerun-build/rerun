'use client'

import { WorkspacesView } from '@/ee/components/organization/WorkspacesView'

const noop = () => {}

export default function WorkspacesLoading() {
    return <WorkspacesView workspaces={null} maxWorkspaces={0} block={null} onOpen={noop} onNew={noop} />
}
