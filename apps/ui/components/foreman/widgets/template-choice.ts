import { asStringArray } from '@/lib/mcp/args'

export type TemplateChoice = { answered: true; chosen: string } | { answered: true; custom: true } | { answered: false }

export type ShownTemplate = { slug: string; title: string; why: string; agents?: number; connectors: string[] }

export function readTemplates(input: unknown): { templates: ShownTemplate[]; allowCustom: boolean } {
    const args = input && typeof input === 'object' ? (input as Record<string, unknown>) : {}
    const rows = Array.isArray(args.templates) ? args.templates : []
    const templates = rows.flatMap(row => {
        if (!row || typeof row !== 'object') return []
        const value = row as Record<string, unknown>
        if (typeof value.slug !== 'string' || typeof value.title !== 'string') return []
        return [
            {
                slug: value.slug,
                title: value.title,
                why: typeof value.why === 'string' ? value.why : '',
                agents: typeof value.agents === 'number' ? value.agents : undefined,
                connectors: asStringArray(value.connectors),
            },
        ]
    })
    return { templates: templates.slice(0, 3), allowCustom: args.allow_custom === true }
}

export function readOutput(output: unknown): TemplateChoice | null {
    if (!output || typeof output !== 'object') return null
    const value = output as Record<string, unknown>
    if (value.answered !== true) return { answered: false }
    if (value.custom === true) return { answered: true, custom: true }
    return typeof value.chosen === 'string' ? { answered: true, chosen: value.chosen } : { answered: false }
}
