import { tool, type ToolSet } from 'ai'
import { z } from 'zod'
import { brainProposalInputSchema, FOREMAN_AGENT_ID, normalizeBrainTags } from '@rerun/contracts'
import { deletePage, getPage, listPages, listRevisions, pageHash, readPageFile, writePage } from '../../brain/pages.js'
import { searchBrain } from '../../brain/search.js'
import { agentSpaceId } from '../../brain/boxes.js'
import { acceptProposal, dismissProposal, findProposalByFingerprint, getProposal, insertProposal, listProposals, openProposalFor, proposalFingerprint, replaceOpenProposal } from '../../brain/proposals.js'
import { HttpError } from '../../lib/errors.js'
import type { RunContext } from '../../runtime/context.js'

const EXCERPT_CHARS = 600

const PROPOSED = 'Sent for review. A person accepts or dismisses it from the Brain; until then the page is unchanged, so do not tell the user it is saved. Mention it in one short sentence at most.'
const UPDATED = 'Replaced your change still waiting for review on this page. Mention it in one short sentence at most.'
const ALREADY = 'This exact change was already proposed once. Nothing sent, and do not raise it again.'

// The card in the chat is matched to its proposal through this result rather than through the tool
// call id: the MCP bridge the CLI providers go through hands `execute` an id the transcript never carries.
function proposalResult(status: 'proposed' | 'updated', proposalId: string, slug: string, title: string, message: string): string {
    return JSON.stringify({ status, proposalId, slug, title, message })
}

const excerpt = (text: string, max = EXCERPT_CHARS) => (text.length > max ? `${text.slice(0, max - 3)}...` : text)

// The foreman writes the brain as itself, on behalf of the person it is talking to: the engine has
// no notion of users, and the person already said yes in the conversation.
export const FOREMAN_BRAIN_AUTHOR = `agent:${FOREMAN_AGENT_ID}`

const PROPOSAL_EXCERPT_CHARS = 1500

const UNCONFIRMED_NOTE = 'imported from the public web, nobody at the company confirmed them'

const isUnconfirmed = (heading: string, unconfirmed: Set<string>) => heading.split(' / ').some(part => unconfirmed.has(part))

const tagList = (tags: string[]) => tags.map(tag => `#${tag}`).join(' ')

// Where a page is filed, as the coworker reading it sees it: its own Box, another one, or everyone.
function filedUnder(pageSpaceId: string | null, ownSpaceId: string | null): string {
    if (pageSpaceId === null) return 'everyone'
    return ownSpaceId !== null && pageSpaceId === ownSpaceId ? 'your Box' : 'another Box'
}

type OwnBox = () => Promise<string | null>

const NO_BOX: OwnBox = async () => null

