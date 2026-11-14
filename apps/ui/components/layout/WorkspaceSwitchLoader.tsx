'use client'

import { AppLoader } from '@/components/layout/AppLoader'
import { useWorkspaceSwitchLoader } from '@/lib/workspace/workspace-switch'

export function WorkspaceSwitchLoader() {
    const visible = useWorkspaceSwitchLoader()
    if (!visible) return null
    return <AppLoader className="fixed inset-0 z-[100] h-auto animate-in fade-in-0 duration-200" />
}
