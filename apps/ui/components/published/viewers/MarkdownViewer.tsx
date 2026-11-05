import { relativeDate } from '@/lib/data/friendly-columns'
import { FileTextIcon } from '@/lib/icons'
import { Markdown } from '@rerun/ui/markdown'
import { ViewerPage, ViewerTopBar } from './ViewerChrome'

// The chat's rich text, opened up for a full document: a page title, tables and images.
export const DOCUMENT_CLASS = [
    'text-[15px] leading-7',
    '[&_h1]:mb-4 [&_h1]:text-3xl [&_h1]:leading-tight [&_h1]:font-semibold [&_h1]:tracking-tight [&_h1]:text-balance max-md:[&_h1]:text-2xl',
    '[&_h2]:mt-8 [&_h2]:text-xl',
    '[&_table]:mt-4 [&_table]:w-full [&_table]:border-separate [&_table]:border-spacing-0 [&_table]:overflow-hidden [&_table]:rounded-lg [&_table]:border [&_table]:text-sm',
    '[&_thead]:bg-muted/50 [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_th]:font-medium [&_td]:border-t [&_td]:px-3 [&_td]:py-2 [&_td]:break-words',
    '[&_img]:mt-4 [&_img]:h-auto [&_img]:max-w-full [&_img]:rounded-md',
    '[&_pre]:bg-muted/60',
].join(' ')

// "Updated yesterday", "Updated 5 min ago", but "Updated Oct 28".
function updatedLabel(updatedAt: string): string {
    const when = relativeDate(updatedAt)
    return /^[A-Z][a-z]{2} \d/.test(when) ? when : when.charAt(0).toLowerCase() + when.slice(1)
}

export function MarkdownViewer({ slug, name, markdown, updatedAt }: { slug: string; name: string; markdown: string; updatedAt: string }) {
    return (
        <ViewerPage slug={slug} bar={<ViewerTopBar icon={FileTextIcon} name={name} meta="Markdown" />}>
            <article className="mx-auto flex max-w-[680px] flex-col px-6 pt-12 pb-24 max-md:px-5 max-md:pt-8">
                <p className="mb-4 text-xs text-muted-foreground">Updated {updatedLabel(updatedAt)}</p>
                <Markdown content={markdown} className={DOCUMENT_CLASS} />
            </article>
        </ViewerPage>
    )
}
