import type { ConsoleSection } from '@/ee/components/organization/types'

export const CONSOLE_HOME = '/organization'

// The sections that have a page. The console shows these and no other.
export const CONSOLE_SECTIONS: Partial<Record<ConsoleSection, string>> = { workspaces: CONSOLE_HOME, credit: `${CONSOLE_HOME}/credit`, team: `${CONSOLE_HOME}/team`, brand: `${CONSOLE_HOME}/brand`, domains: `${CONSOLE_HOME}/domains` }

export const consoleWorkspacePath = (workspaceId: number) => `${CONSOLE_HOME}/workspaces/${workspaceId}`

// A page that belongs to none of the others is one of a workspace.
export function consoleSectionOf(pathname: string): ConsoleSection {
    const section = pathname.slice(CONSOLE_HOME.length).split('/')[1]
    return section && section in CONSOLE_SECTIONS ? (section as ConsoleSection) : 'workspaces'
}
