import 'server-only'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

const ICON_PATH = path.join(process.cwd(), 'public', 'icon-192.png')

let iconPromise: Promise<string> | null = null

// Satori cannot run the fur filters of <Logo>: an image drawn with next/og embeds the app icon instead.
export function brandIconDataUrl(): Promise<string> {
    iconPromise ??= readFile(ICON_PATH).then(png => `data:image/png;base64,${png.toString('base64')}`)
    return iconPromise
}
