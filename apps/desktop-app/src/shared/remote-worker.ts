import type { RemoteCapability } from '@rerun/contracts'

// What the main process and the computer's worker (a utilityProcess, `src/worker/`) tell each other.
// The worker holds the sockets, the commands and the jobs; the main process holds the tokens (in the
// system's keychain), the windows, the tray and the permissions of the system.

export type WorkerLink = { computerId: string; hubOrigin: string; token: string }

// What the person set in the app. The worker applies it whatever the engine asks: a hub or an engine
// that went wrong cannot switch back on what was switched off here.
export type WorkerLocalSettings = { paused: boolean; workDir: string; capabilities: RemoteCapability[] }

export type MainToWorker =
    | { type: 'init'; dataDir: string; appVersion: string; settings: WorkerLocalSettings; links: WorkerLink[] }
    | { type: 'links'; links: WorkerLink[] }
    | { type: 'settings'; settings: WorkerLocalSettings }
    | { type: 'shutdown' }

export type WorkerLinkStatus = 'connecting' | 'online' | 'offline' | 'revoked'

export type WorkerLinkState = { computerId: string; status: WorkerLinkStatus; since: string; error?: string; retryAt?: string }

export type ActivityEntry = { at: string; computerId: string; author: string | null; kind: 'command' | 'job' | 'file' | 'screen'; summary: string; outcome: 'ok' | 'failed' | 'refused' }

export type WorkerToMain =
    | { type: 'ready' }
    | { type: 'state'; links: WorkerLinkState[] }
    | { type: 'revoked'; computerId: string }
    | { type: 'activity'; entry: ActivityEntry }
    | { type: 'busy'; runningJobs: number }
