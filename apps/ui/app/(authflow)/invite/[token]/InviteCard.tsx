import { Card } from '@/components/ui/card'

export function InviteCard({ title, message }: { title: string; message: string }) {
    return (
        <Card className="space-y-2 p-8">
            <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
            <p className="text-sm text-muted-foreground">{message}</p>
        </Card>
    )
}
