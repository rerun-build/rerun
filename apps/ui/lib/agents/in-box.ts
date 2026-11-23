// Every coworker sits in a Box, the Chief of Staff in none (`agents_box_by_kind`). Narrows a row the
// way a `kind: 'coworker'` filter already did, which TypeScript cannot read from the query.
export function sitsInABox<T extends { space_id: string | null }>(row: T): row is T & { space_id: string } {
    return row.space_id !== null
}
