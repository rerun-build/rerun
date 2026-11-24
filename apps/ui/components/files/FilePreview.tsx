'use client'

import { DOCUMENT_CLASS } from '@/components/published/viewers/MarkdownViewer'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { filePreviewKind, framedHtmlDocument, textPreviewFormat, type TextPreviewFormat } from '@/lib/files/preview'
import { Code2, DownloadIcon, EyeIcon, FileIcon } from '@/lib/icons'
import { withoutFrontmatter } from '@/lib/published/viewer-kind'
import { cn } from '@/lib/utils'
import { Markdown } from '@rerun/ui/markdown'
import { useTranslations } from 'next-intl'
import { useState } from 'react'

type FilePreviewProps = {
    fileName: string
    content: string | null
    rawUrl: string
    loading: boolean
}

export function FilePreview({ fileName, content, rawUrl, loading }: FilePreviewProps) {
    const t = useTranslations('files.preview')
    if (loading) return <FilePreviewSkeleton />

    const kind = filePreviewKind(fileName)

    if (kind === 'image') {
        return (
            <div className="flex h-full items-center justify-center overflow-auto bg-muted p-3">
                {/* eslint-disable-next-line @next/next/no-img-element -- arbitrary proxied file bytes, no fixed dimensions or configured loader */}
                <img src={rawUrl} alt={fileName} className="max-h-full max-w-full object-contain" />
            </div>
        )
    }
    if (kind === 'pdf') return <iframe src={rawUrl} title={fileName} className="h-full w-full bg-white" />
    if (kind === 'audio') {
        return (
            <div className="flex h-full items-center justify-center p-4">
                <audio controls src={rawUrl} className="w-full max-w-md" />
            </div>
        )
    }
    if (kind === 'video') {
        return (
            <div className="flex h-full items-center justify-center overflow-auto bg-muted p-3">
                <video controls src={rawUrl} className="max-h-full max-w-full" />
            </div>
        )
    }
    // An extension we do not know can still hide a binary: a zip or OLE package carries NUL bytes, so it is
    // offered as a download. A text file in another encoding still draws, its accents as U+FFFD.
    if (kind === 'text' && content !== null && !content.includes('\u0000')) {
        const format = textPreviewFormat(fileName)
        if (format === 'plain') return <SourceText content={content} />
        return <RenderedText key={fileName} fileName={fileName} format={format} content={content} />
    }

    return (
        <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center text-muted-foreground">
            <FileIcon className="size-8" />
            <p className="text-xs">{t('noPreview')}</p>
            <Button asChild variant="outline" size="sm">
                <a href={rawUrl} download={fileName}>
                    <DownloadIcon className="size-3.5" />
                    {t('download')}
                </a>
            </Button>
        </div>
    )
}

function SourceText({ content, className }: { content: string; className?: string }) {
    return <pre className={cn('h-full overflow-auto p-3 text-xs font-mono whitespace-pre-wrap break-all', className)}>{content}</pre>
}

function RenderedText({ fileName, format, content }: { fileName: string; format: Exclude<TextPreviewFormat, 'plain'>; content: string }) {
    const t = useTranslations('files.preview')
    const [showSource, setShowSource] = useState(false)
    const toggleLabel = showSource ? t('showRendered') : t('showSource')

    return (
        <div className="relative h-full">
            {showSource ? (
                <SourceText content={content} className="pe-12" />
            ) : format === 'html' ? (
                // No scripts and an opaque origin: whatever a coworker wrote in the page can neither run
                // nor reach the app's session. Popups only, so its links open in a tab of their own.
                <iframe sandbox="allow-popups allow-popups-to-escape-sandbox" srcDoc={framedHtmlDocument(content)} title={fileName} className="h-full w-full bg-white" />
            ) : (
                <div className="h-full overflow-auto py-4 pe-12 ps-4 sm:ps-6">
                    <Markdown content={withoutFrontmatter(content)} className={DOCUMENT_CLASS} />
                </div>
            )}
            <div className="absolute top-2 end-2 rounded-md bg-background shadow-sm">
                <Button size="icon-sm" variant="outline" onClick={() => setShowSource(current => !current)} title={toggleLabel} aria-label={toggleLabel}>
                    {showSource ? <EyeIcon className="size-4" /> : <Code2 className="size-4" />}
                </Button>
            </div>
        </div>
    )
}

const BODY_WIDTHS = ['w-4/5', 'w-full', 'w-3/5', 'w-11/12', 'w-2/3', 'w-3/4', 'w-1/2']

function FilePreviewSkeleton() {
    return (
        <div className="h-full space-y-1.5 p-3">
            {BODY_WIDTHS.map((width, index) => (
                <Skeleton key={index} className={`h-3 ${width}`} />
            ))}
        </div>
    )
}
