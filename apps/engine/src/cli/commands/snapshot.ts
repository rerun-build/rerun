import { existsSync } from 'node:fs'
import { mkdir, readdir, rm, stat, statfs } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createClient } from '@libsql/client'
import { listAgentIdsOnDisk } from '../../agents/loader.js'
import { dataDir, systemDbPath } from '../../config/paths.js'

const STAMP = /^\d{8}T\d{6}Z$/
const DEFAULT_KEEP = 2

function stamp(date: Date): string {
    return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
}

function parseKeep(args: string[]): number {
    const i = args.indexOf('--keep')
    if (i === -1) return DEFAULT_KEEP
    const keep = Number(args[i + 1])
    if (!Number.isInteger(keep) || keep < 1) throw new Error('--keep needs a whole number of 1 or more')
    return keep
}

async function copyOne(source: string, target: string): Promise<void> {
    const { DatabaseSync, backup } = process.getBuiltinModule('node:sqlite') as unknown as {
        DatabaseSync: new (path: string, options: { readOnly: boolean }) => { close(): void }
        backup: (source: { close(): void }, path: string) => Promise<number>
    }
    const src = new DatabaseSync(source, { readOnly: true })
    try {
        await backup(src, target)
    } finally {
        src.close()
    }
}

async function checkOne(target: string): Promise<boolean> {
    const copy = createClient({ url: `file:${target}` })
    try {
        const result = await copy.execute('PRAGMA integrity_check')
        return result.rows.length === 1 && Object.values(result.rows[0]!)[0] === 'ok'
    } finally {
        copy.close()
    }
}

export async function snapshotCommand(args: string[]): Promise<void> {
    const keep = parseKeep(args)
    const sources: { id: string; path: string }[] = []
    for (const id of await listAgentIdsOnDisk()) {
        const path = systemDbPath(id)
        if (existsSync(path)) sources.push({ id, path })
    }
    let totalBytes = 0
    for (const s of sources) totalBytes += (await stat(s.path)).size

    const root = resolve(dataDir(), 'backups')
    const folder = resolve(root, stamp(new Date()))
    const report = { folder, copies: 0, ok: 0, bytes: 0 }
    await mkdir(root, { recursive: true })
    const fs = await statfs(root)
    const free = fs.bavail * fs.bsize
    if (free < totalBytes * 2) {
        process.stdout.write(JSON.stringify({ ...report, error: `not enough free space: ${free} bytes free, ${totalBytes * 2} needed` }) + '\n')
        process.exitCode = 1
        return
    }

    await mkdir(folder)
    const failed: string[] = []
    for (const s of sources) {
        const target = resolve(folder, `${s.id}.system.db`)
        try {
            await copyOne(s.path, target)
            report.copies++
            report.bytes += (await stat(target)).size
            if (await checkOne(target)) report.ok++
            else failed.push(s.id)
        } catch (err) {
            failed.push(s.id)
            process.stderr.write(`snapshot of ${s.id} failed: ${err instanceof Error ? err.message : String(err)}\n`)
        }
    }
    const result: Record<string, unknown> = { ...report }
    if (failed.length > 0) result.failed = failed
    process.stdout.write(JSON.stringify(result) + '\n')
    if (failed.length > 0) {
        process.exitCode = 1
        return
    }

    const old = (await readdir(root, { withFileTypes: true }))
        .filter(e => e.isDirectory() && STAMP.test(e.name))
        .map(e => e.name)
        .sort()
    for (const name of old.slice(0, Math.max(0, old.length - keep))) {
        await rm(resolve(root, name), { recursive: true, force: true })
    }
}
