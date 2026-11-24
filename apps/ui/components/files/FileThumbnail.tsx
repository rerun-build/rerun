'use client'

import type { FileEntry } from '@/app/api/_actions/workspace-file.actions'
import { fileExtension, filePreviewKind, fileTypeIcon, THUMB_IMAGE_MAX_BYTES, THUMB_TEXT_MAX_BYTES } from '@/lib/files/preview'
import { LinkIcon } from '@/lib/icons'
import type { LucideIcon } from '@/lib/icons'
import { useEffect, useRef } from 'react'

import { FileSheetGlyph, FolderGlyph, GLYPH_INK_MUTED, ImageGlyph } from './FileGlyph'
import { useInViewport } from './useFileThumbnails'

type FileThumbnailProps = {
    entry: FileEntry
    path: string
    rawUrl: string
    textHead: string | undefined
    onRequestText: (path: string) => void
}

function SheetIcon({ icon: Glyph }: { icon: LucideIcon }) {
    return <Glyph className="absolute start-[24.5px] top-[26px] size-4" style={{ color: GLYPH_INK_MUTED }} />
}

export function FileThumbnail({ entry, path, rawUrl, textHead, onRequestText }: FileThumbnailProps) {
    const ref = useRef<HTMLDivElement>(null)
    const visible = useInViewport(ref)
    const kind = filePreviewKind(entry.name)
    const wantsText = entry.type === 'file' && kind === 'text' && entry.size > 0 && entry.size <= THUMB_TEXT_MAX_BYTES

    useEffect(() => {
        if (visible && wantsText) onRequestText(path)
    }, [visible, wantsText, path, onRequestText])

    if (entry.type === 'dir') {
        return (
            <div ref={ref}>
                <FolderGlyph />
            </div>
        )
    }

    if (entry.type === 'symlink') {
        return (
            <div ref={ref}>
                <FileSheetGlyph>
                    <SheetIcon icon={LinkIcon} />
                </FileSheetGlyph>
            </div>
        )
    }

    if (kind === 'image' && entry.size <= THUMB_IMAGE_MAX_BYTES) {
        return (
            <div ref={ref}>
                <ImageGlyph src={rawUrl} alt={entry.name} />
            </div>
        )
    }

    const badge = fileExtension(entry.name) || undefined
    const glyph = fileTypeIcon(entry.name)

    return (
        <div ref={ref}>
            <FileSheetGlyph badge={textHead ? undefined : badge}>
                {textHead ? (
                    <pre
                        className="absolute start-[19px] top-[22px] h-[29px] w-[27px] overflow-hidden text-[4px] leading-[5.5px] font-mono whitespace-pre"
                        style={{ color: GLYPH_INK_MUTED }}
                    >
                        {textHead}
                    </pre>
                ) : (
                    glyph && <SheetIcon icon={glyph} />
                )}
            </FileSheetGlyph>
        </div>
    )
}
