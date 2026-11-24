import { BorderBeam } from '@rerun/ui'
import { Logo } from '@rerun/ui/logo'

export function RerunWordmark({ label = 'Rerun' }: { label?: string }) {
    return (
        <div className="flex w-fit items-center gap-2 rounded-full px-4 py-2">
            <Logo aria-hidden className="size-6" />
            <span className="text-lg font-medium">{label}</span>
            <BorderBeam tone="brand" animated={false} glow width={1.5} radius="9999px" />
        </div>
    )
}
