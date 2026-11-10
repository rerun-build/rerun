"use client";

import { PendingHitlPill } from "@/components/chat/PendingHitlPill";
import { Button } from "@/components/ui/button";
import { bringBlockIn } from "@/hooks/useArriveByTop";
import { usePendingInView } from "@/hooks/usePendingInView";
import { scrollCueOf, type PendingHitlSummary } from "@/lib/chat/hitl-cue";
import { cn } from "@/lib/utils";
import type { UIMessage } from "ai";
import { ArrowDownIcon, DownloadIcon } from '@/lib/icons';
import { AnimatePresence, motion } from "motion/react";
import { useTranslations } from "next-intl";
import type { ComponentProps, RefObject } from "react";
import { useCallback } from "react";
import { StickToBottom, type StickToBottomContext, useStickToBottomContext } from "use-stick-to-bottom";

export type ConversationProps = ComponentProps<typeof StickToBottom>;

export type ConversationHandle = StickToBottomContext;

export const Conversation = ({ className, ...props }: ConversationProps) => (
  <StickToBottom
    className={cn("relative flex-1 overflow-y-hidden", className)}
    initial="smooth"
    resize="smooth"
    role="log"
    {...props}
  />
);

export type ConversationContentProps = ComponentProps<
  typeof StickToBottom.Content
>;

export const ConversationContent = ({
  className,
  ...props
}: ConversationContentProps) => (
  <StickToBottom.Content
    className={cn("flex flex-col gap-6 p-4", className)}
    {...props}
  />
);

export type ConversationEmptyStateProps = ComponentProps<"div"> & {
  title?: string;
  description?: string;
  icon?: React.ReactNode;
};

export const ConversationEmptyState = ({
  className,
  title,
  description,
  icon,
  children,
  ...props
}: ConversationEmptyStateProps) => {
  const t = useTranslations("chat.conversation");
  const shownTitle = title ?? t("emptyTitle");
  const shownDescription = description ?? t("emptyDescription");
  return (
  <div
    className={cn(
      "flex size-full flex-col items-center justify-center gap-3 p-8 text-center",
      className
    )}
    {...props}
  >
    {children ?? (
      <>
        {icon && <div className="text-muted-foreground">{icon}</div>}
        <div className="space-y-1">
          <h3 className="font-medium text-sm">{shownTitle}</h3>
          {shownDescription && (
            <p className="text-muted-foreground text-sm">{shownDescription}</p>
          )}
        </div>
      </>
    )}
  </div>
  );
};

export type PendingHitlCue = {
  key: string;
  summary: PendingHitlSummary;
  blockRef: RefObject<HTMLElement | null>;
};

export type ConversationScrollButtonProps = ComponentProps<typeof Button> & {
  pending?: PendingHitlCue | null;
};

const CUE_MOTION = {
  initial: { opacity: 0, y: 8, scale: 0.96 },
  animate: { opacity: 1, y: 0, scale: 1 },
  exit: { opacity: 0, y: 8, scale: 0.96 },
  transition: { duration: 0.22, ease: [0.4, 0, 0.2, 1] },
} as const;

export const ConversationScrollButton = ({
  className,
  pending = null,
  ...props
}: ConversationScrollButtonProps) => {
  const t = useTranslations("chat.conversation");
  const context = useStickToBottomContext();
  const { isAtBottom, scrollToBottom, scrollRef } = context;
  const visibility = usePendingInView(scrollRef, pending?.blockRef, pending?.key ?? null);
  const cue = scrollCueOf({
    pending: !!pending && visibility !== "absent",
    pendingInView: visibility === "in-view",
    atBottom: isAtBottom,
  });
  const handleScrollToBottom = useCallback(() => {
    scrollToBottom();
  }, [scrollToBottom]);

  const jumpToPending = () => {
    const blockEl = pending?.blockRef.current;
    if (!blockEl) return;
    bringBlockIn(context, blockEl, "smooth");
  };

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-4 flex justify-center px-4">
      <AnimatePresence initial={false} mode="popLayout">
        {cue === "arrow" && (
          <motion.div key="arrow" {...CUE_MOTION} className="pointer-events-auto">
            <Button
              className={cn("rounded-full dark:bg-background dark:hover:bg-muted", className)}
              onClick={handleScrollToBottom}
              size="icon"
              type="button"
              variant="outline"
              aria-label={t("scrollToLatest")}
              {...props}
            >
              <ArrowDownIcon className="size-4" />
            </Button>
          </motion.div>
        )}
        {cue === "pill" && pending && (
          <motion.div key="pill" {...CUE_MOTION} className="pointer-events-auto flex max-w-full justify-center">
            <PendingHitlPill summary={pending.summary} onJump={jumpToPending} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

const getMessageText = (message: UIMessage): string =>
  message.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("");

export type ConversationDownloadProps = Omit<
  ComponentProps<typeof Button>,
  "onClick"
> & {
  messages: UIMessage[];
  filename?: string;
  formatMessage?: (message: UIMessage, index: number) => string;
};

const defaultFormatMessage = (message: UIMessage): string => {
  const roleLabel =
    message.role.charAt(0).toUpperCase() + message.role.slice(1);
  return `**${roleLabel}:** ${getMessageText(message)}`;
};

export const messagesToMarkdown = (
  messages: UIMessage[],
  formatMessage: (
    message: UIMessage,
    index: number
  ) => string = defaultFormatMessage
): string => messages.map((msg, i) => formatMessage(msg, i)).join("\n\n");

export const ConversationDownload = ({
  messages,
  filename = "conversation.md",
  formatMessage = defaultFormatMessage,
  className,
  children,
  ...props
}: ConversationDownloadProps) => {
  const handleDownload = useCallback(() => {
    const markdown = messagesToMarkdown(messages, formatMessage);
    const blob = new Blob([markdown], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }, [messages, filename, formatMessage]);

  return (
    <Button
      className={cn(
        "absolute top-4 right-4 rounded-full dark:bg-background dark:hover:bg-muted",
        className
      )}
      onClick={handleDownload}
      size="icon"
      type="button"
      variant="outline"
      {...props}
    >
      {children ?? <DownloadIcon className="size-4" />}
    </Button>
  );
};
