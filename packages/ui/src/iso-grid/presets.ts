import { brandIconToneFromUrl } from "../brand-icon";
import { ISO_HALO_COLOR } from "./iso";
import type { TileStyle } from "./types";

const CONNECTOR_COLOR = "#0f172a";
const CONNECTOR_DEPTH = 3;
const DARK_LOGO_FILTER = "brightness(0) invert(1)";

export type AgentStatus =
  | "idle"
  | "working"
  | "error"
  | "offline"
  | "waiting_human";

export const AGENT_STATUS_LABEL: Record<AgentStatus, string> = {
  idle: "Idle",
  working: "Working",
  error: "Error",
  offline: "Offline",
  waiting_human: "Waiting for you",
};

export const DISABLED_AGENT_LABEL = "Inactive";

export function disabledAgentTileStyle(label: string): TileStyle {
  return {
    color: "var(--iso-tile-muted)",
    glow: "transparent",
    opacity: 0.6,
    label,
    badge: "lock",
    stripes: true,
    buddy: { mood: "asleep" },
    status: { label: DISABLED_AGENT_LABEL, labelKey: "disabled", tone: "neutral" },
  };
}

export function agentTileStyle(
  status: AgentStatus,
  label: string,
  attentionCount = 0,
): TileStyle {
  switch (status) {
    case "working":
      return {
        color: "#f59e0b",
        glow: "rgba(245, 158, 11, 0.6)",
        opacity: 1,
        label,
        shimmer: true,
        stripes: "hover",
        buddy: true,
        status: {
          label: AGENT_STATUS_LABEL.working,
          labelKey: "working",
          tone: "orange",
          pinned: { label: AGENT_STATUS_LABEL.working, labelKey: "working", spinner: true },
        },
      };
    case "error":
      return {
        color: "#ef4444",
        glow: "rgba(239, 68, 68, 0.6)",
        opacity: 1,
        label,
        errorPulse: true,
        stripes: "hover",
        buddy: true,
        status: {
          label: AGENT_STATUS_LABEL.error,
          labelKey: "error",
          tone: "red",
          pinned: {
            icon: "warning",
            count: attentionCount > 0 ? attentionCount : undefined,
          },
        },
      };
    case "offline":
      return {
        color: "var(--iso-tile-muted)",
        glow: "transparent",
        opacity: 0.8,
        label,
        stripes: "hover",
        buddy: { mood: "asleep" },
        status: { label: AGENT_STATUS_LABEL.offline, labelKey: "offline", tone: "neutral" },
      };
    case "waiting_human":
      return {
        color: "#06b6d4",
        glow: "rgba(6, 182, 212, 0.5)",
        opacity: 1,
        label,
        pingRings: true,
        badge: "hand",
        stripes: "hover",
        buddy: true,
        status: {
          label: AGENT_STATUS_LABEL.waiting_human,
          labelKey: "waiting_human",
          tone: "cyan",
          pinned:
            attentionCount > 0
              ? { icon: "hand", count: attentionCount }
              : undefined,
        },
      };
    case "idle":
    default:
      return {
        color: "var(--iso-tile-idle)",
        glow: "var(--iso-tile-idle-glow)",
        haloColor: ISO_HALO_COLOR,
        ink: "theme",
        sheen: true,
        opacity: 1,
        label,
        stripes: "hover",
        buddy: true,
      };
  }
}

export function connectorTileStyle(icon: string | null | undefined): TileStyle {
  if (icon == null) return { color: CONNECTOR_COLOR, depth: CONNECTOR_DEPTH };
  return {
    color: CONNECTOR_COLOR,
    depth: CONNECTOR_DEPTH,
    image: icon,
    imageFilter:
      brandIconToneFromUrl(icon) === "dark" ? DARK_LOGO_FILTER : undefined,
  };
}

export const SPACE_COLOR = "#ffffff";
