import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { app, shell, type DownloadItem, type Session } from 'electron'
import type { DesktopDownloadEvent } from '@rerun/contracts'
import { IPC_EVENTS } from '../shared/ipc-channels'
import { uniqueDownloadPath } from './download-path'
import { getMainWindow } from './main-window'

const finished = new Map<string, string>()

function report(item: DownloadItem, id: string, state: DesktopDownloadEvent['state']): void {
    const event: DesktopDownloadEvent = { id, filename: item.getFilename(), state, receivedBytes: item.getReceivedBytes(), totalBytes: item.getTotalBytes() }
    getMainWindow()?.webContents.send(IPC_EVENTS.download, event)
}

// Every download (a link with `download`, a blob, an attachment the server sends) goes straight to
// the Downloads folder, without a save dialog, as a browser does, and the web app shows its toast.
export function trackDownloads(session: Session): void {
    session.on('will-download', (_event, item) => {
        const id = randomUUID()
        const path = uniqueDownloadPath(app.getPath('downloads'), item.getFilename(), existsSync)
        item.setSavePath(path)
        let lastReport = 0
        item.on('updated', (_updateEvent, state) => {
            if (state === 'interrupted') return report(item, id, 'interrupted')
            if (Date.now() - lastReport < 250) return
            lastReport = Date.now()
            report(item, id, 'progressing')
        })
        item.once('done', (_doneEvent, state) => {
            if (state === 'completed') {
                finished.set(id, path)
                app.addRecentDocument(path)
                if (process.platform === 'darwin') app.dock?.downloadFinished(path)
            }
            report(item, id, state)
        })
        report(item, id, 'progressing')
    })
}

export function showDownload(id: string): void {
    const path = finished.get(id)
    if (path) shell.showItemInFolder(path)
}
