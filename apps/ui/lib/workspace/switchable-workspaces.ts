const FALLBACK_ICONS = ['/pricing/solo.png', '/pricing/team.png', '/pricing/scale.png']

// The fallback follows the workspace's place in the id-sorted list, so the menu and the rail draw a
// workspace without an icon with the same picture.
export function fallbackWorkspaceIcon(index: number): string {
    return FALLBACK_ICONS[index % FALLBACK_ICONS.length]
}

// The sandbox is entered through the Expert menu, never switched to like a workspace.
export function listSwitchableWorkspaces<W extends { id: number; is_sandbox: boolean }>(workspaces: readonly W[]): W[] {
    return workspaces.filter(w => !w.is_sandbox).sort((a, b) => a.id - b.id)
}
