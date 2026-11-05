import { PresentationIcon } from '@/lib/icons'
import { splitMarkdownSlides } from '@/lib/published/viewer-kind'
import { Markdown } from '@rerun/ui/markdown'
import { DOCUMENT_CLASS } from './MarkdownViewer'
import { slideFit } from './slide-fit'
import { SlideStage } from './SlideStage'
import { ViewerPage, ViewerTopBar } from './ViewerChrome'

export function MarkdownSlides({ slug, name, markdown }: { slug: string; name: string; markdown: string }) {
    const slides = splitMarkdownSlides(markdown)
    return (
        <ViewerPage slug={slug} bar={<ViewerTopBar icon={PresentationIcon} name={name} meta={`${slides.length} slide${slides.length === 1 ? '' : 's'}`} />} className="overflow-hidden">
            <SlideStage
                slides={slides.map((slide, index) => (
                    <div key={index} className="aspect-video overflow-auto rounded-lg bg-card p-[6%] text-card-foreground shadow-2xl ring-1 ring-white/10" style={slideFit(16 / 9)}>
                        <Markdown content={slide} className={DOCUMENT_CLASS} />
                    </div>
                ))}
            />
        </ViewerPage>
    )
}
