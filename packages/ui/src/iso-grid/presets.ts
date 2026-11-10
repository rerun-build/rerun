// Preset « agent » : seul endroit qui mappe un statut d'agent vers un TileStyle. Un agent est
// dessiné en buddy ; les couleurs et les flags d'effets disent son état, et le buddy en tire son
// humeur. Les apps l'importent dans leur adaptateur métier.

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

// Le statut écrit en clair, adressé à l'utilisateur. Vit ici avec les couleurs qu'il nomme : une
// tuile ne dit son état que par sa teinte, et personne ne devine ce qu'ambre veut dire.
export const AGENT_STATUS_LABEL: Record<AgentStatus, string> = {
  idle: "Idle",
  working: "Working",
  error: "Error",
  offline: "Offline",
  waiting_human: "Waiting for you",
};

export const DISABLED_AGENT_LABEL = "Inactive";

// Un agent éteint n'a pas de statut : il ne travaille pas, n'attend rien et n'est pas en erreur.
// Il se lit donc avant tout le reste, en bloc gris cadenassé.
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

// `attentionCount` = ce qui attend une réponse humaine sur cet agent (cf. l'onglet « To handle »).
// Un appelant qui ne le connaît pas (scènes scriptées, aperçus de template) laisse le pictogramme
// seul plutôt que d'annoncer un zéro.
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
    // Un agent au repos ne signale rien : il prend la neutre du thème plutôt qu'une couleur, blanc
    // cassé « chrome » sur fond clair et anthracite sur fond sombre. Sa face pouvant être claire,
    // son encre suit le thème elle aussi, et son halo de mise en avant est posé à part : le `glow`
    // n'est une lumière qu'en sombre, en clair c'est une ombre de contact.
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

// Preset « connecteur » : une tuile 1×1, basse et sombre, qui ne porte qu'un logo. Elle se lit comme
// de la plomberie autour des agents, d'où l'absence de label et de glow — la couleur du board est
// réservée aux statuts. À poser avec `span: 1`.
export function connectorTileStyle(icon: string | null | undefined): TileStyle {
  if (icon == null) return { color: CONNECTOR_COLOR, depth: CONNECTOR_DEPTH };
  return {
    color: CONNECTOR_COLOR,
    depth: CONNECTOR_DEPTH,
    image: icon,
    // Une icône que son auteur a dessinée pour un fond clair disparaîtrait sur la tuile : on la
    // passe en silhouette blanche plutôt que de la laisser en pâté noir sur noir.
    imageFilter:
      brandIconToneFromUrl(icon) === "dark" ? DARK_LOGO_FILTER : undefined,
  };
}

// Les spaces n'ont plus d'identité colorée : elles sont toutes rendues en blanc/neutre (rendu subtil
// géré par ContainerBlock, qui reconnaît `#ffffff`). Une seule constante, pas de palette ni de cycle.
export const SPACE_COLOR = "#ffffff";
