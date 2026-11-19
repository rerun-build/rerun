type Issue = { code: string; path: PropertyKey[]; errors?: Issue[][] }
type Parsed = { success: true; data: unknown } | { success: false; error: { issues: Issue[] } }
export type ResponseSchema = { safeParse: (value: unknown) => Parsed }

export type Salvaged = { data: unknown; dropped: string[] }

type Step = 'null' | 'unset' | 'drop'

// A value of a kind this build does not know: a new member of an enum, a new variant of a union. A value
// of the wrong type is a bug of the hub, and only ever costs the item it sits in.
const UNKNOWN_VALUE_CODES = new Set(['invalid_value', 'invalid_union'])

const MIN_ROUNDS = 500

function containerAt(root: unknown, path: PropertyKey[]): unknown {
    return path.reduce<unknown>((node, key) => (node !== null && typeof node === 'object' ? (node as Record<PropertyKey, unknown>)[key] : undefined), root)
}

// The nearest list the bad value sits in, and its index there: the item that goes.
function itemOf(root: unknown, path: PropertyKey[]): { list: unknown[]; index: number; at: PropertyKey[] } | null {
    for (let depth = path.length - 1; depth >= 0; depth--) {
        const list = containerAt(root, path.slice(0, depth))
        const index = path[depth]
        if (Array.isArray(list) && typeof index === 'number') return { list, index, at: path.slice(0, depth + 1) }
    }
    return null
}

function apply(root: unknown, path: PropertyKey[], step: Step): string | null {
    if (step === 'drop') {
        const item = itemOf(root, path)
        if (!item) return null
        item.list.splice(item.index, 1)
        return item.at.join('.')
    }
    const parent = containerAt(root, path.slice(0, -1))
    const key = path.at(-1)
    if (key === undefined || parent === null || typeof parent !== 'object' || Array.isArray(parent)) return null
    if (step === 'null') (parent as Record<PropertyKey, unknown>)[key] = null
    else delete (parent as Record<PropertyKey, unknown>)[key]
    return path.join('.')
}

// An answer that is a union says only that none of its branches read it: the branch that came closest
// names what to leave out.
function nearest(issue: Issue): Issue {
    if (issue.code !== 'invalid_union' || issue.path.length > 0 || !issue.errors?.length) return issue
    const closest = issue.errors.reduce((best, branch) => (branch.length < best.length ? branch : best))
    return closest.length ? nearest(closest[0]) : issue
}

// The same trouble in another item of a list: the indexes do not tell them apart.
function shapeOf(issue: Issue): string {
    return `${issue.code}:${issue.path.map(key => (typeof key === 'number' ? '*' : String(key))).join('.')}`
}

function itemCount(node: unknown): number {
    if (node === null || typeof node !== 'object') return 0
    return Object.values(node).reduce<number>((count, child) => count + itemCount(child), Array.isArray(node) ? node.length : 0)
}

// A build reads the hub with the schemas it was compiled with. Rather than fail a whole screen on one
// value it does not know (a new status, a new kind of part), it leaves that value out: an optional or
// nullable field goes empty, an item of a list goes, and the rest is read. Only an answer: what the app
// sends is never bent this way. Throws the first error when nothing can be left out.
export function readSalvaging(schema: ResponseSchema, payload: unknown): Salvaged {
    const first = schema.safeParse(payload)
    if (first.success) return { data: first.data, dropped: [] }

    const value: unknown = JSON.parse(JSON.stringify(payload ?? null))
    const emptied = new Set<string>()
    const removed: string[] = []
    // What only its item leaving could fix once goes straight to that in the items after it.
    const settledByDrop = new Set<string>()
    // A dropped item shifts the ones after it, so what was tried is forgotten with it; the answer only
    // ever shrinks, which ends the loop.
    let tried = new Map<string, Step[]>()
    for (let rounds = Math.max(MIN_ROUNDS, 3 * itemCount(value)); rounds > 0; rounds--) {
        const result = schema.safeParse(value)
        if (result.success) return { data: result.data, dropped: [...removed, ...emptied] }
        const issue = nearest(result.error.issues[0])
        const key = issue.path.map(String).join('.')
        const shape = shapeOf(issue)
        const steps: Step[] = UNKNOWN_VALUE_CODES.has(issue.code) && issue.path.length > 0 && !settledByDrop.has(shape) ? ['null', 'unset', 'drop'] : ['drop']
        const done = tried.get(key) ?? []
        const step = steps.find(candidate => !done.includes(candidate))
        if (!step) throw first.error
        tried.set(key, [...done, step])
        const where = apply(value, issue.path, step)
        if (!where) continue
        if (step === 'drop') {
            emptied.delete(key)
            removed.push(where)
            settledByDrop.add(shape)
            tried = new Map()
        } else emptied.add(where)
    }
    throw first.error
}
