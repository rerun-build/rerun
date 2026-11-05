import { ILLUSTRATION_ENTRIES } from '@/cloud/illustrations'

export type BlobColor =
    | 'amber'
    | 'green'
    | 'blue'
    | 'purple'
    | 'magenta'
    | 'pink'
    | 'coral'
    | 'pastel'
    | 'iridescent'
    | 'red'

export type BlobForm = 'blob' | 'bloom' | 'knot' | 'crystal' | 'vortex' | 'smoke' | 'crumple'

export type BlobIllustration = {
    file: string
    desc: string
    color: BlobColor
    form: BlobForm
    url: string
}

const BLOB_BUCKET = 'blob-illustrations'

export function blobUrl(file: string): string {
    return `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/${BLOB_BUCKET}/${file}`
}

export type BlobEntry = Omit<BlobIllustration, 'url'>

export const BLOB_ILLUSTRATIONS: readonly BlobIllustration[] = ILLUSTRATION_ENTRIES.map(entry => ({
    ...entry,
    url: blobUrl(entry.file),
}))

// Whether the workspace still carries an icon nobody chose. Seeding one from a company favicon must
// never overwrite a mark picked by hand.
export function isBlobUrl(url: string | null | undefined): boolean {
    return !!url && url.includes(`/${BLOB_BUCKET}/`)
}

export function getBlobByFile(file: string): BlobIllustration | undefined {
    return BLOB_ILLUSTRATIONS.find(blob => blob.file === file)
}

export function getBlobsByColor(color: BlobColor): BlobIllustration[] {
    return BLOB_ILLUSTRATIONS.filter(blob => blob.color === color)
}

export function getBlobsByForm(form: BlobForm): BlobIllustration[] {
    return BLOB_ILLUSTRATIONS.filter(blob => blob.form === form)
}

export function randomBlob(): BlobIllustration | undefined {
    return BLOB_ILLUSTRATIONS[Math.floor(Math.random() * BLOB_ILLUSTRATIONS.length)]
}
