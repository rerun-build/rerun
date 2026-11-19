import { BorderBeam } from '@moldwright/ui'
import { R_PATH } from '@moldwright/ui/logo'

export function RerunWordmark({ label = 'Moldwright' }: { label?: string }) {
    return (
        <div className="flex w-fit items-center gap-2 rounded-full px-4 py-2">
            <svg viewBox="0 0 512 512" fill="currentColor" aria-hidden className="size-5 text-foreground">
                <path fillRule="evenodd" d={R_PATH} />
            </svg>
            <span className="text-lg font-medium">{label}</span>
            <BorderBeam tone="brand" animated={false} glow width={1.5} radius="9999px" />
        </div>
    )
}
