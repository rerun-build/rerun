import { resolve, relative, isAbsolute, sep, dirname, basename, join } from 'node:path'
import { lstat, readlink, realpath } from 'node:fs/promises'
import { workspaceDir } from '../config/paths.js'

const MAX_LINK_HOPS = 40

function assertInside(root: string, target: string, shown: string): void {
    const rel = relative(root, target)
    if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error(`Path escapes the root: ${shown}`)
}

export function resolveWithin(root: string, path: string): string {
    const target = isAbsolute(path) ? path : resolve(root, path)
    assertInside(root, target, path)
    return target
}

const isMissing = (err: unknown): boolean => {
    const code = (err as NodeJS.ErrnoException).code
    return code === 'ENOENT' || code === 'ENOTDIR'
}

async function realpathExisting(path: string, hops = 0): Promise<string> {
    try {
        return await realpath(path)
    } catch (err) {
        if (!isMissing(err)) throw err
    }
    const parent = dirname(path)
    if (parent === path) throw new Error(`Cannot resolve ${path}`)
    const candidate = join(await realpathExisting(parent, hops), basename(path))
    const info = await lstat(candidate).catch(() => null)
    if (!info?.isSymbolicLink()) return candidate
    if (hops >= MAX_LINK_HOPS) throw new Error(`Too many symbolic links: ${path}`)
    return realpathExisting(resolve(dirname(candidate), await readlink(candidate)), hops + 1)
}

export type ResolveRealOptions = {
    followLast?: boolean
}

export async function resolveWithinReal(root: string, path: string, { followLast = true }: ResolveRealOptions = {}): Promise<string> {
    const target = resolveWithin(root, path)
    const realRoot = await realpathExisting(root)
    const real = followLast ? await realpathExisting(target) : join(await realpathExisting(dirname(target)), basename(target))
    assertInside(realRoot, real, path)
    return target
}

export function resolveInWorkspace(agentId: string, path: string): Promise<string> {
    return resolveWithinReal(workspaceDir(agentId), path)
}

const BLOCKED = [/\brm\s+-rf\s+\/(?:\s|$)/, /\bmkfs\b/, /\b(shutdown|halt|poweroff|kexec)\b/, /\b(?:tel)?init\s+[06]\b/, /sysrq-trigger/, /\bdd\s+if=/, /:\(\)\s*\{/, /\bchown\s+-R\s+\//]

export function assertCommandAllowed(command: string): void {
    for (const pattern of BLOCKED) {
        if (pattern.test(command)) throw new Error(`Command blocked by policy: ${command}`)
    }
}
