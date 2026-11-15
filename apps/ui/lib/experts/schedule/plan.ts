import { hashSeed, mulberry32, shuffled } from './rng'
import {
    DAY_MS,
    DEFAULT_WINDOW,
    MINUTE_MS,
    capDayKey,
    isValidTimeZone,
    localWindowCloseAt,
    nextEligibleAt,
    startOfNextCapDay,
    type LocalWindow,
} from './window'

export type PlannableExpert = { id: string; timezone: string }

export type PlanParams = {
    startAt: Date
    dailyCap: number
    minGapMinutes: number
    jitterMinutes: number
    seed: string
    window?: LocalWindow
    capTimeZone?: string
    maxHorizonDays?: number
}

export type UnschedulableReason = 'invalid-timezone' | 'empty-window' | 'horizon-exceeded'

export type PlanResult = {
    scheduled: { id: string; sendAt: Date }[]
    unschedulable: { id: string; reason: UnschedulableReason }[]
}

const DEFAULT_CAP_TIMEZONE = 'UTC'
const DEFAULT_MAX_HORIZON_DAYS = 90
const FAIRNESS_EPSILON = 1e-9

type Bucket = {
    timezone: string
    queue: PlannableExpert[]
    size: number
    sent: number
    readyAt: Date | null
    dayQuota: number
    dayUsed: number
}

export function planInviteCampaign(experts: readonly PlannableExpert[], params: PlanParams): PlanResult {
    const window = params.window ?? DEFAULT_WINDOW
    const capTimeZone = params.capTimeZone ?? DEFAULT_CAP_TIMEZONE
    const horizon = new Date(params.startAt.getTime() + (params.maxHorizonDays ?? DEFAULT_MAX_HORIZON_DAYS) * DAY_MS)
    const minGapMs = Math.max(0, params.minGapMinutes) * MINUTE_MS
    const shuffle = mulberry32(hashSeed(`${params.seed}:shuffle`))

    const scheduled: PlanResult['scheduled'] = []
    const unschedulable: PlanResult['unschedulable'] = []
    const buckets: Bucket[] = []

    for (const [timezone, members] of groupByTimezone(experts)) {
        if (!isValidTimeZone(timezone)) {
            for (const expert of members) unschedulable.push({ id: expert.id, reason: 'invalid-timezone' })
            continue
        }
        const readyAt = nextEligibleAt(params.startAt, timezone, window)
        if (!readyAt) {
            for (const expert of members) unschedulable.push({ id: expert.id, reason: 'empty-window' })
            continue
        }
        buckets.push({ timezone, queue: shuffled(members, shuffle), size: members.length, sent: 0, readyAt, dayQuota: 0, dayUsed: 0 })
    }

    buckets.sort((a, b) => (a.timezone < b.timezone ? -1 : 1))

    const capCounts = new Map<string, number>()
    let cursor = params.startAt
    let currentDay = ''

    while (buckets.some(bucket => bucket.queue.length > 0)) {
        if (cursor.getTime() > horizon.getTime()) {
            for (const bucket of buckets) {
                for (const expert of bucket.queue) unschedulable.push({ id: expert.id, reason: 'horizon-exceeded' })
                bucket.queue = []
            }
            break
        }

        const day = capDayKey(cursor, capTimeZone)
        const dayEnd = startOfNextCapDay(cursor, capTimeZone)
        if (day !== currentDay) {
            currentDay = day
            reserveDailyQuotas(buckets, params.dailyCap)
        }
        if ((capCounts.get(day) ?? 0) >= params.dailyCap) {
            cursor = dayEnd
            continue
        }

        const pending: Bucket[] = []
        for (const bucket of buckets) {
            if (bucket.queue.length === 0) continue
            const from = !bucket.readyAt || bucket.readyAt.getTime() < cursor.getTime() ? cursor : bucket.readyAt
            bucket.readyAt = nextEligibleAt(from, bucket.timezone, window)
            if (!bucket.readyAt) {
                for (const expert of bucket.queue) unschedulable.push({ id: expert.id, reason: 'empty-window' })
                bucket.queue = []
                continue
            }
            pending.push(bucket)
        }
        if (pending.length === 0) break

        const bucket = pickBucket(pending, cursor, dayEnd)
        if (!bucket) {
            cursor = new Date(Math.min(...pending.filter(candidate => candidate.readyAt!.getTime() > cursor.getTime()).map(candidate => candidate.readyAt!.getTime())))
            continue
        }

        const expert = bucket.queue.shift()!
        const sendAt = applyJitter(cursor, expert, bucket.timezone, window, capTimeZone, params)

        scheduled.push({ id: expert.id, sendAt })
        capCounts.set(day, (capCounts.get(day) ?? 0) + 1)
        bucket.sent++
        bucket.dayUsed++
        cursor = new Date(sendAt.getTime() + minGapMs)
    }

    return { scheduled, unschedulable }
}

function reserveDailyQuotas(buckets: Bucket[], dailyCap: number): void {
    const remaining = buckets.reduce((total, bucket) => total + bucket.queue.length, 0)
    for (const bucket of buckets) {
        bucket.dayUsed = 0
        bucket.dayQuota = remaining === 0 ? 0 : (dailyCap * bucket.queue.length) / remaining
    }
}

function pickBucket(pending: Bucket[], cursor: Date, dayEnd: Date): Bucket | null {
    const openNow = pending.filter(bucket => bucket.readyAt!.getTime() <= cursor.getTime())
    const reserved = openNow.filter(bucket => bucket.dayUsed < bucket.dayQuota)
    if (reserved.length > 0) return leastServed(reserved)

    const reservedLater = pending.some(
        bucket => bucket.dayUsed < bucket.dayQuota && bucket.readyAt!.getTime() > cursor.getTime() && bucket.readyAt!.getTime() < dayEnd.getTime(),
    )
    if (reservedLater) return null

    return openNow.length > 0 ? leastServed(openNow) : null
}

function leastServed(buckets: Bucket[]): Bucket {
    return buckets.reduce((best, candidate) => (virtualTime(candidate) < virtualTime(best) - FAIRNESS_EPSILON ? candidate : best))
}

function virtualTime(bucket: Bucket): number {
    return bucket.sent / bucket.size
}

function applyJitter(
    cursor: Date,
    expert: PlannableExpert,
    timezone: string,
    window: LocalWindow,
    capTimeZone: string,
    params: PlanParams,
): Date {
    if (params.jitterMinutes <= 0) return cursor

    const random = mulberry32(hashSeed(`${params.seed}:jitter:${expert.id}`))()
    let sendAt = cursor.getTime() + Math.floor(random * (params.jitterMinutes * MINUTE_MS + 1))

    const windowClose = localWindowCloseAt(cursor, timezone, window)
    if (windowClose) sendAt = Math.min(sendAt, windowClose.getTime() - MINUTE_MS)
    sendAt = Math.min(sendAt, startOfNextCapDay(cursor, capTimeZone).getTime() - MINUTE_MS)

    return new Date(Math.max(sendAt, cursor.getTime()))
}

function groupByTimezone(experts: readonly PlannableExpert[]): Map<string, PlannableExpert[]> {
    const groups = new Map<string, PlannableExpert[]>()
    for (const expert of experts) {
        const members = groups.get(expert.timezone)
        if (members) members.push(expert)
        else groups.set(expert.timezone, [expert])
    }
    return groups
}
