import { BorderBeam } from '@rerun/ui'
import { Logo } from '@rerun/ui/logo'

// La signature posée sur toute scène capturée : la même pill que les autres visuels de marque
// (logo + libellé, anneau conic figé), écrite en tokens de thème pour tenir aussi bien sur un
// board clair que sombre.
export function SceneWatermark() {
    return (
        <div className="absolute top-6 start-6 z-10 inline-flex items-center gap-2 rounded-full bg-background/80 px-4 py-2 text-foreground">
            <Logo aria-hidden className="size-5" />
            <span className="text-sm font-medium tracking-tight">rerun.build</span>
            <BorderBeam tone="brand" animated={false} glow width={1.5} radius="9999px" />
        </div>
    )
}
