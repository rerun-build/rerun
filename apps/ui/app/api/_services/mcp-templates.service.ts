import { defaultExcludedPaths } from '@rerun/contracts'
import { z } from 'zod'
import { requireSandboxAuthorKey, type TemplateAuthorScope } from '@/app/api/_auth/expert'
import { isPayoutReady } from '@rerun/cloud/marketplace.server'
import { asString, asStringArray, requireConfirmation, requireString } from '@/lib/mcp/args'
import {
    addAuthorTemplateImage,
    createAuthorTemplateDraft,
    deleteAuthorTemplate,
    listAuthorTemplates,
    loadAuthorTemplate,
    submitAuthorTemplate,
    updateAuthorTemplate,
    withdrawAuthorTemplate,
} from '@/lib/templates/author'
import { captureAuthorAgents, listAuthorCaptureSources, planAuthorCapture, removeAuthorTemplateAgent } from '@/lib/templates/author-capture'
import { captureSetupSchema, type AgentCapturePlan } from '@/lib/templates/capture'
import { pickSentFields, templateAuthorPatchSchema, templateEditBlockReason } from '@/lib/templates/expert'
import { templateSubmitChecklist } from '@/lib/templates/submit'
import { englishTranslator } from '@/lib/i18n/english-translator'

// The template-authoring half of the account MCP server (app/api/mcp/account/route.ts). The key
// names a workspace, so the author is resolved from it once, here, and every handler below is
// handed a scope it cannot widen. Everything these handlers do is a call into lib/templates: the
// panel in the app runs the same functions, which is why "submitted from Claude Code" and
// "submitted from the app" cannot drift apart.

// `.strict()` so a misspelled field is an error the model can read rather than a silent no-op.
const updatePatchSchema = templateAuthorPatchSchema.strict()

const captureRequestSchema = z.object({
    agentId: z.string().uuid(),
    exclude: z.array(z.string()).default([]),
    keep: z.array(z.string()).default([]),
    setup: captureSetupSchema.optional(),
})

// A raw ZodError serialises as a JSON blob the calling model has to parse to learn it priced a
// template at $2. One sentence instead.
function readableZodError(error: z.ZodError): Error {
    return new Error(error.issues.map(issue => `${issue.path.join('.') || 'input'}: ${issue.message}`).join('; '))
}

function projectPlan(plan: AgentCapturePlan) {
    return {
        agentId: plan.agentRowId,
        name: plan.displayName || plan.name,
        description: plan.description,
        provider: plan.provider,
        model: plan.model,
        totalBytes: plan.totalBytes,
        connectorSlugs: plan.connectorSlugs,
        skills: plan.skills.map(skill => ({ name: skill.name, description: skill.description })),
        schedules: plan.schedules.map(schedule => ({ name: schedule.name, cron: schedule.cron })),
        // The instruction and the accepted methods, never the URL: the copy is issued its own.
        triggers: plan.triggers.map(trigger => ({ name: trigger.name, description: trigger.description, methods: trigger.methods, enabled: trigger.enabled })),
        // Names only, never values: the archive ships `.env` keys empty, and this is the shopping
        // list whoever installs the template will be asked for.
        envKeys: plan.envKeys,
        mcpAuth: plan.mcpAuth,
        memoryCount: plan.memoryCount,
        setup: plan.setup,
        strippedConfigKeys: plan.strippedConfigKeys,
        redactions: plan.redactions,
        excludedByDefault: defaultExcludedPaths(plan),
        flaggedFiles: plan.files
            .filter(file => file.flagged.length > 0 || file.defaultExcluded)
            .map(file => ({ path: file.path, bytes: file.bytes, flagged: file.flagged, note: file.note, excludedByDefault: file.defaultExcluded })),
    }
}

