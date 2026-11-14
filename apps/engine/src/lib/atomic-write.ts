import { chmod, rename, rm, writeFile } from 'node:fs/promises'
import { newId } from './ids.js'

export type AtomicWriteOptions = {
    mode?: number
}

export async function writeFileAtomic(path: string, content: string, { mode }: AtomicWriteOptions = {}): Promise<void> {
    const tmp = `${path}.${newId()}.tmp`
    try {
        await writeFile(tmp, content, { encoding: 'utf8', mode })
        if (mode !== undefined) await chmod(tmp, mode)
        await rename(tmp, path)
    } catch (err) {
        await rm(tmp, { force: true }).catch(() => {})
        throw err
    }
}
