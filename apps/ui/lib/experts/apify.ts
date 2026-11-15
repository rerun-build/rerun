import { ApifyClient, type ActorRun } from 'apify-client'

let client: ApifyClient | null = null

function getClient(): ApifyClient {
    if (client) return client
    const token = process.env.APIFY_TOKEN
    if (!token) throw new Error('APIFY_TOKEN is not configured')
    client = new ApifyClient({ token })
    return client
}

export async function runApifyActor<T>(actor: string, input: Record<string, unknown>, limit?: number): Promise<T[]> {
    const run = await getClient().actor(actor).call(input)
    const { items } = await getClient().dataset(run.defaultDatasetId).listItems(limit ? { limit } : undefined)
    return items as T[]
}

export async function runApifyActorWithCost<T>(actor: string, input: Record<string, unknown>, { limit, waitSecs = 120 }: { limit?: number; waitSecs?: number } = {}): Promise<{ items: T[]; usd: number }> {
    const run = await getClient().actor(actor).call(input, { log: null, waitSecs })
    if (run.status === 'READY' || run.status === 'RUNNING') {
        await getClient().run(run.id).abort().catch(() => {})
        throw new Error(`Apify run ${run.id} did not finish within ${waitSecs} s and was aborted`)
    }
    if (run.status !== 'SUCCEEDED') throw new Error(`Apify run ${run.id} ended ${run.status}`)
    const { items } = await getClient().dataset(run.defaultDatasetId).listItems(limit ? { limit } : undefined)
    return { items: items as T[], usd: (run.usageTotalUsd ?? 0) + chargedEventsUsd(run) }
}

function chargedEventsUsd(run: ActorRun): number {
    if (run.pricingInfo?.pricingModel !== 'PAY_PER_EVENT') return 0
    const prices = run.pricingInfo.pricingPerEvent.actorChargeEvents
    return Object.entries(run.chargedEventCounts ?? {}).reduce((total, [event, count]) => total + count * (prices[event]?.eventPriceUsd ?? 0), 0)
}
