import { Button } from '@/components/ui/button'
import { formatBytes } from '@/lib/files/format'
import { DownloadIcon, FileIcon } from '@/lib/icons'
import { DOWNLOAD_URL, ViewerPage } from './ViewerChrome'

export function DownloadCard({ slug, name, size }: { slug: string; name: string; size: number }) {
    return (
        <ViewerPage slug={slug} className="flex items-center justify-center p-6">
            <div className="flex w-full max-w-[320px] flex-col items-center gap-4 text-center">
                <span className="flex size-14 items-center justify-center rounded-2xl bg-muted">
                    <FileIcon className="size-6" />
                </span>
                <div className="flex flex-col gap-1">
                    <h1 className="text-base font-medium break-all">{name}</h1>
                    <span className="text-xs text-muted-foreground">{formatBytes(size)}</span>
                </div>
                <Button size="lg" className="w-full" asChild>
                    <a href={DOWNLOAD_URL} download>
                        <DownloadIcon />
                        Download
                    </a>
                </Button>
            </div>
        </ViewerPage>
    )
}
