export interface NewsletterArt {
  noun: string;
  hero: string;
  satellites: string;
  tilt: string;
  dense: string;
  sparse: string;
}

export const NEWSLETTER_ART: Record<string, NewsletterArt> = {
  "2026-09-28-meet-the-foreman": {
    noun: "hard hat",
    hero: "a construction hard hat seen from the side, a smooth solid dome with a single raised ridge running over its crown and a wide flat brim sticking out in front, much wider than it is tall, filled in and never hollow, reduced to its bare silhouette, no strap, no logo, no lamp, no detail",
    satellites:
      "a crane hook hanging from a short cable, a traffic cone, a spirit level with one bubble, a toolbox with a carrying handle, an open-end wrench",
    tilt: "rotated gently clockwise in a three-quarter view, its brim turned toward the lower right and nearer the camera, seen slightly from below",
    dense: "upper left",
    sparse: "lower right",
  },
  "2026-09-18-what-your-agent-thinks": {
    noun: "binoculars",
    hero: "a pair of binoculars — two thick barrels of equal length fused side by side along their whole length, each closed at both ends by a completely filled solid face that is never pierced, joined by a short bridge between them, reduced to its bare silhouette, no strap, no focus wheel, no engraving, no detail",
    satellites:
      "a magnifying glass with a filled round lens, a speech bubble with a triangular tail, a warning triangle with an exclamation bar, a round gauge dial with a single needle, a terminal window with a chevron prompt",
    tilt: "rotated counter-clockwise in a three-quarter view, its eyepieces turned down toward the lower left and its barrels receding into the frame toward the upper right, seen slightly from above",
    dense: "lower left",
    sparse: "upper right",
  },
  "2026-09-11-agents-by-link": {
    noun: "key",
    hero: "a key seen flat from the side — a long horizontal shaft ending in a solid rounded head, filled in and never pierced, with two square teeth cut into the underside of the far end, reduced to its bare silhouette, no keyring, no engraving, no detail",
    satellites:
      "a paper plane, a sealed envelope with a triangular flap, a small parcel box crossed by tape, a closed padlock, an arrow cursor",
    tilt: "lying almost flat along the horizontal and rotated counter-clockwise in a three-quarter view, its head nearer the camera and its teeth turned away to the right, seen slightly from above",
    dense: "lower right",
    sparse: "upper left",
  },
  "2026-09-04-voice-and-uploads": {
    noun: "waveform",
    hero: "a horizontal voice waveform — eleven thick rounded vertical bars of alternating heights fused along a low central spine, wider than it is tall, reduced to its bare silhouette, no microphone grille, no text, no detail",
    satellites:
      "a handheld microphone, a speech bubble with a triangular tail, a pair of over-ear headphones, a loudspeaker cone, a single musical note",
    tilt: "rotated gently clockwise in a three-quarter view, its left edge closer to the camera and seen slightly from below",
    dense: "upper right",
    sparse: "lower left",
  },
  "2026-09-03-tour-and-templates": {
    noun: "map",
    hero: "a folded paper map — a wide rectangle creased into accordion panels, its top and bottom edges zigzagging where the folds meet, reduced to its bare silhouette, no roads, no print, no detail",
    satellites:
      "a compass rose, a location pin, a signpost with two arms, a flag on a short pole, a stack of two rounded cards",
    tilt: "tilted in a three-quarter view, laid down along the diagonal and seen slightly from above",
    dense: "upper left",
    sparse: "lower right",
  },
};
