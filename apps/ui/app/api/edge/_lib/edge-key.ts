import { createHash, timingSafeEqual } from 'node:crypto'

const digest = (value: string): Buffer => createHash('sha256').update(value).digest()

// The edge of the organizations, Caddy and the job that tells Traefik their domains, holds this key.
export function isEdge(given: string | null): boolean {
    const key = process.env.ORGANIZATION_EDGE_KEY
    return !!key && !!given && timingSafeEqual(digest(given), digest(key))
}
