import { app, safeStorage } from 'electron'
import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { WorkerLink } from '../../shared/remote-worker'

// The links of this computer, one per workspace, each with the token the hub gave it. The token is
// encrypted with the system's keychain (Keychain, DPAPI, libsecret). Where Linux has no keychain the
// file holds it as is, readable by this account only, and the app says so.

export type StoredLink = {
    computerId: string
    name: string
    handle: string
    workspaceId: number
    workspaceName: string
    hubOrigin: string
    linkedAt: string
    token: string
    encrypted: boolean
}

const FILE_NAME = 'remote-computers.json'

const linksPath = () => join(app.getPath('userData'), FILE_NAME)

let keychain: boolean | null = null

// Asked once: on a Linux desktop without a keyring the question goes over D-Bus and can take seconds.
export function keychainAvailable(): boolean {
    keychain ??= safeStorage.isEncryptionAvailable() && (process.platform !== 'linux' || safeStorage.getSelectedStorageBackend() !== 'basic_text')
    return keychain
}

export function readLinks(): StoredLink[] {
    try {
        const parsed = JSON.parse(readFileSync(linksPath(), 'utf8')) as { links?: unknown }
        return Array.isArray(parsed.links) ? (parsed.links as StoredLink[]).filter(link => typeof link?.computerId === 'string' && typeof link.token === 'string') : []
    } catch {
        return []
    }
}

function writeLinks(links: StoredLink[]): void {
    const path = linksPath()
    mkdirSync(dirname(path), { recursive: true })
    const temporary = `${path}.tmp`
    writeFileSync(temporary, JSON.stringify({ links }, null, 2), { mode: 0o600 })
    chmodSync(temporary, 0o600)
    renameSync(temporary, path)
}

export function saveLink(link: Omit<StoredLink, 'token' | 'encrypted'>, token: string): void {
    const encrypted = keychainAvailable()
    const stored: StoredLink = { ...link, token: encrypted ? safeStorage.encryptString(token).toString('base64') : token, encrypted }
    writeLinks([...readLinks().filter(existing => existing.computerId !== link.computerId && existing.workspaceId !== link.workspaceId), stored])
}

export function removeLink(computerId: string): StoredLink | null {
    const links = readLinks()
    const gone = links.find(link => link.computerId === computerId) ?? null
    if (gone) writeLinks(links.filter(link => link.computerId !== computerId))
    return gone
}

export function tokenOf(link: StoredLink): string | null {
    if (!link.encrypted) return link.token
    try {
        return safeStorage.decryptString(Buffer.from(link.token, 'base64'))
    } catch {
        return null
    }
}

export function workerLinks(): WorkerLink[] {
    return readLinks().flatMap(link => {
        const token = tokenOf(link)
        return token ? [{ computerId: link.computerId, hubOrigin: link.hubOrigin, token }] : []
    })
}
