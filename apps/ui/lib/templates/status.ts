import { TEMPLATE_STATUSES, type TemplateStatus } from '@moldwright/contracts'
import type { BadgeTone } from '@moldwright/ui/primitives'
import { titleCase } from './labels'

const STATUS_TONES: Record<string, BadgeTone> = {
    in_review: 'orange',
    published: 'green',
    unlisted: 'cyan',
}

export type TemplateStatusCopy = (key: TemplateStatus) => string

export function templateStatusTone(status: string): BadgeTone {
    return STATUS_TONES[status] ?? 'neutral'
}

function isTemplateStatus(status: string): status is TemplateStatus {
    return (TEMPLATE_STATUSES as readonly string[]).includes(status)
}

export function templateStatusLabel(status: string, t: TemplateStatusCopy): string {
    return isTemplateStatus(status) ? t(status) : titleCase(status)
}
