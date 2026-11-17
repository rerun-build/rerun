import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { appendFile, lstat, mkdir, open, readdir, realpath, rename, rm, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import { MAX_UPLOAD_FILE_BYTES, REMOTE_TRANSFER_CHUNK_BYTES, isInsideRemote, isReservedWindowsPath, isSensitiveRemotePath, type RemoteFileEntry, type RemoteOs } from '@rerun/contracts'
import { RemoteFailure } from './failure'

// The files of this computer, as the engine asks for them. Every path is checked here on its real
// form, links and junctions followed: inside the roots the engine allowed, and never where secrets
// live without the person's yes, whatever the engine says.

export type FileScope = { roots: string[] | null; sensitiveOk: boolean }

const MAX_LISTED = 500
const PART_SUFFIX = '.rerun-part'

const isMissing = (err: unknown) => (err as NodeJS.ErrnoException).code === 'ENOENT'

export class ComputerFiles {
    constructor(
        private readonly os: RemoteOs,
        private readonly workDir: () => string,
        private readonly home: string = homedir(),
    ) {}

    private absolute(path: string): string {
        const expanded = path === '~' || path.startsWith('~/') || path.startsWith('~\\') ? join(this.home, path.slice(1)) : path
        return isAbsolute(expanded) ? resolve(expanded) : resolve(this.workDir(), expanded)
    }

    // The real path of something that may not exist yet: the real folder it would land in.
    private async real(path: string): Promise<string> {
        try {
            return await realpath(path)
        } catch (err) {
            if (!isMissing(err)) throw err
            const parent = dirname(path)
            if (parent === path) return path
            return join(await this.real(parent), basename(path))
        }
    }

    // `target` is a real path: a home reached through a link (/var is /private/var on macOS) never
    // matches it, so its real form is checked too.
    private realHome: Promise<string> | null = null

    private async isSensitive(target: string): Promise<boolean> {
        this.realHome ??= this.real(this.home)
        return isSensitiveRemotePath(target, this.os, this.home) || isSensitiveRemotePath(target, this.os, await this.realHome)
    }

    private async check(path: string, scope: FileScope): Promise<string> {
        if (this.os === 'win' && isReservedWindowsPath(path)) throw new RemoteFailure('invalid', `${path} is a reserved Windows name or a network share.`)
        const target = await this.real(this.absolute(path))
        if (!scope.sensitiveOk && (await this.isSensitive(target))) throw new RemoteFailure('sensitive_path', `${target} is where secrets live: it needs the person's yes.`)
        if (scope.roots) {
            const roots = await Promise.all(scope.roots.map(root => this.real(this.absolute(root)).catch(() => null)))
            if (!roots.some(root => root && isInsideRemote(target, root, this.os, this.home))) throw new RemoteFailure('outside_workdir', `${target} is outside the folders coworkers may use on this computer.`)
        }
        return target
    }

    private entryOf(name: string, info: Awaited<ReturnType<typeof lstat>>): RemoteFileEntry {
        const type = info.isSymbolicLink() ? 'link' : info.isDirectory() ? 'dir' : info.isFile() ? 'file' : 'other'
        return { name, type, size: Number(info.size), modifiedAt: info.mtime ? info.mtime.toISOString() : null }
    }

    async list(path: string, scope: FileScope) {
        const target = await this.check(path, scope)
        const names = await readdir(target).catch(err => {
            if (isMissing(err)) throw new RemoteFailure('not_found', `No folder at ${target}.`)
            if ((err as NodeJS.ErrnoException).code === 'ENOTDIR') throw new RemoteFailure('invalid', `${target} is a file, not a folder.`)
            throw err
        })
        const entries: RemoteFileEntry[] = []
        for (const name of names.sort().slice(0, MAX_LISTED)) {
            const info = await lstat(join(target, name)).catch(() => null)
            if (info) entries.push(this.entryOf(name, info))
        }
        return { path: target, entries, truncated: names.length > MAX_LISTED }
    }

    async stat(path: string, scope: FileScope) {
        const target = await this.check(path, scope)
        const info = await lstat(target).catch(err => {
            if (isMissing(err)) throw new RemoteFailure('not_found', `Nothing at ${target}.`)
            throw err
        })
        return { path: target, entry: this.entryOf(basename(target), info) }
    }

    async read(path: string, maxBytes: number, scope: FileScope) {
        const target = await this.check(path, scope)
        const info = await stat(target).catch(err => {
            if (isMissing(err)) throw new RemoteFailure('not_found', `No file at ${target}.`)
            throw err
        })
        if (!info.isFile()) throw new RemoteFailure('invalid', `${target} is not a file.`)
        const handle = await open(target, 'r')
        try {
            const buffer = Buffer.alloc(Math.min(maxBytes, info.size))
            const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
            const bytes = buffer.subarray(0, bytesRead)
            const binary = bytes.subarray(0, 8000).includes(0)
            return { path: target, content: binary ? bytes.toString('base64') : bytes.toString('utf8'), encoding: binary ? ('base64' as const) : ('utf8' as const), size: info.size, truncated: info.size > bytesRead }
        } finally {
            await handle.close()
        }
    }

    async write(path: string, content: string, encoding: 'utf8' | 'base64', scope: FileScope) {
        const target = await this.check(path, scope)
        const data = Buffer.from(content, encoding)
        await mkdir(dirname(target), { recursive: true })
        const temporary = `${target}${PART_SUFFIX}`
        await writeFile(temporary, data)
        await rename(temporary, target)
        return { path: target, size: data.length }
    }

    async pull(path: string, offset: number, scope: FileScope) {
        const target = await this.check(path, scope)
        const info = await stat(target).catch(err => {
            if (isMissing(err)) throw new RemoteFailure('not_found', `No file at ${target}.`)
            throw err
        })
        if (!info.isFile()) throw new RemoteFailure('invalid', `${target} is not a file.`)
        if (info.size > MAX_UPLOAD_FILE_BYTES) throw new RemoteFailure('too_large', `${target} is ${Math.round(info.size / 1024 / 1024)} MB, over the ${MAX_UPLOAD_FILE_BYTES / 1024 / 1024} MB a copy carries: work on it where it is.`)
        const handle = await open(target, 'r')
        try {
            const buffer = Buffer.alloc(Math.max(0, Math.min(REMOTE_TRANSFER_CHUNK_BYTES, info.size - offset)))
            const { bytesRead } = await handle.read(buffer, 0, buffer.length, offset)
            const eof = offset + bytesRead >= info.size
            return { path: target, size: info.size, data: buffer.subarray(0, bytesRead).toString('base64'), eof, sha256: eof ? await sha256Of(target) : null }
        } finally {
            await handle.close()
        }
    }

    async push(params: { path: string; offset: number; data: string; final: boolean; sha256?: string; overwrite: boolean }, scope: FileScope) {
        const target = await this.check(params.path, scope)
        const part = `${target}${PART_SUFFIX}`
        if (params.offset === 0) {
            if (!params.overwrite && (await stat(target).catch(() => null))) throw new RemoteFailure('busy', `${target} already exists: say if it may be replaced.`)
            await mkdir(dirname(target), { recursive: true })
            await rm(part, { force: true })
            await writeFile(part, '')
        }
        const current = await stat(part).catch(() => null)
        if (!current || current.size !== params.offset) throw new RemoteFailure('invalid', 'The copy lost its place: start it over.')
        const bytes = Buffer.from(params.data, 'base64')
        if (current.size + bytes.length > MAX_UPLOAD_FILE_BYTES) {
            await rm(part, { force: true })
            throw new RemoteFailure('too_large', `A copy carries ${MAX_UPLOAD_FILE_BYTES / 1024 / 1024} MB at most.`)
        }
        await appendFile(part, bytes)
        const size = current.size + bytes.length
        if (!params.final) return { path: target, size, done: false }
        if (params.sha256 && (await sha256Of(part)) !== params.sha256) {
            await rm(part, { force: true })
            throw new RemoteFailure('invalid', 'The copy arrived damaged and was dropped: try again.')
        }
        await rename(part, target)
        return { path: target, size, done: true }
    }
}

function sha256Of(path: string): Promise<string> {
    return new Promise((resolve, reject) => {
        const hash = createHash('sha256')
        createReadStream(path)
            .on('data', chunk => hash.update(chunk))
            .on('error', reject)
            .on('end', () => resolve(hash.digest('hex')))
    })
}
