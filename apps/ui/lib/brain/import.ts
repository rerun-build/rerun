import type { UploadEntry } from '@/lib/files/upload'
import { unzip, type UnzipFileInfo } from 'fflate'

// What one import into the Brain takes at most: past it, the rest is left out and the person is told.
export const MAX_IMPORT_FILES = 500
export const MAX_IMPORT_UNPACKED_BYTES = 500 * 1024 * 1024

// A file to import; one unpacked from a .zip names the archive and its path inside it.
export type ImportFile = { entry: UploadEntry; archive: string | null; label: string }

export type PreparedImport = {
    files: ImportFile[]
    // Archives that could not be opened, and archives too large once unpacked.
    failed: string[]
    tooLarge: string[]
    // More files than one import takes: only the first MAX_IMPORT_FILES are kept.
    truncated: boolean
}

export const isZip = (file: File) => /\.zip$/i.test(file.name)

// Files a Mac or a system puts beside the real ones: nobody means to import them.
function isNoise(path: string): boolean {
    return path.split('/').some(part => part === '__MACOSX' || part.startsWith('.'))
}

export const importPathOf = ({ file, subDir }: UploadEntry) => (subDir ? `${subDir}/${file.name}` : file.name)

const archiveFolder = (name: string) => name.replace(/\.zip$/i, '')

function readArchive(file: File, budget: { left: number }): Promise<{ files: Record<string, Uint8Array>; tooLarge: boolean }> {
    return new Promise((resolve, reject) => {
        let tooLarge = false
        const keep = (info: UnzipFileInfo) => {
            if (info.name.endsWith('/') || isNoise(info.name)) return false
            if (info.originalSize > budget.left) {
                tooLarge = true
                return false
            }
            budget.left -= info.originalSize
            return true
        }
        file.arrayBuffer().then(
            buffer =>
                unzip(new Uint8Array(buffer), { filter: keep }, (err, files) => {
                    if (err) reject(err)
                    else resolve({ files, tooLarge })
                }),
            reject
        )
    })
}

// A .zip comes in as a folder named after it holding what it contained; anything else as it is.
async function unpack(entry: UploadEntry, budget: { left: number }): Promise<{ files: ImportFile[]; tooLarge: boolean }> {
    const folder = [entry.subDir, archiveFolder(entry.file.name)].filter(Boolean).join('/')
    const { files, tooLarge } = await readArchive(entry.file, budget)
    const unpacked = Object.entries(files).map(([path, bytes]) => {
        const parts = path.split('/')
        const name = parts.pop() ?? path
        const file = new File([bytes as Uint8Array<ArrayBuffer>], name)
        return { entry: { file, subDir: [folder, ...parts].filter(Boolean).join('/') }, archive: entry.file.name, label: path }
    })
    return { files: unpacked, tooLarge }
}

export async function prepareImport(entries: UploadEntry[]): Promise<PreparedImport> {
    const budget = { left: MAX_IMPORT_UNPACKED_BYTES }
    const result: PreparedImport = { files: [], failed: [], tooLarge: [], truncated: false }
    for (const entry of entries) {
        if (isNoise(importPathOf(entry))) continue
        if (!isZip(entry.file)) {
            result.files.push({ entry, archive: null, label: importPathOf(entry) })
            continue
        }
        // Unpacked, an archive weighs at least what it does packed: one past the budget is never read.
        if (entry.file.size > budget.left) {
            result.tooLarge.push(entry.file.name)
            continue
        }
        try {
            const { files, tooLarge } = await unpack(entry, budget)
            result.files.push(...files)
            if (tooLarge) result.tooLarge.push(entry.file.name)
        } catch {
            result.failed.push(entry.file.name)
        }
    }
    if (result.files.length > MAX_IMPORT_FILES) {
        result.files = result.files.slice(0, MAX_IMPORT_FILES)
        result.truncated = true
    }
    return result
}

// The paths the Brain files for an import: every file, and the folder each one came in, so the
// folder can be listed under its Box as one item.
export function importedPaths(files: ImportFile[]): string[] {
    const paths = new Set<string>()
    for (const { entry } of files) {
        paths.add(importPathOf(entry))
        const root = entry.subDir.split('/')[0]
        if (root) paths.add(root)
    }
    return [...paths]
}
