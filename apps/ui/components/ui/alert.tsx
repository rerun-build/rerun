import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { BorderBeam, type BorderBeamProps } from "@rerun/ui"
import { Stripes } from "@rerun/ui/primitives"

import { cn } from "@/lib/utils"

const alertVariants = cva(
  "group/alert relative grid w-full gap-0.5 rounded-lg border px-2.5 py-2 text-left text-sm has-data-[slot=alert-action]:relative has-data-[slot=alert-action]:pr-18 has-[>svg]:grid-cols-[auto_1fr] has-[>svg]:gap-x-2 *:[svg]:row-span-2 *:[svg]:translate-y-0.5 *:[svg]:text-current *:[svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-card text-card-foreground",
        info: "bg-card text-card-foreground border-cyan-500/30 [&>svg]:text-cyan-400",
        success: "bg-card text-card-foreground border-emerald-500/30 [&>svg]:text-emerald-400",
        warning: "bg-card text-card-foreground border-amber-500/30 [&>svg]:text-amber-400",
        danger:
          "bg-card text-destructive border-destructive/30 *:data-[slot=alert-description]:text-destructive/90 [&>svg]:text-destructive",
        brand: "bg-card text-card-foreground border-brand/30 [&>svg]:text-brand",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

type AlertVariant = NonNullable<VariantProps<typeof alertVariants>["variant"]>

const VARIANT_TONE: Record<AlertVariant, NonNullable<BorderBeamProps["tone"]>> = {
  default: "neutral",
  info: "cyan",
  success: "green",
  warning: "yellow",
  danger: "red",
  brand: "brand",
}

const VARIANT_STRIPE: Record<AlertVariant, string> = {
  default: "var(--stripes-ink)",
  info: "rgb(34 211 238 / 0.05)",
  success: "rgb(52 211 153 / 0.05)",
  warning: "rgb(245 158 11 / 0.06)",
  danger: "rgb(248 113 113 / 0.05)",
  brand: "color-mix(in oklab, var(--color-brand) 6%, transparent)",
}

type AlertProps = React.ComponentProps<"div"> &
  VariantProps<typeof alertVariants> & {
    beam?: boolean
    animated?: boolean
    glow?: boolean
    pattern?: BorderBeamProps["pattern"]
    /** Overrides the beam color derived from `variant`. */
    tone?: BorderBeamProps["tone"]
    beamProps?: Partial<BorderBeamProps>
    stripes?: boolean
    stripesProps?: Partial<React.ComponentProps<typeof Stripes>>
  }

function Alert({
  className,
  variant,
  beam = true,
  animated = true,
  glow = true,
  pattern = "arcs",
  tone,
  beamProps,
  stripes = false,
  stripesProps,
  children,
  ...props
}: AlertProps) {
  return (
    <div
      data-slot="alert"
      role="alert"
      className={cn(
        alertVariants({ variant }),
        stripes && "overflow-hidden",
        beam && "overflow-hidden border-transparent",
        className
      )}
      {...props}
    >
      {stripes && <Stripes color={VARIANT_STRIPE[variant ?? "default"]} {...stripesProps} />}
      {beam && (
        <BorderBeam
          pattern={pattern}
          tone={tone ?? VARIANT_TONE[variant ?? "default"]}
          animated={animated}
          glow={glow}
          width={1}
          duration={7}
          {...beamProps}
        />
      )}
      {children}
    </div>
  )
}

function AlertTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-title"
      className={cn(
        "font-medium [svg~&]:col-start-2 [&_a]:underline [&_a]:underline-offset-3 [&_a]:hover:text-foreground",
        className
      )}
      {...props}
    />
  )
}

function AlertDescription({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-description"
      className={cn(
        "text-sm text-balance text-muted-foreground md:text-pretty [&_a]:underline [&_a]:underline-offset-3 [&_a]:hover:text-foreground [&_p:not(:last-child)]:mb-4",
        className
      )}
      {...props}
    />
  )
}

function AlertAction({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-action"
      className={cn("absolute top-2 right-2", className)}
      {...props}
    />
  )
}

export { Alert, AlertTitle, AlertDescription, AlertAction }
