import { requireWorkspaceContext, type WorkspaceContext } from '@/app/api/_auth/ownership'
import { createDiscoveryTranslator, serviceIconLookup } from '@/lib/company/explore/discoveries.server'
import { exploreCompany } from '@/lib/company/explore/explore'
import type { CompanyFindingsRow, DiscoveryEvent } from '@/lib/company/explore/findings'
import { companySiteUrl } from '@/lib/company/firecrawl'
import { analyzeCompanyProfile } from '@/lib/company/profile'
import { takeIntakeCall } from '@/lib/onboarding/anonymous-intake-quota'
import { selectMaybeSingle } from '@/supabase/supabase-helpers'

// What the onboarding board shows of the company while the welcome card is being filled. A route
// rather than a server action: Next runs one action at a time per client, and the cards have to
// land as each source answers.

// The sources that cost nothing: the DNS and the raw home page. Everything paid waits for an account
// and runs in the explore-company task.
const LIVE_COLLECTORS = new Set(['dns', 'stack'] as const)

async function workspaceContext(): Promise<WorkspaceContext | null> {
    try {
        return await requireWorkspaceContext()
    } catch {
        return null
    }
}

export async function POST(request: Request) {
    const ctx = await workspaceContext()
    if (!ctx) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    const body = (await request.json().catch(() => null)) as { url?: unknown } | null
    const url = typeof body?.url === 'string' ? companySiteUrl(body.url) : null
    if (!url) return Response.json({ error: 'That does not look like a website address' }, { status: 400 })
    if (!takeIntakeCall(ctx.workspace.id, 'explore')) return Response.json({ error: 'The site was read enough times for now.' }, { status: 429 })

    const domain = new URL(url).hostname
    const translator = createDiscoveryTranslator({ domain, icons: serviceIconLookup(ctx.supabase) })
    const encoder = new TextEncoder()

    const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
            const send = (events: DiscoveryEvent[]) => {
                if (request.signal.aborted) return
                for (const event of events) controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`))
            }
            // The translation is async (icons), so events are chained to leave in the order they came.
            let sending = Promise.resolve()
            const queue = (translate: () => Promise<DiscoveryEvent[]>) => {
                sending = sending.then(translate).then(send, error => console.error('Onboarding discovery failed to translate', error))
            }

            send([{ type: 'pending', source: 'profile' }])
            await Promise.all([
                // Also fills the cache the welcome page and saveForemanIntakeAction read the profile from.
                analyzeCompanyProfile(url).then(
                    result => queue(() => translator.fromProfile(result.ok ? result.analysis.profile : null)),
                    () => queue(() => translator.fromProfile(null))
                ),
                exploreCompany({ url, domain, personName: null, email: null, linkedinUrl: null }, LIVE_COLLECTORS, event => queue(() => translator.fromExplore(event))),
            ])
            await sending
            send([{ type: 'end' }])
            if (!request.signal.aborted) controller.close()
        },
    })

    return new Response(stream, { headers: { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store' } })
}

// What the full exploration has written so far, read by the board every few seconds while it runs.
export async function GET() {
    const ctx = await workspaceContext()
    if (!ctx) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    const { data } = await selectMaybeSingle(ctx.supabase, 'workspace_onboarding', ['company_findings'] as const, { workspace_id: ctx.workspace.id })
    return Response.json((data?.company_findings ?? null) as CompanyFindingsRow | null, { headers: { 'cache-control': 'no-store' } })
}
