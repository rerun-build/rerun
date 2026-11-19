import type { WorkspaceSummary } from '@moldwright/contracts'
import { Image } from 'expo-image'
import { useState } from 'react'
import { View } from 'react-native'

import { logoUrlOf, workspaceInitials } from '@/components/home/workspace-logos'
import { AppText } from '@/components/ui/AppText'
import { useTheme } from '@/theme/theme'

export function WorkspaceLogo({ workspace, size = 22 }: { workspace: Pick<WorkspaceSummary, 'name' | 'iconUrl'> | undefined; size?: number }) {
    const theme = useTheme()
    const url = logoUrlOf(workspace?.iconUrl)
    const [broken, setBroken] = useState<string | null>(null)
    return (
        <View style={{ width: size, height: size, borderRadius: size / 2, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', backgroundColor: theme.muted }}>
            {url && broken !== url ? (
                <Image source={{ uri: url }} contentFit="cover" onError={() => setBroken(url)} style={{ width: '100%', height: '100%' }} />
            ) : (
                <AppText variant="caption" medium maxFontSizeMultiplier={1} style={{ fontSize: size * 0.42, lineHeight: size * 0.5 }}>
                    {workspaceInitials(workspace)}
                </AppText>
            )}
        </View>
    )
}
