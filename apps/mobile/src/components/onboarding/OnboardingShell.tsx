import type { ReactNode } from 'react'
import { View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { AccountMenu } from '@/components/home/AccountMenu'
import { WorkspaceMenu } from '@/components/home/WorkspaceMenu'
import { usePaneInsets } from '@/components/layout/PaneSize'
import { useTheme } from '@/theme/theme'
import { spacing } from '@/theme/tokens'

// The frame of the onboarding, NoPlan's: the account and the other workspaces stay within reach while
// the first team is being set up.
export function OnboardingShell({ children }: { children: ReactNode }) {
    const theme = useTheme()
    const insets = useSafeAreaInsets()
    const pane = usePaneInsets()
    return (
        <View style={{ flex: 1, backgroundColor: theme.background, paddingTop: insets.top + spacing.xs, paddingLeft: pane.left, paddingRight: pane.right }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.lg }}>
                <AccountMenu />
                <View style={{ flex: 1 }} />
                <WorkspaceMenu />
            </View>
            {children}
        </View>
    )
}
