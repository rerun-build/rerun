import type { BrainFileMeta, BrainPageSummary } from '@rerun/contracts'

// A Box the person can open. A Box nobody named is null, shown as "Untitled Box".
export type BrainBox = { id: string; name: string | null }
export type BrainCoworker = { id: string; name: string; handle: string | null; spaceId: string }

// What the Brain knows of the workspace's Boxes, to file its pages and files under them.
export type BrainFiling = { boxes: BrainBox[]; coworkers: BrainCoworker[]; files: BrainFileMeta[] }

export const EMPTY_FILING: BrainFiling = { boxes: [], coworkers: [], files: [] }

// The Box an item reads as filed under: one the person cannot open, or one deleted since, reads
// as filed for everyone.
export function boxOfItem(spaceId: string | null | undefined, boxes: BrainBox[]): BrainBox | null {
    if (!spaceId) return null
    return boxes.find(box => box.id === spaceId) ?? null
}

// Who first put a page in the Brain; a page from before the Brain kept that reads its last author.
export function addedByOf(page: Pick<BrainPageSummary, 'createdBy' | 'updatedBy'>): string {
    return page.createdBy ?? page.updatedBy
}

export function coworkerOfAuthor(author: string | null | undefined, coworkers: BrainCoworker[]): BrainCoworker | null {
    if (!author?.startsWith('agent:')) return null
    const handle = author.slice('agent:'.length)
    return coworkers.find(coworker => coworker.handle === handle) ?? null
}

export function pagesOfBox(boxId: string | null, pages: BrainPageSummary[], boxes: BrainBox[]): BrainPageSummary[] {
    return pages.filter(page => (boxOfItem(page.spaceId, boxes)?.id ?? null) === boxId)
}

// A folder filed under a Box stands for what it holds: the files inside it filed the same way are
// not listed again under the Box.
export function filesOfBox(boxId: string, files: BrainFileMeta[]): BrainFileMeta[] {
    const filed = files.filter(file => file.spaceId === boxId)
    const paths = new Set(filed.map(file => file.path))
    return filed.filter(file => !ancestorsOf(file.path).some(ancestor => paths.has(ancestor)))
}

function ancestorsOf(path: string): string[] {
    const parts = path.split('/')
    return parts.slice(0, -1).map((_, index) => parts.slice(0, index + 1).join('/'))
}

// A file inside an imported folder carries the folder's filing when it has none of its own.
export function fileMetaOf(path: string, files: BrainFileMeta[]): BrainFileMeta | null {
    const byPath = new Map(files.map(file => [file.path, file]))
    for (const candidate of [path, ...ancestorsOf(path).reverse()]) {
        const meta = byPath.get(candidate)
        if (meta) return meta
    }
    return null
}

export function allTags(pages: Pick<BrainPageSummary, 'tags'>[], files: Pick<BrainFileMeta, 'tags'>[]): string[] {
    return [...new Set([...pages, ...files].flatMap(item => item.tags))].sort()
}
