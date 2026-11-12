import { basename, extname, join } from 'node:path'

// Characters no file system takes, and the separators: a server-chosen name never escapes the
// Downloads folder nor overwrites what is there.
export function safeFilename(name: string): string {
    const cleaned = basename(name.replace(/\\/g, '/'))
        .replace(/[<>:"|?*\u0000-\u001f]/g, '_')
        .replace(/^\.+/, '')
        .trim()
    return cleaned.slice(0, 200) || 'download'
}

export function uniqueDownloadPath(directory: string, name: string, exists: (path: string) => boolean): string {
    const filename = safeFilename(name)
    const extension = extname(filename)
    const stem = filename.slice(0, filename.length - extension.length)
    let candidate = join(directory, filename)
    for (let index = 1; exists(candidate); index++) candidate = join(directory, `${stem} (${index})${extension}`)
    return candidate
}