function readTools(ownBox: OwnBox): ToolSet {
    return {
        brain_search: tool({
            description:
                'Search the company brain, what is known about this company (offering, products, pricing, customers, competitors, team, voice, tools, decisions), by meaning and by keyword. Returns the best passages of each matching page and the pages linked to them. brain_read a page to get all of it. Your Box\'s pages come first; tags or onlyMyBox narrow the search, null for the whole brain.',
            inputSchema: z.object({
                query: z.string().min(1),
                limit: z.number().int().positive().max(10).default(5),
                tags: z.array(z.string()).nullable().default(null),
                onlyMyBox: z.boolean().nullable().default(null),
            }),
            execute: async ({ query, limit, tags, onlyMyBox }) => {
                const ownSpaceId = await ownBox()
                if (onlyMyBox && !ownSpaceId) return 'You are not in a Box yet, so nothing is filed under yours. Search again without onlyMyBox.'
                const wanted = tags ? normalizeBrainTags(tags) : []
                const { hits, related } = await searchBrain(query, { limit, tags: wanted, onlySpaceId: onlyMyBox && ownSpaceId ? ownSpaceId : undefined, preferSpaceId: ownSpaceId })
                if (hits.length === 0) {
                    const filtered = wanted.length > 0 || onlyMyBox
                    return filtered ? 'Nothing matches with these filters. Search again without them.' : 'Nothing in the company brain matches. It may simply not be written down yet.'
                }
                const files = await Promise.all(hits.map(hit => readPageFile(hit.slug)))
                const blocks = hits.map((hit, i) => {
                    const unconfirmed = new Set(files[i]?.unconfirmed ?? [])
                    const passages = hit.passages.map(p => `  > ${p.heading}${isUnconfirmed(p.heading, unconfirmed) ? ' (unconfirmed)' : ''}: ${excerpt(p.content)}`)
                    const filing = [hit.tags.length ? tagList(hit.tags) : '', ownSpaceId && hit.spaceId === ownSpaceId ? 'your Box' : ''].filter(Boolean).join(' · ')
                    return [`[[${hit.slug}]] ${hit.title} (${hit.type})${filing ? ` ${filing}` : ''}`, ...passages].join('\n')
                })
                const relatedLine = related.length ? `\n\nLinked pages: ${related.map(r => `[[${r.slug}]] ${r.title}`).join(', ')}` : ''
                return `${blocks.join('\n\n')}${relatedLine}`
            },
        }),
        brain_read: tool({
            description: 'Read one page of the company brain in full, with its hash (needed to propose a change to it), its sources and the pages that link to it.',
            inputSchema: z.object({ slug: z.string().min(1) }),
            execute: async ({ slug }) => {
                const [page, ownSpaceId] = await Promise.all([getPage(slug), ownBox()])
                if (!page) {
                    const slugs = (await listPages()).map(p => p.slug)
                    return `No page "${slug}" in the company brain.${slugs.length ? ` Existing pages: ${slugs.join(', ')}.` : ' The brain is still empty.'}`
                }
                const meta = [
                    `slug: ${page.slug} | type: ${page.type} | hash: ${page.hash}`,
                    `updated ${page.updatedAt || 'at an unknown date'} by ${page.updatedBy}${page.createdBy && page.createdBy !== page.updatedBy ? `, added by ${page.createdBy}` : ''}`,
                    `filed under: ${filedUnder(page.spaceId, ownSpaceId)}${page.tags.length ? ` | tags: ${tagList(page.tags)}` : ''}`,
                    page.sources.length ? `sources: ${page.sources.join('; ')}` : '',
                    page.unconfirmed.length ? `unconfirmed sections: ${page.unconfirmed.join(', ')} (${UNCONFIRMED_NOTE})` : '',
                    page.backlinks.length ? `linked from: ${page.backlinks.map(b => `[[${b.slug}]]`).join(', ')}` : '',
                ].filter(Boolean)
                return `# ${page.title}\n${meta.join('\n')}\n\n${page.content}`
            },
        }),
    }
}

const TAGS_HOW = 'tags: topic tags to add (a customer, a project), or null.'