// The wizard in the app starts from the engine's own exclusions, and a model that shipped a memory
// folder by omission could not take it back once the archive sits behind a public install button.
// Same defaults here; `keep` is the deliberate way out of one.
function toSelections(plans: AgentCapturePlan[], requested: z.infer<typeof captureRequestSchema>[]) {
    return requested.map(entry => {
        const plan = plans.find(candidate => candidate.agentRowId === entry.agentId)
        if (!plan) throw new Error(`Coworker ${entry.agentId} could not be inspected on the machine of this workspace.`)

        const kept = new Set(entry.keep)
        return {
            agentRowId: entry.agentId,
            exclude: [...new Set([...defaultExcludedPaths(plan).filter(path => !kept.has(path)), ...entry.exclude])],
            setup: entry.setup,
        }
    })
}

export async function dispatchTemplateTool(workspaceId: number, name: string, args: Record<string, unknown>): Promise<unknown> {
    try {
        return await runTemplateTool(workspaceId, name, args)
    } catch (err) {
        throw err instanceof z.ZodError ? readableZodError(err) : err
    }
}

async function runTemplateTool(workspaceId: number, name: string, args: Record<string, unknown>): Promise<unknown> {
    const scope: TemplateAuthorScope = await requireSandboxAuthorKey(workspaceId)

    switch (name) {
        case 'list_templates': {
            const templates = await listAuthorTemplates(scope.userId)
            return {
                templates: templates.map(template => ({
                    templateId: template.id,
                    slug: template.slug,
                    title: template.title,
                    tagline: template.tagline,
                    category: template.category,
                    status: template.status,
                    agentCount: template.agentCount,
                    pricing: template.pricing,
                    coverUrl: template.coverUrl,
                    submittedAt: template.submittedAt,
                    reviewNote: template.reviewNote,
                    updatedAt: template.updatedAt,
                    editBlockReason: templateEditBlockReason(template.status),
                })),
            }
        }

        case 'get_template': {
            const detail = await loadAuthorTemplate(scope.userId, requireString(args.templateId, 'templateId'))
            const doc = detail.document
            // The one thing the checklist cannot answer on its own, and the one that decides
            // whether a paid submission goes through.
            const checklist = templateSubmitChecklist(doc, englishTranslator('templates.expert.footer'), { payoutsReady: await isPayoutReady(doc.creatorId) })

            return {
                templateId: detail.id,
                slug: doc.slug,
                status: detail.status,
                submittedAt: detail.submittedAt,
                reviewNote: detail.reviewNote,
                editBlockReason: templateEditBlockReason(detail.status),
                document: {
                    title: doc.title,
                    tagline: doc.tagline,
                    longDescription: doc.longDescription,
                    category: doc.category,
                    tags: doc.tags,
                    setupMinutes: doc.setupMinutes,
                    gallery: doc.gallery,
                    videoUrl: doc.videoUrl,
                    faq: doc.faq,
                    metaTitle: doc.metaTitle,
                    metaDescription: doc.metaDescription,
                    pricingModel: doc.pricingModel,
                    priceAmountCents: doc.priceAmountCents,
                },
                agents: detail.agents,
                submitChecklist: checklist.map(({ label, met }) => ({ label, met })),
                readyToSubmit: checklist.every(requirement => requirement.met),
                missing: checklist.filter(requirement => !requirement.met).map(requirement => requirement.label),
            }
        }

        case 'create_template': {
            const { id, slug } = await createAuthorTemplateDraft(scope.userId, requireString(args.title, 'title'))
            return {
                templateId: id,
                slug,
                status: 'draft',
                note: 'Empty draft, private. Write the page with update_template, capture coworkers with capture_template_agents, add a cover with add_template_image, then submit_template.',
            }
        }

        case 'update_template': {
            const templateId = requireString(args.templateId, 'templateId')
            const sent = Object.fromEntries(Object.entries(args).filter(([key]) => key !== 'templateId'))

            // `.partial()` does not cancel the `.default()` every field carries, so parsing alone
            // would hand back an empty tagline and a price of 0 for a call that only meant to fix
            // the title. Only the keys the caller actually sent make it into the patch.
            const patch = pickSentFields(updatePatchSchema.parse(sent), sent)
            if (Object.keys(patch).length === 0) throw new Error('Nothing to update: pass at least one field besides templateId.')

            const { warnings } = await updateAuthorTemplate(scope.userId, templateId, patch)
            return { templateId, updated: Object.keys(patch), warnings }
        }

        case 'submit_template': {
            const templateId = requireString(args.templateId, 'templateId')
            await submitAuthorTemplate(scope.userId, templateId)
            return {
                templateId,
                status: 'in_review',
                note: 'Handed to the Rerun team. It stays private and frozen until they publish it or send it back. withdraw_template takes it back to draft.',
            }
        }

        case 'withdraw_template': {
            const templateId = requireString(args.templateId, 'templateId')
            await withdrawAuthorTemplate(scope.userId, templateId)
            return { templateId, status: 'draft' }
        }

        case 'delete_template': {
            requireConfirmation(args, 'the template and the coworker archives captured into it')
            const templateId = requireString(args.templateId, 'templateId')
            await deleteAuthorTemplate(scope.userId, templateId)
            return { templateId, deleted: true }
        }

        case 'list_capture_sources': {
            const spaces = await listAuthorCaptureSources(scope)
            return {
                spaces: spaces.map(space => ({
                    spaceId: space.id,
                    name: space.name,
                    agents: space.agents.map(agent => ({ agentId: agent.id, name: agent.name, handle: agent.handle, description: agent.description, status: agent.status })),
                })),
                // Reaching this line already means the key passed the sandbox gate, so an empty list
                // is an empty sandbox and never a refusal. A model that reads it as one stops before
                // building the very agents that would fill it.
                ...(spaces.length === 0
                    ? { note: 'This key is on an eligible sandbox and it holds no coworker yet, which is the normal state before you build any. This is not a refusal: a refusal comes back as an error naming the condition that failed. Create the coworkers with create_agent, in a Box from list_spaces, and they appear here.' }
                    : {}),
            }
        }

        case 'plan_template_capture': {
            const agentIds = asStringArray(args.agentIds)
            if (agentIds.length === 0) throw new Error('Pass at least one agentId, from list_capture_sources.')

            const plans = await planAuthorCapture(scope, {
                templateId: requireString(args.templateId, 'templateId'),
                spaceId: requireString(args.spaceId, 'spaceId'),
                agentIds,
            })
            return { plans: plans.map(projectPlan) }
        }

        case 'capture_template_agents': {
            const templateId = requireString(args.templateId, 'templateId')
            const spaceId = requireString(args.spaceId, 'spaceId')
            const requested = z.array(captureRequestSchema).min(1, 'Pass at least one coworker, e.g. agents: [{"agentId": "…"}].').parse(args.agents)

            const plans = await planAuthorCapture(scope, { templateId, spaceId, agentIds: requested.map(entry => entry.agentId) })
            const selections = toSelections(plans, requested)

            const { captured, warnings } = await captureAuthorAgents(scope, { templateId, spaceId, selections })
            return {
                templateId,
                captured,
                excluded: selections.map(selection => ({ agentId: selection.agentRowId, paths: selection.exclude })),
                warnings,
            }
        }

        case 'remove_template_agent': {
            requireConfirmation(args, 'the captured coworker and its archive')
            const templateId = requireString(args.templateId, 'templateId')
            const agentKey = requireString(args.agentKey, 'agentKey')
            await removeAuthorTemplateAgent(scope, { templateId, agentKey })
            return { templateId, agentKey, removed: true }
        }

        case 'add_template_image': {
            const templateId = requireString(args.templateId, 'templateId')
            const { url, position, galleryCount } = await addAuthorTemplateImage(scope.userId, templateId, {
                imageUrl: requireString(args.imageUrl, 'imageUrl'),
                alt: asString(args.alt),
                cover: args.cover === true,
            })
            return { templateId, url, position, galleryCount, note: 'Stored in Rerun media, not hotlinked from the URL you passed.' }
        }

        default:
            throw new Error(`Unknown tool: ${name}`)
    }
}
