import { resolve, relative, isAbsolute, sep, dirname, basename, join } from 'node:path'
import { lstat, readlink, realpath } from 'node:fs/promises'
import { workspaceDir } from '../config/paths.js'

const MAX_LINK_HOPS = 40

function assertInside(root: string, target: string, shown: string): void {
    const rel = relative(root, target)
    if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error(`Path escapes the root: ${shown}`)
}

// Textual only: enough for a cheap pre-check, not for an operation, since a symlink inside the root
// can point anywhere. The operations go through `resolveWithinReal`.
export function resolveWithin(root: string, path: string): string {
    const target = isAbsolute(path) ? path : resolve(root, path)
    assertInside(root, target, path)
    return target
}

const isMissing = (err: unknown): boolean => {
    const code = (err as NodeJS.ErrnoException).code
    return code === 'ENOENT' || code === 'ENOTDIR'
}

// Where `path` lands once every symlink is followed, including the part that does not exist yet:
// the deepest existing ancestor goes through `realpath`, and a dangling link on the way is followed
// by hand so a write that would create its target is judged on where that target would be.
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
    // Off for `rm` and `rename`, which act on a link itself and never on what it points to.
    followLast?: boolean
}

// Returns the textual path, not the real one: the caller still sees the link it was given (to write
// through it, to show it relative to the root), only now known to land inside the root. The check
// and the operation are two steps, so a link swapped in between is not caught: the files of a root
// belong to the one uid that runs the engine, this is defence in depth, not a boundary between users.
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
