import type { TemplateCategory } from '@rerun/contracts'

export const WORK_TYPES = [
    'business-owner',
    'software-engineering',
    'finance',
    'product',
    'marketing',
    'consulting',
    'operations',
    'sales',
    'engineering',
    'healthcare',
    'legal',
    'student',
    'educator',
] as const
export type WorkType = (typeof WORK_TYPES)[number]

const TEMPLATE_CATEGORY_BY_WORK_TYPE: Record<WorkType, TemplateCategory> = {
    'business-owner': 'other',
    'software-engineering': 'saas',
    finance: 'productivity',
    product: 'saas',
    marketing: 'creators',
    consulting: 'agencies',
    operations: 'productivity',
    sales: 'sales',
    engineering: 'saas',
    healthcare: 'other',
    legal: 'legal',
    student: 'productivity',
    educator: 'creators',
}

export function workTypeTemplateCategory(workType: string | null | undefined): TemplateCategory | null {
    if (!workType || !isWorkType(workType)) return null
    return TEMPLATE_CATEGORY_BY_WORK_TYPE[workType]
}

export function isWorkType(value: string): value is WorkType {
    return (WORK_TYPES as readonly string[]).includes(value)
}
