import { ipcMain, type IpcMainEvent, type IpcMainInvokeEvent, type WebFrameMain } from 'electron'
import { senderAudience, type SenderAudience } from './ipc-guard'
import { serverOrigin } from './server'
import { LOCAL_ORIGIN } from './url-policy'

function frameOf(event: IpcMainEvent | IpcMainInvokeEvent): { url: string; isMainFrame: boolean } | null {
    const frame: WebFrameMain | null = event.senderFrame
    if (!frame || frame.isDestroyed()) return null
    return { url: frame.url, isMainFrame: frame === event.sender.mainFrame }
}

export function audienceOf(event: IpcMainEvent | IpcMainInvokeEvent): SenderAudience | null {
    return senderAudience(frameOf(event), serverOrigin(), LOCAL_ORIGIN)
}

// A handler answers the audiences it names and throws for anyone else, before reading its arguments.
export function handle<Args extends unknown[], Result>(
    channel: string,
    audiences: readonly SenderAudience[],
    handler: (event: IpcMainInvokeEvent, ...args: Args) => Result | Promise<Result>,
): void {
    ipcMain.handle(channel, (event, ...args) => {
        const audience = audienceOf(event)
        if (!audience || !audiences.includes(audience)) throw new Error('Refused')
        return handler(event, ...(args as Args))
    })
}

export function on<Args extends unknown[]>(channel: string, audiences: readonly SenderAudience[], listener: (event: IpcMainEvent, ...args: Args) => void): void {
    ipcMain.on(channel, (event, ...args) => {
        const audience = audienceOf(event)
        if (!audience || !audiences.includes(audience)) return
        listener(event, ...(args as Args))
    })
}
