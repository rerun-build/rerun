"use client"

import * as React from "react"
import { Checkbox as CheckboxPrimitive } from "radix-ui"
import { Check, MinusIcon } from '@/lib/icons'
import { BorderBeam } from "@rerun/ui"

import { cn } from "@/lib/utils"

type CheckboxSize = "sm" | "default"
type CheckboxVariant = "light" | "brand"

const rootSizeClass: Record<CheckboxSize, string> = {
  sm: "size-4 rounded",
  default: "size-6 rounded-md",
}

const indicatorSizeClass: Record<CheckboxSize, string> = {
  sm: "size-2.5",
  default: "size-4",
}

const rootVariantClass: Record<CheckboxVariant, string> = {
  light: "data-[state=checked]:bg-foreground/15 data-[state=checked]:shadow-[0_0_3px_0_rgba(255,255,255,0.12)]",
  brand: "data-[state=checked]:bg-brand/15 data-[state=checked]:shadow-[0_0_3px_0_color-mix(in_srgb,var(--brand-tint)_12%,transparent)]",
}

const indicatorVariantClass: Record<CheckboxVariant, string> = {
  light: "text-foreground",
  brand: "text-brand",
}

const beamTone: Record<CheckboxVariant, "white" | "brand"> = {
  light: "white",
  brand: "brand",
}

function Checkbox({
  className,
  size = "default",
  variant = "light",
  ...props
}: React.ComponentProps<typeof CheckboxPrimitive.Root> & {
  size?: CheckboxSize
  variant?: CheckboxVariant
}) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        "group peer relative inline-flex shrink-0 cursor-pointer items-center justify-center border border-border bg-transparent transition-[colors,box-shadow] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:border-border",
        rootSizeClass[size],
        rootVariantClass[variant],
        className
      )}
      {...props}
    >
      <BorderBeam
        tone={beamTone[variant]}
        pattern="arcs"
        radius={size === "sm" ? "4px" : "6px"}
        className="-inset-px! opacity-0 transition-opacity group-data-[state=checked]:opacity-100"
        animated
      />
      <CheckboxPrimitive.Indicator
        className={cn("relative flex items-center justify-center", indicatorVariantClass[variant])}
      >
        <Check className={cn(indicatorSizeClass[size], "group-data-[state=indeterminate]:hidden")} strokeWidth={3} />
        <MinusIcon className={cn(indicatorSizeClass[size], "hidden group-data-[state=indeterminate]:block")} strokeWidth={3} />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  )
}

export { Checkbox }
