// Keeps each IN list under PostgREST's URL limit.
const ID_BATCH_SIZE = 200

export function batchesOf(ids: number[]): number[][] {
    const batches: number[][] = []
    for (let start = 0; start < ids.length; start += ID_BATCH_SIZE) batches.push(ids.slice(start, start + ID_BATCH_SIZE))
    return batches
}
