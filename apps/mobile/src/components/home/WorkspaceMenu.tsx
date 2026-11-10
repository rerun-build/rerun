import { Image, Label, Menu, Toggle } from '@expo/ui/swift-ui'
import type { WorkspaceSummary } from '@rerun/contracts'
import { useEffect, useState } from 'react'
import { View } from 'react-native'
import { useTranslations } from 'use-intl'

import { fetchWorkspaces } from '@/api/account'
import { useAuth } from '@/auth/AuthProvider'
import { WorkspaceLogo } from '@/components/home/WorkspaceLogo'
import { initialSymbolOf, useWorkspaceLogoFiles, workspaceLabel } from '@/components/home/workspace-logos'
import { AppText } from '@/components/ui/AppText'
import { GLASS_BUTTON_SIZE } from '@/components/ui/GlassButton'
import { Icon } from '@/components/ui/Icon'
import { NativeMenu } from '@/components/ui/NativeMenu'
import { cachedWorkspaces } from '@/data/local-cache'
import { useTheme } from '@/theme/theme'
import { spacing } from '@/theme/tokens'

export function WorkspaceMenu() {
    const { me, switchWorkspace } = useAuth()
    const workspaces = useWorkspaces()
    return <WorkspaceMenuView current={me?.workspace} workspaces={workspaces} onSwitch={switchWorkspace} />
}

export function WorkspaceSubmenu() {
    const { me, switchWorkspace } = useAuth()
    const t = useTranslations('mobileHome')
    const workspaces = useWorkspaces()
    return (
        <Menu label={workspaceLabel(me?.workspace, t)} systemImage="square.stack">
            <WorkspaceToggles current={me?.workspace} workspaces={workspaces} onSwitch={switchWorkspace} />
        </Menu>
    )
}

function useWorkspaces() {
    const { me, session } = useAuth()
    const accessToken = session?.access_token
    const userId = session?.user.id
    const currentId = me?.workspace.id
    const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>(() => (userId ? (cachedWorkspaces(userId).read() ?? []) : []))

    useEffect(() => {
        if (!accessToken || !userId) return
        let alive = true
        cachedWorkspaces(userId)
            .load(() => fetchWorkspaces({ accessToken }))
            .then(list => alive && setWorkspaces(list))
            .catch(error => console.warn('[workspaces] loading failed', error))
        return () => {
            alive = false
        }
    }, [accessToken, userId, currentId])

    return workspaces
}

type WorkspaceSwitchProps = { current: WorkspaceSummary | undefined; workspaces: WorkspaceSummary[]; onSwitch: (workspaceId: number) => void }

export function WorkspaceMenuView({ current, workspaces, onSwitch }: WorkspaceSwitchProps) {
    const theme = useTheme()
    const t = useTranslations('mobileHome')
    const name = workspaceLabel(current, t)

    return (
        <NativeMenu
            glass="capsule"
            label={t('workspace.menuLabel', { name })}
            trigger={
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, height: GLASS_BUTTON_SIZE, maxWidth: 180, paddingLeft: spacing.sm, paddingRight: spacing.md }}>
                    <WorkspaceLogo workspace={current} size={GLASS_BUTTON_SIZE - 2 * spacing.sm} />
                    <AppText variant="headline" numberOfLines={1} maxFontSizeMultiplier={1.2} style={{ flexShrink: 1 }}>
                        {name}
                    </AppText>
                    <Icon name="chevrons-up-down" size={13} color={theme.foreground} />
                </View>
            }
        >
            <WorkspaceToggles current={current} workspaces={workspaces} onSwitch={onSwitch} />
        </NativeMenu>
    )
}

function WorkspaceToggles({ current, workspaces, onSwitch }: WorkspaceSwitchProps) {
    const logoFiles = useWorkspaceLogoFiles(workspaces)
    const t = useTranslations('mobileHome')
    return workspaces.map(workspace => {
        const logoFile = logoFiles.get(workspace.id)
        return (
            <Toggle key={workspace.id} isOn={workspace.id === current?.id} onIsOnChange={() => onSwitch(workspace.id)}>
                {logoFile ? <Label title={workspaceLabel(workspace, t)} icon={<Image uiImage={logoFile} />} /> : <Label title={workspaceLabel(workspace, t)} systemImage={initialSymbolOf(workspace)} />}
            </Toggle>
        )
    })
}
