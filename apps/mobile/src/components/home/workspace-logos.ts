import type { WorkspaceSummary } from '@rerun/contracts'
import { Directory, File, Paths } from 'expo-file-system'
import type { SFSymbol } from 'expo-symbols'
import { useEffect, useState } from 'react'

import type { HomeTranslator } from '@/components/home/board'
import { translatorFor } from '@/i18n/translator'

export const workspaceLabel = (workspace: Pick<WorkspaceSummary, 'name'> | undefined, t: HomeTranslator = translatorFor('mobileHome')) => workspace?.name?.trim() || t('workspace.untitled')

export function workspaceInitials(workspace: Pick<WorkspaceSummary, 'name'> | undefined): string {
    const words = workspaceLabel(workspace).split(/\s+/).filter(Boolean)
    return words
        .slice(0, 2)
        .map(word => Array.from(word)[0].toUpperCase())
        .join('')
}

// A sandbox points at a page of the web app, and rows written by older code may hold anything: only
// a full web address is an image the app can fetch.
export function logoUrlOf(iconUrl: string | null | undefined): string | null {
    const value = iconUrl?.trim()
    return value && /^https?:\/\//i.test(value) ? value : null
}

// The system menu draws neither text nor a remote image as an icon, so a row without a logo gets the
// lettered symbol of its first initial.
export function initialSymbolOf(workspace: Pick<WorkspaceSummary, 'name'>): SFSymbol {
    const letter = workspaceInitials(workspace)[0]?.toLowerCase()
    return letter && /^[a-z]$/.test(letter) ? (`${letter}.circle.fill` as SFSymbol) : 'building.2'
}

function hashOf(value: string): string {
    let hash = 5381
    for (let index = 0; index < value.length; index++) hash = ((hash << 5) + hash + value.charCodeAt(index)) | 0
    return (hash >>> 0).toString(36)
}

// A menu row only takes an image from a local file, so each logo is downloaded once to the cache. The
// file is named after its address, so a changed logo is fetched again.
export function useWorkspaceLogoFiles(workspaces: Pick<WorkspaceSummary, 'id' | 'iconUrl'>[]): Map<number, string> {
    const [files, setFiles] = useState<Map<number, string>>(new Map())

    useEffect(() => {
        let cancelled = false
        const folder = new Directory(Paths.cache, 'workspace-logos')
        Promise.all(
            workspaces.map(async ({ id, iconUrl }): Promise<[number, string] | null> => {
                const url = logoUrlOf(iconUrl)
                if (!url) return null
                try {
                    if (!folder.exists) folder.create({ intermediates: true, idempotent: true })
                    const file = new File(folder, `${id}-${hashOf(url)}`)
                    if (file.exists) return [id, file.uri]
                    const downloaded = await File.downloadFileAsync(url, file, { idempotent: true })
                    return [id, downloaded.uri]
                } catch (error) {
                    console.warn('[workspaces] logo download failed', id, error)
                    return null
                }
            }),
        ).then(entries => {
            if (!cancelled) setFiles(new Map(entries.filter(entry => entry !== null)))
        })
        return () => {
            cancelled = true
        }
    }, [workspaces])

    return files
}
