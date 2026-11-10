'use client'

import * as React from 'react'
import { useCallback, useId, useState } from 'react'

import { cn } from '../cn'
import { useKitTranslations } from '../locale'

type FileDropzoneRenderProps = { dragOver: boolean; inputId: string }

interface FileDropzoneProps {
    onFiles: (files: File[]) => void
    accept?: string
    multiple?: boolean
    disabled?: boolean
    overlayLabel?: string
    className?: string
    children: React.ReactNode | ((state: FileDropzoneRenderProps) => React.ReactNode)
}

export function FileDropzone({ onFiles, accept, multiple = false, disabled, overlayLabel, className, children }: FileDropzoneProps) {
    const t = useKitTranslations()
    const inputId = useId()
    const [dragOver, setDragOver] = useState(false)

    const emit = useCallback(
        (fileList: FileList | null) => {
            const files = Array.from(fileList ?? [])
            if (files.length) onFiles(multiple ? files : files.slice(0, 1))
        },
        [onFiles, multiple],
    )

    const handleChange = useCallback(
        (e: React.ChangeEvent<HTMLInputElement>) => {
            emit(e.target.files)
            e.target.value = ''
        },
        [emit],
    )

    const handleDrop = useCallback(
        (e: React.DragEvent) => {
            e.preventDefault()
            setDragOver(false)
            if (disabled) return
            emit(e.dataTransfer.files)
        },
        [disabled, emit],
    )

    const handleDragOver = useCallback(
        (e: React.DragEvent) => {
            if (disabled) return
            e.preventDefault()
            setDragOver(true)
        },
        [disabled],
    )

    const handleDragLeave = useCallback((e: React.DragEvent) => {
        if (e.currentTarget.contains(e.relatedTarget as Node | null)) return
        setDragOver(false)
    }, [])

    return (
        <div className={cn('relative', dragOver && 'rounded-lg ring-2 ring-inset ring-primary/50', className)} onDrop={handleDrop} onDragOver={handleDragOver} onDragLeave={handleDragLeave}>
            <input id={inputId} type="file" accept={accept} multiple={multiple} disabled={disabled} className="hidden" onChange={handleChange} />
            {typeof children === 'function' ? (children as (state: FileDropzoneRenderProps) => React.ReactNode)({ dragOver, inputId }) : children}
            {dragOver && (
                <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-lg bg-primary/5">
                    <p className="text-sm font-medium text-primary">{overlayLabel ?? t('forms.dropFile')}</p>
                </div>
            )}
        </div>
    )
}
