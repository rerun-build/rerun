import type { DesktopShellPlatform } from '@rerun/contracts'
import type { FindRequest, FindResult, ServerConnectResult, ServerInfo } from '../../shared/ipc-channels'

// What the preload hands the shell's own pages (see src/preload/index.ts).
export type ShellLocalApi = {
    locale: string
    platform: DesktopShellPlatform
    retry(): Promise<boolean>
    serverInfo(): Promise<ServerInfo>
    connect(address: string): Promise<ServerConnectResult>
    cancelServerChange(): void
    find(request: FindRequest): void
    closeFind(): void
    onFindResult(callback: (result: FindResult) => void): () => void
    onFindFocus(callback: () => void): () => void
}

declare global {
    interface Window {
        rerunShellLocal?: ShellLocalApi
    }
}

export function shellLocal(): ShellLocalApi | null {
    return window.rerunShellLocal ?? null
}