export function brainTools(ctx: RunContext): ToolSet {
    const ownBox: OwnBox = () => agentSpaceId(ctx.agent.id)
    return {
        ...readTools(ownBox),
        // A person correcting a fact in the chat already decided it: every coworker reads the fix
        // from its next run instead of the old version waiting behind a review.
        brain_write: writeTool(
            `agent:${ctx.agent.config.name}`,
            `Save at once a fact about the company the user told you, corrected or confirmed in this conversation (sources: "told by the user in chat"); every coworker reads it from its next run. A fact you found yourself goes to brain_propose. First brain_search the old fact and fix every page repeating it. ${WRITE_PAGE_HOW} ${TAGS_HOW}`,
            ownBox,
            () => (ctx.author ? null : NO_PERSON_HERE)
        ),
        brain_propose: tool({
            description:
                'Propose a new page or a change to a page of the company brain, for a fact you found on your own (on the web, in a file, in a tool result); a fact the user told you in this conversation goes to brain_write. It writes nothing: a person reviews the change and accepts or dismisses it. Give the complete page as content, in markdown, keeping everything still true; it replaces the whole page once accepted. The person decides from headline (the news in a few words, like a newspaper title: "Pricing is now public") and highlights (one to four facts that move, each with a short unique label, before: what the page says today or null when the fact is new, after: what it will say). To change an existing page, brain_read it first and pass its hash as baseHash; null for a new page. Slugs are lowercase kebab-case; link other pages with [[slug]]. reason says what changed and why, sources where the fact comes from (a URL, a document, "told by the user in chat"). ' + TAGS_HOW,
            inputSchema: brainProposalInputSchema,
            execute: async input => {
                const slug = input.slug
                const current = await readPageFile(slug)
                if (current) {
                    if (!input.baseHash) return `The page "${slug}" already exists. brain_read it, then propose again with its hash as baseHash and the complete new content.`
                    if (input.baseHash !== current.hash) return `The page "${slug}" changed since you read it. brain_read it again and apply your change to the current version.`
                    if (pageHash(input) === current.hash) return 'This is identical to the current page. Nothing sent.'
                }

                const fingerprint = proposalFingerprint({ slug, content: input.content })
                if (await findProposalByFingerprint(fingerprint)) return ALREADY

                const proposal = {
                    agentId: ctx.agent.id,
                    agentName: ctx.agent.config.name,
                    sessionId: ctx.sessionId,
                    slug,
                    mode: current ? ('edit' as const) : ('create' as const),
                    title: input.title.trim(),
                    headline: input.headline.trim(),
                    highlights: input.highlights,
                    type: input.type,
                    content: input.content.trim(),
                    reason: input.reason.trim(),
                    sources: input.sources,
                    baseHash: current ? input.baseHash : null,
                    tags: normalizeBrainTags(input.tags ?? []),
                    spaceId: await ownBox(),
                    fingerprint,
                }
                const open = await openProposalFor(ctx.agent.id, slug)
                if (open) {
                    await replaceOpenProposal(open.id, proposal)
                    return proposalResult('updated', open.id, slug, proposal.title, UPDATED)
                }
                const row = await insertProposal(proposal)
                return proposalResult('proposed', row.id, slug, row.title, PROPOSED)
            },
        }),
    }
}

function changeResult(status: 'saved' | 'deleted' | 'accepted' | 'dismissed', slug: string, title: string, extra: Record<string, unknown> = {}): string {
    return JSON.stringify({ status, slug, title, ...extra })
}

// A stale hash or a page gone meanwhile is a 409 or a 404 the model can recover from by reading
// again, so it comes back as an answer rather than as a failed call.
async function recoverable(fn: () => Promise<string>): Promise<string> {
    try {
        return await fn()
    } catch (err) {
        if (err instanceof HttpError && (err.status === 409 || err.status === 404)) return err.message
        throw err
    }
}

const WRITE_PAGE_HOW =
    'Give the complete page as content, in markdown, keeping everything that is still true: it replaces the whole page. To change an existing page, brain_read it first and pass its hash as baseHash; for a new page, pass null. Slugs are lowercase kebab-case (e.g. "pricing", "acme-corp"); link other pages with [[slug]]. Put in sources where the fact comes from (a URL, a document, "told by the user in chat").'

function writeTool(author: string, description: string, ownBox: OwnBox, refusal: () => string | null = () => null) {
    return tool({
        description,
        inputSchema: brainProposalInputSchema.omit({ reason: true, headline: true, highlights: true }),
        execute: async input =>
            recoverable(async () => {
                const refused = refusal()
                if (refused) return refused
                const current = await readPageFile(input.slug)
                if (current && !input.baseHash) return `The page "${input.slug}" already exists. brain_read it, then write again with its hash as baseHash and the complete new content.`
                const [before] = current ? await listRevisions(input.slug, 1) : []
                const page = await writePage(input.slug, {
                    title: input.title,
                    type: input.type,
                    content: input.content,
                    sources: input.sources,
                    baseHash: current ? input.baseHash : null,
                    author,
                    separateRevision: true,
                    tags: input.tags ?? [],
                    spaceId: current ? null : await ownBox(),
                })
                const unchanged = current && page.hash === current.hash && page.updatedAt === current.updatedAt
                if (unchanged && page.tags.join('\n') === current.tags.join('\n')) return 'This is identical to the current page. Nothing written.'
                return changeResult('saved', page.slug, page.title, {
                    mode: current ? 'edit' : 'create',
                    hash: page.hash,
                    undoRevisionId: before?.id ?? null,
                    message: 'Saved. Tell the user what changed in one short sentence.',
                })
            }),
    })
}

