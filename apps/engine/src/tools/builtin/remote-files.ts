import { createHash } from 'node:crypto'
import { statfs } from 'node:fs/promises'
import { tool, type ToolSet } from 'ai'
import { z } from 'zod'
import { MAX_UPLOAD_FILE_BYTES, REMOTE_TRANSFER_CHUNK_BYTES, type RemoteComputerView } from '@rerun/contracts'
import { workspaceDir } from '../../config/paths.js'
import { fileSize, readByteStream, writeStream } from '../../files/store.js'
import { grantedPaths } from '../../remote/access.js'
import { fileDecision } from '../../remote/file-access.js'
import { liveConnection } from '../../remote/registry.js'
import type { RemoteConnection } from '../../remote/connection.js'
import type { RunContext } from '../../runtime/context.js'
import { callFailure, findComputer, unavailable, unknownComputer } from './remote-common.js'

// The files of a linked computer. Heavy files stay there: the coworker lists, reads a little, writes
// small text files, and copies to or from its own workspace only what fits in a chat attachment.

const READ_LIMIT = 100_000
// What a copy to the box leaves free on its disk at least: a full box already makes updates fail.
const DISK_MARGIN_BYTES = 200 * 1024 * 1024

type Ready = { view: RemoteComputerView; connection: RemoteConnection }

async function ready(handle: string): Promise<Ready | string> {
    const { view, known } = await findComputer(handle)
    if (!view) return unknownComputer(handle, known)
    const busy = unavailable(view)
    if (busy) return busy
    const connection = liveConnection(view.id)
    if (!connection || !view.facts) return unavailable({ ...view, online: false }) as string
    if (!connection.offers('files')) return `#${view.handle} does not offer its files: its owner switched them off in the Rerun app.`
    return { view, connection }
}

function needsApproval(view: RemoteComputerView, path: string, sensitive: boolean) {
    return {
        status: 'needs_approval',
        instruction: `Not done: ${path} on #${view.handle} is ${sensitive ? 'where secrets live (keys, keychains, browser profiles), which always needs' : 'outside the folders coworkers may use there, which needs'} the user's yes. Call request_computer_access with computer "#${view.handle}", paths [this path] and a short reason, then end your turn.`,
    }
}

const humanSize = (bytes: number) => (bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : bytes >= 1024 ? `${Math.round(bytes / 1024)} KB` : `${bytes} B`)

