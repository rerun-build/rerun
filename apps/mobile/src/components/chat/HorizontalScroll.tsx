import { ScrollView, View, type ScrollViewProps } from 'react-native'

const takeTouch = () => true

export function HorizontalScroll({ children, ...props }: ScrollViewProps) {
    return (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} {...props}>
            <View onStartShouldSetResponder={takeTouch}>{children}</View>
        </ScrollView>
    )
}
