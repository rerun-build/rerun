import type { MainToWorker, WorkerToMain } from '../shared/remote-worker'
import { ComputerWorker } from './computer-worker'

// The entry of the utilityProcess the main process forks for the linked computers. It speaks to the
// main process only, through `process.parentPort`; everything it does lives in ComputerWorker.

type ParentPort = { on: (event: 'message', listener: (event: { data: MainToWorker }) => void) => void; postMessage: (message: WorkerToMain) => void }

const port = (process as unknown as { parentPort?: ParentPort }).parentPort
if (!port) throw new Error('The computer worker runs as an Electron utilityProcess only')

let worker: ComputerWorker | null = null

port.on('message', ({ data }) => {
    if (data.type === 'init') {
        worker?.shutdown()
        worker = new ComputerWorker({ dataDir: data.dataDir, appVersion: data.appVersion, settings: data.settings, send: message => port.postMessage(message) })
        worker.setLinks(data.links)
        return
    }
    if (data.type === 'links') return worker?.setLinks(data.links)
    if (data.type === 'settings') return worker?.setSettings(data.settings)
    if (data.type === 'shutdown') {
        worker?.shutdown()
        process.exit(0)
    }
})

port.postMessage({ type: 'ready' })
