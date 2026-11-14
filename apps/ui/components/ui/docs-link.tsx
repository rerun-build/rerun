import { ExternalLinkIcon } from '@/lib/icons'
import { docsUrl } from '@/lib/site'

export function DocsLink({ path, children }: { path?: string; children: string }) {
    return (
        <a
            href={docsUrl(path)}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground normal-case hover:text-foreground"
        >
            {children}
            <ExternalLinkIcon className="size-3" />
        </a>
    )
}
