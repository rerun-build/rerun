export type DesktopOpen = { agentId: string; name: string; call?: string; url?: string }

let pending: DesktopOpen | null = null

export function setPendingDesktopOpen(open: DesktopOpen) {
    pending = open
}

export function takePendingDesktopOpen(agentId: string): DesktopOpen | null {
    const open = pending?.agentId === agentId ? pending : null
    pending = null
    return open
}
