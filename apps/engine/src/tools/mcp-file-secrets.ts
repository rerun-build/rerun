import { randomUUID, createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { chmod, mkdir, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { MCP_PLACEHOLDER } from '@rerun/contracts'
import type { McpServer } from '../agents/types.js'
import { logger } from '../lib/logger.js'

export function fileVariables(server: McpServer): Set<string> {
    const values = [server.command ?? '', server.url ?? '', ...server.args, ...Object.values(server.env), ...Object.values(server.headers)]
    return new Set(values.flatMap(value => [...value.matchAll(MCP_PLACEHOLDER)].filter(match => match[1]).map(match => match[2])))
}

const valueHash = (value: string) => createHash('sha256').update(value).digest('hex').slice(0, 16)

const credentialFileName = (name: string, value: string) => `${name}-${valueHash(value)}.json`

// The name carries a hash of the value: a new value is a new path, so the pool sees another server
// and dials it again rather than keeping the connection it opened on the old credential.
async function writeCredentialFile(dir: string, name: string, value: string): Promise<string> {
    const file = credentialFileName(name, value)
    const path = resolve(dir, file)
    await mkdir(dir, { recursive: true, mode: 0o700 })
    await chmod(dir, 0o700)
    if (!existsSync(path)) {
        const tmp = `${path}.${randomUUID()}.tmp`
        await writeFile(tmp, value, { encoding: 'utf8', mode: 0o600 })
        await chmod(tmp, 0o600)
        await rename(tmp, path)
    }
    for (const other of await readdir(dir)) {
        if (other !== file && other.startsWith(`${name}-`) && !other.endsWith('.tmp')) await rm(resolve(dir, other), { force: true })
    }
    return path
}

// A file lives as long as its variable holds the same value in the `.env` it was written from: a key
// removed, renamed or changed takes its file with it, the private key inside included.
export async function pruneCredentialFiles(dir: string, env: Record<string, string>): Promise<void> {
    if (!existsSync(dir)) return
    for (const file of await readdir(dir)) {
        if (file.endsWith('.tmp')) continue
        const dash = file.lastIndexOf('-')
        const name = dash > 0 ? file.slice(0, dash) : ''
        const value = env[name]
        if (!value || file !== credentialFileName(name, value)) await rm(resolve(dir, file), { force: true })
    }
}

// Every `${file:VAR}` of the server becomes the path of a file of `dir` holding the value of VAR. The
// value itself never reaches the server's config, its arguments nor a log line.
export async function materializeFileSecrets(server: McpServer, env: Record<string, string>, dir: string): Promise<McpServer> {
    const names = fileVariables(server)
    if (names.size === 0) return server
    const paths = new Map<string, string>()
    for (const name of names) {
        const value = env[name]
        if (!value) {
            logger.warn({ server: server.name, var: name }, 'mcp: unresolved file placeholder')
            paths.set(name, '')
            continue
        }
        paths.set(name, await writeCredentialFile(dir, name, value))
    }
    const swap = (value: string) => value.replace(MCP_PLACEHOLDER, (whole, file: string | undefined, name: string) => (file ? (paths.get(name) ?? '') : whole))
    const swapRecord = (record: Record<string, string>) => Object.fromEntries(Object.entries(record).map(([key, value]) => [key, swap(value)]))
    return {
        ...server,
        command: server.command ? swap(server.command) : server.command,
        args: server.args.map(swap),
        url: server.url ? swap(server.url) : server.url,
        env: swapRecord(server.env),
        headers: swapRecord(server.headers),
    }
}
