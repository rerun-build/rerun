import { View } from 'react-native'

import { HOME_GUTTER } from '@/components/home/CoworkerRow'
import { SearchBar } from '@/components/home/SearchBar'
import { GLASS_BUTTON_SIZE } from '@/components/ui/GlassButton'

export const BOTTOM_BAR_SIZE = GLASS_BUTTON_SIZE

export function HomeBottomBar({ onSearch }: { onSearch: () => void }) {
    return (
        <View pointerEvents="box-none" style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: HOME_GUTTER }}>
            <SearchBar onPress={onSearch} />
        </View>
    )
}
