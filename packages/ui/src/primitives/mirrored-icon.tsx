import type { FC, SVGProps } from 'react'
import { cn } from '../cn'

type IconComponent = FC<SVGProps<SVGSVGElement> & { size?: number | string; title?: string }>

// An arrow, a chevron or a send glyph points along the reading direction: in Arabic or Hebrew it is
// drawn mirrored, so "next" still points forward.
export function mirroredInRtl(Icon: IconComponent): IconComponent {
    const Mirrored: IconComponent = ({ className, ...props }) => <Icon className={cn('rtl:-scale-x-100', className)} {...props} />
    Mirrored.displayName = `MirroredInRtl(${Icon.displayName ?? Icon.name})`
    return Mirrored
}
