import { isInsideRemote, isSensitiveRemotePath, resolveRemotePath, type RemoteComputerView } from '@rerun/contracts'

export type FileDecision = { kind: 'allowed'; path: string; roots: string[] | null; sensitiveOk: boolean } | { kind: 'ask'; path: string; sensitive: boolean }

// Where a file operation may go on a computer. Inside the working folder or a folder the owner
// always allowed, it goes; elsewhere it needs a yes, except on a computer in full access. Where
// secrets live, it always needs a yes. The computer checks the same on the real path, links followed.
export function fileDecision(view: Pick<RemoteComputerView, 'settings' | 'facts'>, rawPath: string, granted: string[]): FileDecision {
    const facts = view.facts!
    const path = resolveRemotePath(rawPath, facts.workDir, facts.os, facts.homeDir)
    const inside = (root: string) => isInsideRemote(path, resolveRemotePath(root, facts.workDir, facts.os, facts.homeDir), facts.os, facts.homeDir)
    const approved = granted.some(inside)
    const sensitive = isSensitiveRemotePath(path, facts.os, facts.homeDir)
    if (sensitive && !approved) return { kind: 'ask', path, sensitive: true }
    if (view.settings.mode === 'full') return { kind: 'allowed', path, roots: null, sensitiveOk: sensitive }
    const roots = [facts.workDir, ...view.settings.allowedFolders, ...granted]
    if (!approved && !roots.some(inside)) return { kind: 'ask', path, sensitive: false }
    return { kind: 'allowed', path, roots, sensitiveOk: sensitive }
}
