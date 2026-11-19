import { readdir, stat, unlink } from 'node:fs/promises'
import { join } from 'node:path'

const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000
const MAX_TOTAL_BYTES = 200 * 1024 * 1024

// Under what any provider takes as one tool result, with room for the path and the paging.
export const READ_BUDGET = 38_000

export const fileSafe = (text: string): string => text.replace(/[^\w.-]/g, '_').slice(0, 80)

// A folder of results kept whole in a coworker's workspace stays bounded: the oldest files go once
// they pass 30 days or the folder passes 200 MB, never the one just written.
export async function pruneSavedFiles(dir: string, keep: string, extension: string): Promise<void> {
    const files = await Promise.all(
        (await readdir(dir)).filter(name => name.endsWith(extension) && name !== keep).map(async name => ({ name, ...(await stat(join(dir, name))) })),
    )
    const now = Date.now()
    let total = files.reduce((sum, file) => sum + file.size, 0)
    for (const file of files.sort((a, b) => a.mtimeMs - b.mtimeMs)) {
        if (now - file.mtimeMs <= MAX_AGE_MS && total <= MAX_TOTAL_BYTES) break
        await unlink(join(dir, file.name)).catch(() => undefined)
        total -= file.size
    }
}
