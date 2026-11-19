import { mobileApi, type DesktopSocketView, type DesktopViewMode, type TakeoverResult } from '@rerun/contracts'

import { hub } from '@/api/client'

type Caller = { accessToken: string; workspaceId: number }

// A fresh socket each time: its ticket is spent within a minute.
export async function openDesktop(caller: Caller, agentId: string, mode: DesktopViewMode): Promise<DesktopSocketView> {
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone
    return hub(mobileApi.openDesktop, { ...caller, params: { id: agentId }, body: { mode, timeZone } })
}

export async function startTakeover(caller: Caller, agentId: string, url?: string): Promise<void> {
    await hub(mobileApi.startTakeover, { ...caller, params: { id: agentId }, body: url ? { url } : {} })
}

// keepOpen when the person hands the browser back to the run that asked for it: the window stays on
// the coworker's screen. Skipped, it closes.
export async function finishTakeover(caller: Caller, agentId: string, { keepOpen = false } = {}): Promise<TakeoverResult> {
    return hub(mobileApi.finishTakeover, { ...caller, params: { id: agentId }, query: keepOpen ? { keepOpen: '1' } : {} })
}
