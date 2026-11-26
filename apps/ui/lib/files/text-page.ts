import { readFileText } from '@/lib/engine/client'
import type { EngineConnection } from '@/lib/engine/types'
import { TEXT_FILE_PAGE_CHARS } from '@rerun/contracts'

export type TextFilePage = {
    content: string
    offset: number
    nextOffset: number | null
    totalChars: number | null
    truncated: boolean
}

// One page of a text file of the machine, with where the next one starts. An engine from before
// paging answers the first page only, without an offset: anything past it is refused rather than
// handed back as the first page again.
export async function readTextFilePage(conn: EngineConnection, base: string, path: string, offset = 0): Promise<TextFilePage> {
    if (!Number.isInteger(offset) || offset < 0) throw new Error('offset must be a non-negative integer.')

    const page = await readFileText(conn, base, path, offset)
    if (offset > 0 && page.offset === undefined) {
        throw new Error(`The machine of this workspace must be updated before it can read beyond the first ${TEXT_FILE_PAGE_CHARS.toLocaleString('en-US')} characters of a file.`)
    }
    if (page.offset !== undefined && page.offset !== offset) throw new Error(`The machine returned offset ${page.offset} instead of ${offset}. Update it and try again.`)

    const truncated = page.truncated ?? page.content.length >= TEXT_FILE_PAGE_CHARS
    const nextOffset = page.nextOffset !== undefined ? page.nextOffset : truncated ? offset + page.content.length : null
    const totalChars = page.totalChars ?? (truncated ? null : offset + page.content.length)
    return { content: page.content, offset: page.offset ?? 0, nextOffset, totalChars, truncated }
}
