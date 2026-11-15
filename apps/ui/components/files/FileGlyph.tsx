'use client'

import { cn } from '@/lib/utils'
import type { ReactNode } from 'react'

import { FOLDER_BACK, FOLDER_FRONT, GLYPH_SIZE, SHEET_BODY, SHEET_FOLD, SHEET_FOLD_EDGE } from './glyph-paths'

const INK = 'rgb(var(--iso-tile-idle-ink) / 0.22)'
const INK_SOFT = 'rgb(var(--iso-tile-idle-ink) / 0.14)'

export const GLYPH_INK_MUTED = 'rgb(var(--iso-tile-idle-ink) / 0.5)'

function Face({ d, tone, sheen = true }: { d: string; tone?: number; sheen?: boolean }) {
    return (
        <div
            className="absolute inset-0"
            style={{
                clipPath: `path('${d}')`,
                backgroundColor: 'var(--iso-tile-idle)',
                filter: tone ? `brightness(${tone})` : undefined,
            }}
        >
            {sheen && <div className="absolute inset-0" style={{ background: 'var(--iso-tile-sheen)' }} />}
        </div>
    )
}

function Outline({ children }: { children: ReactNode }) {
    return (
        <svg viewBox={`0 0 ${GLYPH_SIZE} ${GLYPH_SIZE}`} className="absolute inset-0 size-full" fill="none" aria-hidden>
            {children}
        </svg>
    )
}

export function FolderGlyph({ children, className }: { children?: ReactNode; className?: string }) {
    return (
        <div className={cn('relative size-16', className)}>
            <Face d={FOLDER_BACK} tone={1.45} />
            <Face d={FOLDER_FRONT} />
            <Outline>
                <path d={FOLDER_BACK} stroke={INK} strokeWidth={1} />
                <path d={FOLDER_FRONT} stroke={INK} strokeWidth={1} />
            </Outline>
            {children}
        </div>
    )
}

export function FileSheetGlyph({ children, badge, className }: { children?: ReactNode; badge?: string; className?: string }) {
    return (
        <div className={cn('relative size-16', className)}>
            <Face d={SHEET_BODY} />
            <Face d={SHEET_FOLD} tone={0.84} sheen={false} />
            <Outline>
                <path d={SHEET_BODY} stroke={INK} strokeWidth={1} />
                <path d={SHEET_FOLD_EDGE} stroke={INK_SOFT} strokeWidth={1} />
            </Outline>
            {children}
            {badge && (
                <span
                    className="absolute bottom-[11px] left-[19px] w-[27px] truncate text-center text-[6px] font-semibold uppercase tracking-wider"
                    style={{ color: GLYPH_INK_MUTED }}
                >
                    {badge}
                </span>
            )}
        </div>
    )
}

export function ImageGlyph({ src, alt }: { src: string; alt: string }) {
    return (
        <div
            className="relative size-16 overflow-hidden rounded-[5px]"
            style={{ backgroundColor: 'var(--iso-tile-idle)', boxShadow: `inset 0 0 0 1px ${INK}` }}
        >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={src} alt={alt} loading="lazy" decoding="async" className="size-full object-cover" />
        </div>
    )
}
