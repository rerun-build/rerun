'use client'

import { isValidElement, type ComponentType, type ReactNode } from 'react'
import { DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Icon } from '@/components/ui/icon'

type IconGlyph = ComponentType<{ className?: string }>

// The one header every dialog of the app wears: an icon tile, the title, the description, and a
// line under it. Dialogs do not style their DialogHeader themselves, so they cannot drift apart.
// `children` is a row under the title inside the same band, such as a wizard's progress bar.
//
// In a padded DialogContent the band bleeds to the frame edges, the mirror of DialogFooter's
// `-mx-4 -mb-4`. A frame that drops its padding (`p-0`: PanelDialogContent, SplitDialogContent,
// the tabbed dialogs) already puts the band against its edges. The variant reads the frame rather
// than the direct parent because forms wrap the header.
//
// The title row stops short of the close button in the top right corner.
export function DialogHeaderBar({ icon, title, description, actions, children }: { icon: IconGlyph | ReactNode; title: ReactNode; description?: ReactNode; actions?: ReactNode; children?: ReactNode }) {
    return (
        <DialogHeader className="shrink-0 gap-4 border-b p-4 text-left [[data-slot=dialog-content]:not(.p-0)_&]:-mx-4 [[data-slot=dialog-content]:not(.p-0)_&]:-mt-4">
            <div className="flex items-center gap-3 pr-8">
                {isValidElement(icon) ? icon : <Icon size="md" icon={icon as IconGlyph} />}
                <div className="min-w-0 flex-1 space-y-1">
                    <DialogTitle className="leading-snug break-words">{title}</DialogTitle>
                    {description && <DialogDescription>{description}</DialogDescription>}
                </div>
                {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
            </div>
            {children}
        </DialogHeader>
    )
}
