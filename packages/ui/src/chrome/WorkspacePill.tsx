'use client'

import type { ComponentProps } from 'react'
import { ChevronsUpDownIcon } from '../icons'
import { ChromePill } from './ChromeSurface'
import { Stripes } from '../primitives/stripes'
import { WorkspaceLogoImage } from './WorkspaceLogoImage'

export type WorkspacePillProps = ComponentProps<'button'> & {
    name: string
    iconUrl: string
    fallbackIconUrl?: string
    stripes?: boolean
}

// Les enfants portent `relative` : les hachures sont un calque absolu, qui peint donc au-dessus du
// contenu resté en flux.
export function WorkspacePill({ name, iconUrl, fallbackIconUrl, stripes = false, className, ...props }: WorkspacePillProps) {
    return (
        <ChromePill start="avatar" end="icon" className={className} {...props}>
            {stripes && <Stripes className="rounded-full" color="color-mix(in oklab, var(--foreground) 6%, transparent)" />}
            <WorkspaceLogoImage src={iconUrl} fallbackSrc={fallbackIconUrl} className="relative size-6 rounded-full shrink-0 object-cover" />
            <span className="relative max-w-48 truncate">{name}</span>
            <ChevronsUpDownIcon className="relative size-4 text-muted-foreground shrink-0" />
        </ChromePill>
    )
}
