import { appendFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { ActivityEntry } from '../shared/remote-worker'

const KEEP = 2_000

// Who ran what on this computer and when, kept on the computer itself: the person reads it from the
// tray whatever the hub or the engine say. One JSON line per entry, the oldest dropped past KEEP.
export class ActivityLog {
    private writes: Promise<void> = Promise.resolve()
    private count: number | null = null

    constructor(private readonly path: string) {}

    record(entry: ActivityEntry): Promise<void> {
        this.writes = this.writes.then(() => this.append(entry)).catch(() => {})
        return this.writes
    }

    private async append(entry: ActivityEntry): Promise<void> {
        await mkdir(dirname(this.path), { recursive: true })
        if (this.count === null) this.count = (await this.read()).length
        await appendFile(this.path, `${JSON.stringify(entry)}\n`, { encoding: 'utf8', mode: 0o600 })
        this.count += 1
        if (this.count <= KEEP * 1.25) return
        const kept = (await this.read()).slice(-KEEP)
        const temporary = `${this.path}.tmp`
        await writeFile(temporary, kept.map(line => `${JSON.stringify(line)}\n`).join(''), { encoding: 'utf8', mode: 0o600 })
        await rename(temporary, this.path)
        this.count = kept.length
    }

    async read(): Promise<ActivityEntry[]> {
        let raw: string
        try {
            raw = await readFile(this.path, 'utf8')
        } catch {
            return []
        }
        return raw.split('\n').flatMap(line => {
            try {
                return line ? [JSON.parse(line) as ActivityEntry] : []
            } catch {
                return []
            }
        })
    }
}
