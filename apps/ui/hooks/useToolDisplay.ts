'use client'

import { useTranslations } from 'next-intl'
import { useCallback } from 'react'
import { useConnectorServices } from '@/hooks/useConnectorServices'
import { resolveConnectorTool } from '@/lib/chat/connector-tools'
import { serviceIconProps } from '@/lib/services/icons'
import { getToolMeta, isKnownTool } from '@/lib/tool-meta'
import type { LucideIcon } from '@/lib/icons'

export type ToolIconProps = { icon: LucideIcon; src?: never } | { src: string; icon?: never }

export type ToolDisplay = { label: string; iconProps: ToolIconProps }

// A tool call that belongs to an installed connector wears the service brand instead of the generic
// puzzle, and drops the server name from its label since the logo already carries it. A custom
// server's tool keeps its name, its favicon alone not always being enough to tell it apart. Anything
// else keeps the static tool map, which names a few tools after their input.
export function useToolDisplay(agentId?: string): (toolName: string, input?: unknown) => ToolDisplay {
    const { map } = useConnectorServices(agentId)
    const t = useTranslations('tools')

    return useCallback(
        (toolName: string, input?: unknown) => {
            const connector = resolveConnectorTool(toolName, map, isKnownTool)
            if (connector) return { label: connector.label, iconProps: serviceIconProps(connector.service.icon, connector.service.category) }
            const meta = getToolMeta(toolName, input, t)
            return { label: meta.label, iconProps: { icon: meta.icon } }
        },
        [map, t],
    )
}
