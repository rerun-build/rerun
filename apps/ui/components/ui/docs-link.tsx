import { ExternalLinkIcon } from '@/lib/icons'
import { RerunOnly } from '@/components/brand/RerunOnly'
import { docsUrl } from '@/lib/site'

// A page of Rerun's docs, which another brand has no counterpart of.
// `normal-case` because this sits next to the uppercase section titles of the dialogs.
export function DocsLink({ path, children }: { path?: string; children: string }) {
    return (
        <RerunOnly>
            <a
                href={docsUrl(path)}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground normal-case hover:text-foreground"
            >
                {children}
                <ExternalLinkIcon className="size-3" />
            </a>
        </RerunOnly>
    )
}
