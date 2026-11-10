import { Button } from '@expo/ui/swift-ui'
import { Image } from 'expo-image'
import { router } from 'expo-router'
import { useState } from 'react'
import { useTranslations } from 'use-intl'

import { useAuth } from '@/auth/AuthProvider'
import { contactSupport, initialsOf } from '@/components/home/account-actions'
import { WorkspaceSubmenu } from '@/components/home/WorkspaceMenu'
import { AppText } from '@/components/ui/AppText'
import { Icon } from '@/components/ui/Icon'
import { CircleTrigger, NativeMenu } from '@/components/ui/NativeMenu'
import { onCustomServer } from '@/config/environment'
import { useTheme } from '@/theme/theme'

export function AccountMenu() {
    const theme = useTheme()
    const { me, signOut } = useAuth()
    const initials = initialsOf(me?.user)
    const avatarUrl = me?.user?.avatarUrl
    const [brokenAvatar, setBrokenAvatar] = useState<string | null>(null)
    const t = useTranslations('mobileHome')
    return (
        <NativeMenu
            glass="circle"
            label={t('header.account')}
            trigger={
                <CircleTrigger>
                        {avatarUrl && brokenAvatar !== avatarUrl ? (
                            <Image source={{ uri: avatarUrl }} contentFit="cover" onError={() => setBrokenAvatar(avatarUrl)} style={{ width: '100%', height: '100%' }} />
                        ) : initials ? (
                            <AppText variant="footnote" medium maxFontSizeMultiplier={1}>
                                {initials}
                            </AppText>
                        ) : (
                            <Icon name="user" size={17} color={theme.foreground} />
                        )}
                </CircleTrigger>
            }
        >
            <WorkspaceSubmenu />
            <Button label={t('account.preferences')} systemImage="gearshape" onPress={() => router.push('/settings')} />
            {!onCustomServer && <Button label={t('account.contactSupport')} systemImage="bubble.left" onPress={() => contactSupport(me?.user)} />}
            <Button label={t('account.signOut')} systemImage="rectangle.portrait.and.arrow.right" role="destructive" onPress={signOut} />
        </NativeMenu>
    )
}
