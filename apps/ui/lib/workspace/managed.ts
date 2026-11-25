// A workspace an organization runs and pays for. Its people never meet a price nor Rerun itself:
// whatever there is to buy or to ask is between them and the organization.
export function isManagedWorkspace(workspace: { organization_id?: string | null } | null | undefined): boolean {
    return !!workspace?.organization_id
}
