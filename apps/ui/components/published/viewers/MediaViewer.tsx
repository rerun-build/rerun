import { formatBytes } from '@/lib/files/format'
import { AudioWaveformIcon, FilmIcon } from '@/lib/icons'
import { useLocale } from 'next-intl'
import { RAW_URL, ViewerPage, ViewerTopBar } from './ViewerChrome'

export function MediaViewer({ slug, name, size, kind }: { slug: string; name: string; size: number; kind: 'video' | 'audio' }) {
    const locale = useLocale()
    const icon = kind === 'video' ? FilmIcon : AudioWaveformIcon
    return (
        <ViewerPage slug={slug} bar={<ViewerTopBar icon={icon} name={name} meta={formatBytes(size, locale)} />} className="flex items-center justify-center bg-muted/60 p-6 max-md:p-3">
            {kind === 'video' ? (
                <video src={RAW_URL} controls playsInline preload="metadata" className="max-h-full w-full max-w-[960px] rounded-md bg-black shadow-lg" />
            ) : (
                <div className="flex w-full max-w-[480px] flex-col items-center gap-4 rounded-xl border bg-background p-6">
                    <span className="flex size-14 items-center justify-center rounded-2xl bg-muted">
                        <AudioWaveformIcon className="size-6" />
                    </span>
                    <span className="text-sm font-medium break-all">{name}</span>
                    <audio src={RAW_URL} controls preload="metadata" className="w-full" />
                </div>
            )}
        </ViewerPage>
    )
}
