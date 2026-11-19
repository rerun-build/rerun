import { cn } from "@/lib/utils";
import { TextShimmer, type TextShimmerProps } from "@moldwright/ui";

export type { TextShimmerProps };

export function Shimmer({
  as = "p",
  spread = 2,
  scaleSpreadWithLength = true,
  className,
  ...props
}: TextShimmerProps) {
  return (
    <TextShimmer
      as={as}
      spread={spread}
      scaleSpreadWithLength={scaleSpreadWithLength}
      className={cn(
        "[--shimmer-base:var(--color-muted-foreground)] [--shimmer-highlight:var(--color-background)]",
        className
      )}
      {...props}
    />
  );
}
