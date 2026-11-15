export function isSwitchDisabled(element: { props: Record<string, unknown> }): boolean {
    return element.props.disabled === true || element.props.enabled === false
}
