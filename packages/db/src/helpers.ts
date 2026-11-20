import { Database } from './database.types'
import { SupabaseClient } from '@supabase/supabase-js'

export type TableName = keyof Database['public']['Tables']
export type TableRow<T extends TableName> = Database['public']['Tables'][T]['Row']

export type FilterValue<T> =
    | T
    | T[]
    | { in: T[] }
    | { eq: T }
    | { neq: T }
    | { gt: T }
    | { gte: T }
    | { lt: T }
    | { lte: T }
    | { like: string }
    | { ilike: string }
    | { notNull: true }
    | { isNull: true }

export type OrFilters<T extends TableName> = {
    [K in keyof TableRow<T>]?: FilterValue<TableRow<T>[K]>
}

export type Filters<T extends TableName> = {
    [K in keyof TableRow<T>]?: FilterValue<TableRow<T>[K]>
} & {
    or?: OrFilters<T>
}

export type JoinConfig<TJ extends TableName, Cols extends readonly (keyof TableRow<TJ>)[]> = {
    table: TJ
    foreignKey: string
    columns: Cols
}

export type WithJoins<T extends TableName, J extends Record<string, JoinConfig<any, any>> = Record<string, never>> = Pick<TableRow<T>, keyof TableRow<T>> & {
    [K in keyof J]: J[K] extends JoinConfig<infer TJ, infer Cols> ? Pick<TableRow<TJ>, Cols[number]> : never
}

export type JoinFilters<J extends Record<string, JoinConfig<any, any>>> = {
    [K in keyof J]?: J[K] extends JoinConfig<infer TJ, any> ? Filters<TJ> : never
}
export type OrderBySpec<T extends TableName> =
    | { column: keyof TableRow<T>; ascending?: boolean }
    | readonly { column: keyof TableRow<T>; ascending?: boolean }[]

function applyOrderBy<T extends TableName, Q extends { order(column: string, options?: { ascending?: boolean }): Q }>(query: Q, orderBy?: OrderBySpec<T>): Q {
    if (!orderBy) return query
    const specs = Array.isArray(orderBy) ? orderBy : [orderBy]
    let current = query
    for (const spec of specs) {
        current = current.order(spec.column as string, { ascending: spec.ascending ?? true })
    }
    return current
}


