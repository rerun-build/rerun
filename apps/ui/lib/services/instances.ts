import 'server-only'

import { randomInt } from 'node:crypto'

import { SERVICE_INSTANCE_ID_RE } from '@rerun/contracts'

import { type ServiceRegistry, entriesOfSlug } from './registry'

const ID_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789'
const MCP_SERVER_NAME_MAX = 64

export function newServiceInstanceId(taken: Iterable<string> = []): string {
    const used = new Set(taken)
    for (;;) {
        const id = Array.from({ length: 6 }, () => ID_ALPHABET[randomInt(ID_ALPHABET.length)]).join('')
        if (SERVICE_INSTANCE_ID_RE.test(id) && !used.has(id)) return id
    }
}

// A single `-`: `@` and `:` are refused in a server name, and `__` would be read by the Claude Code
// SDK as the end of the server part of `mcp__<server>__<tool>`.
export function instanceServerName(templateName: string, instanceId: string): string {
    return `${templateName.slice(0, MCP_SERVER_NAME_MAX - instanceId.length - 1)}-${instanceId}`
}

export function instanceEnvVar(baseVar: string, instanceId: string): string {
    return `${baseVar}_${instanceId.toUpperCase()}`
}

const sanitizeEnvPart = (s: string) => s.replace(/[^A-Za-z0-9_]/g, '_').toUpperCase()

export function defaultInstanceEnvVar(slug: string, instanceId: string | undefined, inputKey: string): string {
    const scope = instanceId ? `${sanitizeEnvPart(slug)}_${instanceId.toUpperCase()}` : sanitizeEnvPart(slug)
    return `RERUN_SVC_${scope}_${sanitizeEnvPart(inputKey)}`
}

// The names an account added before its app took several accounts moves to when it gets an instance:
// those a second account of the app is compiled with.
export function instanceRenames(slug: string, servers: string[], envKeys: string[], instanceId: string): { servers: Record<string, string>; env: Record<string, string> } {
    const basePrefix = defaultInstanceEnvVar(slug, undefined, '')
    const instancePrefix = defaultInstanceEnvVar(slug, instanceId, '')
    return {
        servers: Object.fromEntries(servers.map(name => [name, instanceServerName(name, instanceId)])),
        env: Object.fromEntries(envKeys.map(key => [key, key.startsWith(basePrefix) ? `${instancePrefix}${key.slice(basePrefix.length)}` : instanceEnvVar(key, instanceId)])),
    }
}

// "Gmail 2", "Gmail 3"… the first number no other account of the app already shows.
export function ordinalInstanceLabel(serviceName: string, reg: ServiceRegistry, slug: string): string {
    const labels = new Set(entriesOfSlug(reg, slug).map(({ entry }) => entry.label))
    let n = 2
    while (labels.has(`${serviceName} ${n}`)) n++
    return `${serviceName} ${n}`
}
