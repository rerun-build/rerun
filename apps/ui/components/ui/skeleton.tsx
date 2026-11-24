import { Skeleton } from "@rerun/ui/primitives"

import { cn } from "@/lib/utils"
import { PANEL_CARD } from "@/components/ui/panel-row"

function SkeletonList({ rows = 5, className, ...props }: React.ComponentProps<"div"> & { rows?: number }) {
  return (
    <div className={cn("space-y-1", className)} {...props}>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-2.5 px-2 py-2">
          <Skeleton className="size-7 shrink-0 rounded-full" />
          <Skeleton className="h-3.5 w-1/2" />
          <Skeleton className="ms-auto h-3 w-12 shrink-0" />
        </div>
      ))}
    </div>
  )
}

function SkeletonRows({ rows = 4, className, ...props }: React.ComponentProps<"div"> & { rows?: number }) {
  return (
    <div className={cn("space-y-2", className)} {...props}>
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-4 w-full" />
      ))}
    </div>
  )
}

function SkeletonPanelRows({
  rows = 5,
  lines = 2,
  badge = false,
  leading = false,
  className,
  ...props
}: React.ComponentProps<"div"> & { rows?: number; lines?: 2 | 3; badge?: boolean; leading?: boolean }) {
  return (
    <div className={cn("space-y-2 p-3", className)} {...props}>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className={cn("flex items-center gap-3 p-3", PANEL_CARD)}>
          {leading && <Skeleton className="size-8 shrink-0 rounded-md" />}
          <div className="flex flex-1 flex-col gap-1.5">
            <div className="flex items-center justify-between gap-2">
              <Skeleton className="h-3.5 w-1/3" />
              {badge && <Skeleton className="h-3 w-10 shrink-0" />}
            </div>
            <Skeleton className="h-3 w-2/3" />
            {lines === 3 && <Skeleton className="h-3 w-1/4" />}
          </div>
        </div>
      ))}
    </div>
  )
}

function SkeletonCardGrid({
  rows = 6,
  cols = 2,
  className,
  ...props
}: React.ComponentProps<"div"> & { rows?: number; cols?: number }) {
  return (
    <div
      className={cn("grid content-start gap-2", className)}
      style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
      {...props}
    >
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className={cn("flex flex-col gap-2 p-3", PANEL_CARD)}>
          <div className="flex items-start justify-between gap-2">
            <Skeleton className="size-10 rounded-md" />
            <Skeleton className="h-5 w-9 rounded-full" />
          </div>
          <div className="space-y-1.5">
            <Skeleton className="h-3.5 w-2/3" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-4/5" />
          </div>
        </div>
      ))}
    </div>
  )
}

const TABLE_CELL_WIDTHS = ["w-16", "w-24", "w-20", "w-28", "w-12", "w-20"]

function SkeletonTable({
  rows = 8,
  cols = 4,
  className,
  ...props
}: React.ComponentProps<"div"> & { rows?: number; cols?: number }) {
  return (
    <div className={cn(className)} {...props}>
      <div className="flex gap-4 border-b border-border px-2 py-1.5">
        {Array.from({ length: cols }).map((_, c) => (
          <Skeleton key={c} className={cn("h-3", TABLE_CELL_WIDTHS[c % TABLE_CELL_WIDTHS.length])} />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex gap-4 border-b border-border/50 px-2 py-1.5">
          {Array.from({ length: cols }).map((_, c) => (
            <Skeleton key={c} className={cn("h-3", TABLE_CELL_WIDTHS[(r + c) % TABLE_CELL_WIDTHS.length])} />
          ))}
        </div>
      ))}
    </div>
  )
}

const TILE_NAME_WIDTHS = ["w-12", "w-14", "w-10", "w-full", "w-11", "w-13", "w-9"]

function SkeletonFileGrid({ tiles = 10, className, ...props }: React.ComponentProps<"div"> & { tiles?: number }) {
  return (
    <div className={cn("grid content-start gap-1 p-3 [grid-template-columns:repeat(auto-fill,minmax(84px,1fr))]", className)} {...props}>
      {Array.from({ length: tiles }).map((_, i) => (
        <div key={i} className="flex flex-col items-center gap-1.5 p-2">
          <Skeleton className="size-16 rounded-md" />
          <Skeleton className={cn("h-3", TILE_NAME_WIDTHS[i % TILE_NAME_WIDTHS.length])} />
        </div>
      ))}
    </div>
  )
}

function SkeletonChatMessage({ role }: { role: "user" | "assistant" }) {
  if (role === "user") {
    return (
      <div className="ms-auto flex w-fit max-w-[95%] flex-col gap-2 rounded-lg bg-secondary px-4 py-3">
        <Skeleton className="h-3.5 w-48" />
        <Skeleton className="h-3.5 w-32" />
      </div>
    )
  }
  return (
    <div className="flex w-full flex-col gap-2">
      <Skeleton className="h-3.5 w-1/2" />
      <Skeleton className="h-3.5 w-5/6" />
      <Skeleton className="h-3.5 w-3/4" />
      <Skeleton className="h-3.5 w-2/3" />
    </div>
  )
}

function SkeletonChat({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div className={cn("flex flex-col gap-6", className)} {...props}>
      <SkeletonChatMessage role="user" />
      <SkeletonChatMessage role="assistant" />
      <SkeletonChatMessage role="user" />
      <SkeletonChatMessage role="assistant" />
    </div>
  )
}

function SkeletonForm({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div className={cn("space-y-4", className)} {...props}>
      <div className="space-y-1.5">
        <Skeleton className="h-3 w-12" />
        <Skeleton className="h-4 w-1/3" />
      </div>
      <Skeleton className="h-px w-full" />
      <div className="space-y-2.5">
        <Skeleton className="h-3 w-28" />
        <div className="flex items-center justify-between gap-2">
          <Skeleton className="h-3.5 w-1/2" />
          <Skeleton className="h-5 w-9 rounded-full" />
        </div>
        <div className="flex items-center justify-between gap-2">
          <Skeleton className="h-3.5 w-2/5" />
          <Skeleton className="h-5 w-9 rounded-full" />
        </div>
      </div>
      <Skeleton className="h-px w-full" />
      <div className="space-y-1.5">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-24 w-full" />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1.5">
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-8 w-full" />
        </div>
        <div className="space-y-1.5">
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-8 w-full" />
        </div>
      </div>
    </div>
  )
}

export {
  Skeleton,
  SkeletonList,
  SkeletonRows,
  SkeletonPanelRows,
  SkeletonCardGrid,
  SkeletonTable,
  SkeletonFileGrid,
  SkeletonForm,
  SkeletonChat,
}
