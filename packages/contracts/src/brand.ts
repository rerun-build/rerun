// What the product calls itself in front of a reader: Rerun, or the organization that resells it.
// `organizationId` is what tells them apart: null is Rerun's own brand, with its own pages and offers.
export type Brand = {
    organizationId: string | null
    name: string
    // A square image with its own background. Null draws Rerun's mark.
    iconUrl: string | null
    // Null is the neutral palette for an organization, Rerun's indigo for Rerun.
    color: string | null
    supportEmail: string | null
    links: { docs: string | null; terms: string | null; privacy: string | null }
}

export const RERUN_BRAND: Brand = {
    organizationId: null,
    name: 'Rerun',
    iconUrl: null,
    color: null,
    supportEmail: null,
    links: { docs: null, terms: null, privacy: null },
}

// Rerun's own pages, community, offers and programs show on Rerun's brand only.
export function isWhiteLabel(brand: Brand): boolean {
    return brand.organizationId !== null
}

// The domain of the example addresses shown in an empty email field.
export function exampleEmailDomain(brand: Brand): string {
    return isWhiteLabel(brand) ? 'company.com' : 'rerun.build'
}
