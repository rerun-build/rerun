// React Native's Switch reaches the native view as `disabled` on iOS and as `enabled` on Android.
export function isSwitchDisabled(element: { props: Record<string, unknown> }): boolean {
    return element.props.disabled === true || element.props.enabled === false
}
