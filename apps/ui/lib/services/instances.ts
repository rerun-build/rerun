import 'server-only'

import { randomInt } from 'node:crypto'

import { SERVICE_INSTANCE_ID_RE } from '@moldwright/contracts'

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

export function ordinalInstanceLabel(serviceName: string, reg: ServiceRegistry, slug: string): string {
    const labels = new Set(entriesOfSlug(reg, slug).map(({ entry }) => entry.label))
    let n = 2
    while (labels.has(`${serviceName} ${n}`)) n++
    return `${serviceName} ${n}`
}
