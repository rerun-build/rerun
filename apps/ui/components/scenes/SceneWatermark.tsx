import { BorderBeam } from '@rerun/ui'
import { R_PATH } from '@rerun/ui/logo'

export function SceneWatermark() {
    return (
        <div className="absolute top-6 left-6 z-10 inline-flex items-center gap-2 rounded-full bg-background/80 px-4 py-2 text-foreground">
            <svg viewBox="0 0 512 512" fill="currentColor" aria-hidden className="size-4">
                <path fillRule="evenodd" d={R_PATH} />
            </svg>
            <span className="text-sm font-medium tracking-tight">rerun.build</span>
            <BorderBeam tone="brand" animated={false} glow width={1.5} radius="9999px" />
        </div>
    )
}
