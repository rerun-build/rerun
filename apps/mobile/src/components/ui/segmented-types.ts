export type SegmentedOption<Value extends string> = { value: Value; label: string }

export type SegmentedControlProps<Value extends string> = {
    options: readonly SegmentedOption<Value>[]
    value: Value
    onChange: (value: Value) => void
}
