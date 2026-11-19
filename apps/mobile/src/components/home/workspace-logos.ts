import type { WorkspaceSummary } from '@moldwright/contracts'
import { Directory, File, Paths } from 'expo-file-system'
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

export function logoUrlOf(iconUrl: string | null | undefined): string | null {
    const value = iconUrl?.trim()
    return value && /^https?:\/\//i.test(value) ? value : null
}

function hashOf(value: string): string {
    let hash = 5381
    for (let index = 0; index < value.length; index++) hash = ((hash << 5) + hash + value.charCodeAt(index)) | 0
    return (hash >>> 0).toString(36)
}

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
