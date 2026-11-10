import { z } from 'zod'
import type { TemplateFormValues } from '@/lib/templates/edit-schema'

// The brief comes from the form rather than the stored row so a draft that has never been
// saved can still be described.
const briefAgentSchema = z.object({
    name: z.string().default(''),
    role: z.string().default(''),
    description: z.string().default(''),
    skills: z.array(z.object({ name: z.string().default(''), description: z.string().default('') })).default([]),
    schedules: z.array(z.object({ name: z.string().default(''), cron: z.string().default('') })).default([]),
    triggers: z.array(z.object({ name: z.string().default(''), description: z.string().default('') })).default([]),
    connectors: z.array(z.string()).default([]),
})

export const templateBriefSchema = z.object({
    title: z.string().min(1, 'templateTitleFirst'),
    tagline: z.string().default(''),
    category: z.string().default(''),
    tags: z.array(z.string()).default([]),
    setupMinutes: z.number().int().positive().default(5),
    connectors: z.array(z.string()).default([]),
    agents: z.array(briefAgentSchema).default([]),
})

export type TemplateBrief = z.infer<typeof templateBriefSchema>

export function toTemplateBrief(values: TemplateFormValues): TemplateBrief {
    return {
        title: values.title,
        tagline: values.tagline,
        category: values.category,
        tags: values.tags,
        setupMinutes: values.setupMinutes,
        connectors: [...new Set(values.agents.flatMap(agent => agent.connectorSlugs))],
        agents: values.agents.map(agent => ({
            name: agent.name,
            role: agent.role,
            description: agent.description,
            skills: agent.skills.map(skill => ({ name: skill.name, description: skill.description })),
            schedules: agent.schedules.map(schedule => ({ name: schedule.name, cron: schedule.cron })),
            triggers: agent.triggers.map(trigger => ({ name: trigger.name, description: trigger.description })),
            connectors: agent.connectorSlugs,
        })),
    }
}

// A brief carries connector slugs because that is what the agents store, and `google-sheets`
// is not what a title should say. The map comes from the services catalog, which the client
// building the brief has no read on, so the swap happens on the way into the writer.
export function withConnectorNames(brief: TemplateBrief, names: Map<string, string>): TemplateBrief {
    const named = (slugs: string[]) => slugs.map(slug => names.get(slug) ?? slug)

    return {
        ...brief,
        connectors: named(brief.connectors),
        agents: brief.agents.map(agent => ({ ...agent, connectors: named(agent.connectors) })),
    }
}

// The task lives in the skills and the schedules as much as in the tagline, so every writer
// gets all of it: a title alone is what produced generic, interchangeable output.
export function describeTemplate({
    title,
    tagline,
    category,
    tags,
    setupMinutes,
    connectors,
    agents,
}: TemplateBrief): string {
    const lines = [`Template: ${title}`]
    if (tagline) lines.push(`Tagline: ${tagline}`)
    if (category) lines.push(`Category: ${category}`)
    if (tags.length) lines.push(`Tags: ${tags.join(', ')}`)
    lines.push(`Setup time: about ${setupMinutes} minutes`)
    if (connectors.length) lines.push(`Works with: ${connectors.join(', ')}`)

    for (const agent of agents) {
        lines.push('', `Coworker "${agent.name}"${agent.role ? ` - ${agent.role}` : ''}`)
        if (agent.description) lines.push(`  Does: ${agent.description}`)
        for (const skill of agent.skills) {
            lines.push(`  Skill "${skill.name}"${skill.description ? `: ${excerpt(skill.description, 200)}` : ''}`)
        }
        for (const schedule of agent.schedules) {
            lines.push(`  Runs on a schedule "${schedule.name}"${schedule.cron ? `: cron ${schedule.cron}` : ''}`)
        }
        for (const trigger of agent.triggers) {
            lines.push(`  Starts on a webhook "${trigger.name}"${trigger.description ? `: ${excerpt(trigger.description, 200)}` : ''}`)
        }
        if (agent.connectors.length) lines.push(`  Uses: ${agent.connectors.join(', ')}`)
    }

    return lines.join('\n')
}

function excerpt(value: string, max: number): string {
    const flat = value.replace(/\s+/g, ' ').trim()
    return flat.length <= max ? flat : `${flat.slice(0, max)}…`
}