function quoteOrValue(v: unknown): string {
    const s = String(v)
    if (!/[,.()"\s]/.test(s)) return s
    return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

function orCondition(column: string, value: unknown): string {
    if (Array.isArray(value)) return `${column}.in.(${value.map(quoteOrValue).join(',')})`
    if (value !== null && typeof value === 'object') {
        if ('in' in value) return `${column}.in.(${(value.in as unknown[]).map(quoteOrValue).join(',')})`
        if ('eq' in value) return `${column}.eq.${quoteOrValue(value.eq)}`
        if ('neq' in value) return `${column}.neq.${quoteOrValue(value.neq)}`
        if ('gt' in value) return `${column}.gt.${quoteOrValue(value.gt)}`
        if ('gte' in value) return `${column}.gte.${quoteOrValue(value.gte)}`
        if ('lt' in value) return `${column}.lt.${quoteOrValue(value.lt)}`
        if ('lte' in value) return `${column}.lte.${quoteOrValue(value.lte)}`
        if ('like' in value) return `${column}.like.${quoteOrValue(value.like)}`
        if ('ilike' in value) return `${column}.ilike.${quoteOrValue(value.ilike)}`
        if ('notNull' in value) return `${column}.not.is.null`
        if ('isNull' in value) return `${column}.is.null`
    }
    return `${column}.eq.${quoteOrValue(value)}`
}

function applyFilters<T extends TableName>(query: any, filters: Filters<T>) {
    for (const [key, value] of Object.entries(filters)) {
        if (value === undefined) continue

        if (key === 'or' && value !== null && typeof value === 'object' && !Array.isArray(value)) {
            const conditions = Object.entries(value as Record<string, unknown>)
                .filter(([, v]) => v !== undefined)
                .map(([col, v]) => orCondition(col, v))
            if (conditions.length > 0) query = query.or(conditions.join(','))
            continue
        }

        if (Array.isArray(value)) {
            query = query.in(key, value)
        } else if (typeof value === 'object' && value !== null) {
            if ('gt' in value) query = query.gt(key, value.gt)
            if ('gte' in value) query = query.gte(key, value.gte)
            if ('lt' in value) query = query.lt(key, value.lt)
            if ('lte' in value) query = query.lte(key, value.lte)

            if ('in' in value) {
                query = query.in(key, value.in)
            } else if ('eq' in value) {
                query = query.eq(key, value.eq)
            } else if ('neq' in value) {
                query = query.neq(key, value.neq)
            } else if ('like' in value) {
                query = query.like(key, value.like)
            } else if ('ilike' in value) {
                query = query.ilike(key, value.ilike)
            } else if ('notNull' in value) {
                query = query.not(key, 'is', null)
            } else if ('isNull' in value) {
                query = query.is(key, null)
            }
        } else {
            query = query.eq(key, value)
        }
    }
    return query
}

function applyJoinFilters<J extends Record<string, JoinConfig<any, any>>>(joinSelections: string[], joins: J, joinFilters?: JoinFilters<J>): string[] {
    if (!joinFilters) return joinSelections

    return joinSelections.map(selection => {
        const [alias, rest] = selection.split(':')
        const filters = joinFilters[alias as keyof J]

        if (!filters || Object.keys(filters).length === 0) return selection

        const filterParts: string[] = []
        for (const [key, value] of Object.entries(filters)) {
            if (value === undefined) continue

            if (Array.isArray(value)) {
                filterParts.push(`${key}.in.(${value.join(',')})`)
            } else if (typeof value === 'object' && value !== null) {
                if ('in' in value) {
                    filterParts.push(`${key}.in.(${(value.in as any[]).join(',')})`)
                } else if ('eq' in value) {
                    filterParts.push(`${key}.eq.${value.eq}`)
                } else if ('neq' in value) {
                    filterParts.push(`${key}.neq.${value.neq}`)
                } else if ('gt' in value) {
                    filterParts.push(`${key}.gt.${value.gt}`)
                } else if ('gte' in value) {
                    filterParts.push(`${key}.gte.${value.gte}`)
                } else if ('lt' in value) {
                    filterParts.push(`${key}.lt.${value.lt}`)
                } else if ('lte' in value) {
                    filterParts.push(`${key}.lte.${value.lte}`)
                } else if ('like' in value) {
                    filterParts.push(`${key}.like.${value.like}`)
                } else if ('ilike' in value) {
                    filterParts.push(`${key}.ilike.${value.ilike}`)
                }
            } else {
                filterParts.push(`${key}.eq.${value}`)
            }
        }

        if (filterParts.length > 0) {
            const [tablePart, columnsPart] = rest.split('(')
            const columns = columnsPart.replace(')', '')
            return `${alias}:${tablePart}!inner(${columns}).${filterParts.join('.')}`
        }

        return selection
    })
}

export async function selectSingle<T extends TableName, K extends keyof TableRow<T>, S extends readonly K[]>(supabase: SupabaseClient<Database>, table: T, selection: S, filters: Filters<T>, orderBy?: { column: keyof TableRow<T>; ascending?: boolean }) {
    let query = supabase.from(table).select(selection.join(','))
    query = applyFilters(query, filters)

    if (orderBy) {
        query = query.order(orderBy.column as string, { ascending: orderBy.ascending ?? true })
    }

    const { data, error } = await query.single()
    return { data: data as Pick<TableRow<T>, S[number]> | null, error }
}

export async function selectMaybeSingle<T extends TableName, K extends keyof TableRow<T>, S extends readonly K[]>(supabase: SupabaseClient<Database>, table: T, selection: S, filters: Filters<T>, orderBy?: { column: keyof TableRow<T>; ascending?: boolean }) {
    let query = supabase.from(table).select(selection.join(','))
    query = applyFilters(query, filters)

    if (orderBy) {
        query = query.order(orderBy.column as string, { ascending: orderBy.ascending ?? true })
    }

    const { data, error } = await query.maybeSingle()
    return { data: data as Pick<TableRow<T>, S[number]> | null, error }
}

export async function selectMany<T extends TableName, K extends keyof TableRow<T>, S extends readonly K[]>(supabase: SupabaseClient<Database>, table: T, selection: S, filters: Filters<T>, orderBy?: OrderBySpec<T>, limit?: number, offset?: number) {
    let query = supabase.from(table).select(selection.join(','))
    query = applyFilters(query, filters)
    query = applyOrderBy(query, orderBy)
    if (offset !== undefined) {
        const endRange = offset + (limit || 50) - 1
        query = query.range(offset, endRange)
    } else if (limit) {
        query = query.limit(limit)
    }

    const { data, error } = await query
    return { data: data as Pick<TableRow<T>, S[number]>[] | null, error }
}

export async function selectAll<T extends TableName, K extends keyof TableRow<T>, S extends readonly K[]>(supabase: SupabaseClient<Database>, table: T, selection: S, filters: Filters<T>, orderBy?: OrderBySpec<T>) {
    const allData: Pick<TableRow<T>, S[number]>[] = []
    let offset = 0
    const limit = 1000

    while (true) {
        const { data, error } = await selectMany(supabase, table, selection, filters, orderBy, limit, offset)

        if (error) return { data: null, error }
        if (!data || data.length === 0) break

        allData.push(...data)

        if (data.length < limit) break

        offset += limit
    }

    return { data: allData, error: null }
}

export async function selectCount<T extends TableName>(supabase: SupabaseClient<Database>, table: T, filters: Filters<T>, column: string = '*') {
    let query = supabase.from(table).select(column, { count: 'exact', head: true })
    query = applyFilters(query, filters)

    const { error, count } = await query
    return { data: count as number | null, error }
}

export async function selectSingleWithJoins<T extends TableName, K extends keyof TableRow<T>, S extends readonly K[], J extends Record<string, JoinConfig<any, any>>>(supabase: SupabaseClient<Database>, table: T, selection: S, joins: J, filters: Filters<T>, joinFilters?: JoinFilters<J>, orderBy?: { column: keyof TableRow<T>; ascending?: boolean }) {
    let joinSelections = Object.entries(joins).map(([alias, config]) => `${alias}:${config.foreignKey}(${Array.isArray(config.columns) ? config.columns.join(',') : config.columns})`)

    joinSelections = applyJoinFilters(joinSelections, joins, joinFilters)

    const fullSelection = [...selection, ...joinSelections].join(',')

    let query = supabase.from(table).select(fullSelection)
    query = applyFilters(query, filters)

    if (orderBy) {
        query = query.order(orderBy.column as string, { ascending: orderBy.ascending ?? true })
    }

    const { data, error } = await query.single()
    return { data: data as (Pick<TableRow<T>, S[number]> & WithJoins<T, J>) | null, error }
}

export async function selectMaybeSingleWithJoins<T extends TableName, K extends keyof TableRow<T>, S extends readonly K[], J extends Record<string, JoinConfig<any, any>>>(supabase: SupabaseClient<Database>, table: T, selection: S, joins: J, filters: Filters<T>, joinFilters?: JoinFilters<J>, orderBy?: { column: keyof TableRow<T>; ascending?: boolean }) {
    let joinSelections = Object.entries(joins).map(([alias, config]) => `${alias}:${config.foreignKey}(${Array.isArray(config.columns) ? config.columns.join(',') : config.columns})`)

    joinSelections = applyJoinFilters(joinSelections, joins, joinFilters)

    const fullSelection = [...selection, ...joinSelections].join(',')

    let query = supabase.from(table).select(fullSelection)
    query = applyFilters(query, filters)

    if (orderBy) {
        query = query.order(orderBy.column as string, { ascending: orderBy.ascending ?? true })
    }

    const { data, error } = await query.maybeSingle()
    return { data: data as (Pick<TableRow<T>, S[number]> & WithJoins<T, J>) | null, error }
}

export async function selectManyWithJoins<T extends TableName, K extends keyof TableRow<T>, S extends readonly K[], J extends Record<string, JoinConfig<any, any>>>(supabase: SupabaseClient<Database>, table: T, selection: S, joins: J, filters: Filters<T>, joinFilters?: JoinFilters<J>, orderBy?: OrderBySpec<T>, limit?: number, offset?: number) {
    let joinSelections = Object.entries(joins).map(([alias, config]) => `${alias}:${config.foreignKey}(${Array.isArray(config.columns) ? config.columns.join(',') : config.columns})`)

    joinSelections = applyJoinFilters(joinSelections, joins, joinFilters)

    const fullSelection = [...selection, ...joinSelections].join(',')

    let query = supabase.from(table).select(fullSelection)
    query = applyFilters(query, filters)

    if (joinFilters) {
        for (const [joinAlias, joinFilter] of Object.entries(joinFilters)) {
            for (const [column, value] of Object.entries(joinFilter)) {
                const filterKey = `${joinAlias}.${column}` as any
                if (Array.isArray(value)) {
                    query = query.in(filterKey, value)
                } else if (typeof value === 'object' && value !== null) {
                    if ('in' in value) {
                        query = query.in(filterKey, value.in as any[])
                    } else if ('eq' in value) {
                        query = query.eq(filterKey, value.eq as any)
                    } else if ('neq' in value) {
                        query = query.neq(filterKey, value.neq as any)
                    } else if ('gt' in value) {
                        query = query.gt(filterKey, value.gt as any)
                    } else if ('gte' in value) {
                        query = query.gte(filterKey, value.gte as any)
                    } else if ('lt' in value) {
                        query = query.lt(filterKey, value.lt as any)
                    } else if ('lte' in value) {
                        query = query.lte(filterKey, value.lte as any)
                    } else if ('like' in value) {
                        query = query.like(filterKey, value.like as string)
                    } else if ('ilike' in value) {
                        query = query.ilike(filterKey, value.ilike as string)
                    }
                } else {
                    query = query.eq(filterKey, value as any)
                }
            }
        }
    }

    query = applyOrderBy(query, orderBy)

    if (offset !== undefined) {
        const endRange = offset + (limit || 50) - 1
        query = query.range(offset, endRange)
    } else if (limit) {
        query = query.limit(limit)
    }

    const { data, error } = await query
    return { data: data as (Pick<TableRow<T>, S[number]> & WithJoins<T, J>)[] | null, error }
}
