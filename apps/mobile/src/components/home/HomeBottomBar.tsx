import { View } from 'react-native'

import { HOME_GUTTER } from '@/components/home/CoworkerRow'
import { SearchBar } from '@/components/home/SearchBar'
import { spacing } from '@/theme/tokens'

export const BOTTOM_BAR_SIZE = 48

// The bar sits a little into the home indicator's inset, as Grok's does, and never under the edge.
export function bottomBarInset(bottom: number) {
    return Math.max(bottom - 6, spacing.sm)
}

export function HomeBottomBar({ onSearch }: { onSearch: () => void }) {
    return (
        <View pointerEvents="box-none" style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: HOME_GUTTER }}>
            <SearchBar height={BOTTOM_BAR_SIZE} onPress={onSearch} />
        </View>
    )
}