const NO_PERSON_HERE = 'No person is in this conversation, so nobody told you this fact: use brain_propose so a person reviews it.'

// The foreman keeps the brain with the person rather than proposing to them: it writes, removes,
// and settles what the agents proposed, each time because the person asked for it in the chat.
export function foremanBrainTools(): ToolSet {
    return {
        ...readTools(NO_BOX),
        brain_write: writeTool(
            FOREMAN_BRAIN_AUTHOR,
            `Write a page of the company brain directly: it is saved at once and every coworker reads it from its next run. Only for a change the user asked for or confirmed in this conversation; a fact you found on your own goes to ask_user first. ${WRITE_PAGE_HOW} ${TAGS_HOW}`,
            NO_BOX
        ),
        brain_delete: tool({
            description:
                'Delete a page of the company brain. Only once the user approved it through request_approval naming the page, then call it with confirm: true. Its history is kept, but no coworker reads it anymore.',
            inputSchema: z.object({ slug: z.string().min(1), confirm: z.literal(true) }),
            execute: async ({ slug }) =>
                recoverable(async () => {
                    const page = await readPageFile(slug)
                    if (!page) return `No page "${slug}" in the company brain.`
                    await deletePage(slug)
                    return changeResult('deleted', slug, page.title)
                }),
        }),
        brain_proposals: tool({
            description:
                'List the changes the coworkers proposed to the company brain that are still waiting for a decision: who proposed it, on which page, why, and the proposed content. brain_read the page to compare with what is there now.',
            inputSchema: z.object({}),
            execute: async () => {
                const proposals = await listProposals('proposed')
                if (proposals.length === 0) return 'No change is waiting for review.'
                return proposals
                    .map(p =>
                        [
                            `proposalId: ${p.id} | ${p.mode === 'create' ? 'new page' : 'change'} [[${p.slug}]] ${p.title} | by ${p.agentName} | ${p.createdAt}`,
                            `reason: ${p.reason}`,
                            p.sources.length ? `sources: ${p.sources.join('; ')}` : '',
                            p.outdated ? 'outdated: the page changed since the coworker read it, so accepting overwrites what changed meanwhile.' : '',
                            `proposed content:\n${excerpt(p.content, PROPOSAL_EXCERPT_CHARS)}`,
                        ]
                            .filter(Boolean)
                            .join('\n')
                    )
                    .join('\n\n---\n\n')
            },
        }),
        brain_decide: tool({
            description:
                "Accept or dismiss a change a coworker proposed to the company brain, by its proposalId from brain_proposals. Only when the user decided it in this conversation. Accepting writes the proposed page, or the content you pass when the user wanted it retouched first (the complete page, as with brain_write); pass null to keep the coworker's version. A dismissed change is never proposed again.",
            inputSchema: z.object({
                proposalId: z.string().min(1),
                decision: z.enum(['accept', 'dismiss']),
                content: z.string().min(1).max(60_000).nullable(),
            }),
            execute: async ({ proposalId, decision, content }) =>
                recoverable(async () => {
                    const row = await getProposal(proposalId)
                    if (!row) return `No proposal "${proposalId}". brain_proposals lists the ones waiting.`
                    if (row.status !== 'proposed') return `This change was already ${row.status}. Nothing done.`
                    const decided =
                        decision === 'accept' ? await acceptProposal(proposalId, FOREMAN_BRAIN_AUTHOR, content ? { content } : {}) : await dismissProposal(proposalId, FOREMAN_BRAIN_AUTHOR)
                    if (decided.status === 'proposed') return 'Nothing changed.'
                    return changeResult(decided.status, decided.slug, decided.title, { agentName: decided.agentName })
                }),
        }),
    }
}
