import type { DesktopShellPlatform, DesktopUpdateState } from '@moldwright/contracts'
import type { FindRequest, FindResult, ServerConnectResult, ServerInfo } from '../../shared/ipc-channels'

export type ShellLocalApi = {
    locale: string
    platform: DesktopShellPlatform
    retry(): Promise<boolean>
    updateState(): Promise<DesktopUpdateState>
    onUpdateState(callback: (state: DesktopUpdateState) => void): () => void
    checkForUpdates(): void
    installUpdate(): void
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
