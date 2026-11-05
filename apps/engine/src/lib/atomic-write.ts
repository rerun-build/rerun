import { chmod, rename, rm, writeFile } from 'node:fs/promises'
import { newId } from './ids.js'

export type AtomicWriteOptions = {
    // Applied to the temp file before the rename, so the file never shows up with a wider mode.
    mode?: number
}

// A plain writeFile truncates before it writes, so a concurrent reader can see an empty file and
// write it back as if it were the real content. Renaming a finished temp file is atomic on the same
// filesystem: a reader sees the old content or the new one, never a gap. The temp name is unique so
// two writers never share a half-written file.
export async function writeFileAtomic(path: string, content: string, { mode }: AtomicWriteOptions = {}): Promise<void> {
    const tmp = `${path}.${newId()}.tmp`
    try {
        await writeFile(tmp, content, { encoding: 'utf8', mode })
        // The umask strips bits at creation; chmod sets the mode asked for regardless of it.
        if (mode !== undefined) await chmod(tmp, mode)
        await rename(tmp, path)
    } catch (err) {
        await rm(tmp, { force: true }).catch(() => {})
        throw err
    }
}