export function remoteFileTools(ctx: RunContext): ToolSet {
    const author = ctx.author?.name

    // The scope the computer checks the path against, or why it is not reachable yet.
    async function scopeFor(target: Ready, path: string) {
        const decision = fileDecision(target.view, path, await grantedPaths(ctx, target.view.handle))
        if (decision.kind === 'ask') return { refusal: needsApproval(target.view, decision.path, decision.sensitive) }
        return { scope: { roots: decision.roots, sensitiveOk: decision.sensitiveOk }, path: decision.path }
    }

    return {
        remote_file_list: tool({
            description: 'List a folder on a linked computer (#handle): names, kinds, sizes, dates. Without a path, its working folder. Paths are absolute or relative to that working folder.',
            inputSchema: z.object({ computer: z.string().min(1).max(100), path: z.string().max(4096).optional() }),
            execute: async ({ computer, path }) => {
                const target = await ready(computer)
                if (typeof target === 'string') return target
                const access = await scopeFor(target, path || '.')
                if ('refusal' in access) return access.refusal
                try {
                    const listing = await target.connection.call('fs.list', { path: access.path, author, ...access.scope })
                    const lines = listing.entries.map(entry => `${entry.type === 'dir' ? `${entry.name}/` : entry.name}${entry.type === 'file' ? `  ${humanSize(entry.size)}` : ''}`)
                    return `${listing.path} on #${target.view.handle}${listing.truncated ? ' (first 500 entries)' : ''}\n${lines.join('\n') || '(empty)'}`
                } catch (err) {
                    return callFailure(target.view, err)
                }
            },
        }),

        remote_file_read: tool({
            description: 'Read a text file on a linked computer (#handle), up to 100 KB: a log, a config, a script, a subtitle file. A binary file is described, not read: work on it there with remote_exec, or copy it with remote_transfer.',
            inputSchema: z.object({ computer: z.string().min(1).max(100), path: z.string().min(1).max(4096) }),
            execute: async ({ computer, path }) => {
                const target = await ready(computer)
                if (typeof target === 'string') return target
                const access = await scopeFor(target, path)
                if ('refusal' in access) return access.refusal
                try {
                    const file = await target.connection.call('fs.read', { path: access.path, maxBytes: READ_LIMIT, author, ...access.scope })
                    if (file.encoding === 'base64') return `${file.path} on #${target.view.handle} is a binary file of ${humanSize(file.size)}. Work on it there with remote_exec, or copy it with remote_transfer.`
                    return `${file.path} on #${target.view.handle} · ${humanSize(file.size)}${file.truncated ? ' · first 100 KB only' : ''}\n${file.content}`
                } catch (err) {
                    return callFailure(target.view, err)
                }
            },
        }),

        remote_file_write: tool({
            description: 'Write a small text file on a linked computer (#handle): a script, a config, a list. It replaces the file if it exists. Paths are absolute or relative to its working folder.',
            inputSchema: z.object({ computer: z.string().min(1).max(100), path: z.string().min(1).max(4096), content: z.string().max(1_000_000) }),
            execute: async ({ computer, path, content }) => {
                const target = await ready(computer)
                if (typeof target === 'string') return target
                const access = await scopeFor(target, path)
                if ('refusal' in access) return access.refusal
                try {
                    const written = await target.connection.call('fs.write', { path: access.path, content, encoding: 'utf8', author, ...access.scope })
                    return `Wrote ${written.path} on #${target.view.handle} (${humanSize(written.size)}).`
                } catch (err) {
                    return callFailure(target.view, err)
                }
            },
        }),

        remote_transfer: tool({
            description: `Copy one file between a linked computer (#handle) and your own workspace, up to ${MAX_UPLOAD_FILE_BYTES / 1024 / 1024} MB: "to_workspace" brings it here (to show it, publish it, attach it), "to_computer" sends one of your files there. A bigger file stays where it is and is worked on there.`,
            inputSchema: z.object({
                computer: z.string().min(1).max(100),
                direction: z.enum(['to_workspace', 'to_computer']),
                from: z.string().min(1).max(4096).describe('The file to copy: a path on the computer for to_workspace, a path in your workspace for to_computer'),
                to: z.string().max(4096).optional().describe('Where it lands: a path in your workspace, or on the computer. Defaults to the same file name'),
                overwrite: z.boolean().default(false).describe('Replace a file already there on the computer'),
            }),
            execute: async ({ computer, direction, from, to, overwrite }) => {
                const target = await ready(computer)
                if (typeof target === 'string') return target
                const name = from.split(/[\\/]/).pop() || 'file'
                if (direction === 'to_workspace') return pull(target, from, to || name)
                return push(target, from, to || name, overwrite)
            },
        }),
    }

    async function pull(target: Ready, from: string, to: string): Promise<unknown> {
        const access = await scopeFor(target, from)
        if ('refusal' in access) return access.refusal
        const { connection, view } = target
        try {
            const { entry, path } = await connection.call('fs.stat', { path: access.path, author, ...access.scope })
            if (entry.type !== 'file') return `${path} on #${view.handle} is not a file.`
            if (entry.size > MAX_UPLOAD_FILE_BYTES) return `${path} is ${humanSize(entry.size)}, over the ${MAX_UPLOAD_FILE_BYTES / 1024 / 1024} MB a copy carries: it stays on #${view.handle}. Work on it there with remote_exec.`
            const free = await statfs(workspaceDir(ctx.agent.id)).then(info => info.bavail * info.bsize).catch(() => Number.POSITIVE_INFINITY)
            if (free - entry.size < DISK_MARGIN_BYTES) return `Not copied: the workspace's disk is nearly full (${humanSize(free)} free). Free some room first.`
            const hash = createHash('sha256')
            let offset = 0
            const body = new ReadableStream<Uint8Array>({
                pull: async controller => {
                    const piece = await connection.call('fs.pull', { path, offset, author, ...access.scope }, { timeoutMs: 60_000, signal: ctx.abortSignal })
                    const bytes = Buffer.from(piece.data, 'base64')
                    hash.update(bytes)
                    offset += bytes.length
                    if (bytes.length) controller.enqueue(bytes)
                    if (!piece.eof) return
                    if (piece.sha256 && piece.sha256 !== hash.digest('hex')) return controller.error(new Error('The copy arrived damaged: try again.'))
                    controller.close()
                },
            })
            const size = await writeStream(workspaceDir(ctx.agent.id), to, body, MAX_UPLOAD_FILE_BYTES)
            return `Copied ${path} from #${view.handle} to ${to} in your workspace (${humanSize(size)}).`
        } catch (err) {
            if (ctx.abortSignal?.aborted) throw err
            if (err instanceof Error && !('code' in err)) return `Not copied: ${err.message}`
            return callFailure(view, err)
        }
    }

    async function push(target: Ready, from: string, to: string, overwrite: boolean): Promise<unknown> {
        const access = await scopeFor(target, to)
        if ('refusal' in access) return access.refusal
        const { connection, view } = target
        const root = workspaceDir(ctx.agent.id)
        let size: number
        try {
            size = await fileSize(root, from)
        } catch {
            return `No file at ${from} in your workspace.`
        }
        if (size > MAX_UPLOAD_FILE_BYTES) return `${from} is ${humanSize(size)}, over the ${MAX_UPLOAD_FILE_BYTES / 1024 / 1024} MB a copy carries.`
        try {
            const reader = (await readByteStream(root, from)).getReader()
            const hash = createHash('sha256')
            let pending = Buffer.alloc(0)
            let offset = 0
            let last = { path: access.path, size: 0, done: false }
            for (;;) {
                const { value, done } = await reader.read()
                if (value) {
                    hash.update(value)
                    pending = Buffer.concat([pending, Buffer.from(value)])
                }
                // The last piece says so, empty when the file ends right on a piece: the computer
                // only puts the file in place once it hears it.
                while (pending.length >= REMOTE_TRANSFER_CHUNK_BYTES || done) {
                    const piece = pending.subarray(0, REMOTE_TRANSFER_CHUNK_BYTES)
                    pending = pending.subarray(piece.length)
                    const final = done && pending.length === 0
                    last = await connection.call('fs.push', { path: access.path, offset, data: piece.toString('base64'), final, ...(final ? { sha256: hash.digest('hex') } : {}), overwrite, author, ...access.scope }, { timeoutMs: 60_000, signal: ctx.abortSignal })
                    offset += piece.length
                    if (final) break
                }
                if (done) break
            }
            if (!last.done) return `Not copied: #${view.handle} did not confirm ${last.path}. Try again.`
            return `Copied ${from} to ${last.path} on #${view.handle} (${humanSize(last.size)}).`
        } catch (err) {
            if (ctx.abortSignal?.aborted) throw err
            return callFailure(view, err)
        }
    }
}
