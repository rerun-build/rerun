import { Stripes } from '@moldwright/ui/primitives'
import { Card } from '@/components/ui/card'

export const JOIN_CARD_CLASS = 'relative bg-card p-8 shadow-xl shadow-black/20 ring-foreground/20'

export function JoinCard({ children }: { children: React.ReactNode }) {
    return (
        <Card className={JOIN_CARD_CLASS}>
            <Stripes fade="edges" edgeWidth={120} color="rgb(245 158 11 / 0.12)" />
            <div className="relative flex flex-col gap-6">{children}</div>
        </Card>
    )
}

export function JoinShell({ title, message }: { title: string; message: string }) {
    return (
        <JoinCard>
            <div className="space-y-2">
                <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
                <p className="text-sm text-muted-foreground">{message}</p>
            </div>
        </JoinCard>
    )
}
