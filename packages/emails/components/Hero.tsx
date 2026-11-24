import * as React from "react";
import { Img, Section } from "@react-email/components";
import {
  heroUrl,
  newsletterArtUrl,
  sceneUrl,
  CLOSE_UP_HEIGHT,
  SCENE_HEIGHT,
  SCENE_WIDTH,
  type HeroScene,
  type HeroVariant,
} from "../assets";
import { theme } from "../theme";

// A reporting email opens on the icon stripe, a re-engagement email on a rendered scene, a
// newsletter on the render drawn for that one issue: one of the three, never two, so they are the
// three arms of the same prop. The stripe is the odd one out, a thin band of icons rather than a
// picture, so it alone keeps its own dimensions.
//
// `board` is a capture of the reader's own workspace (/og/board), framed like a scene. It replaces
// the stripe or the scene when the sender managed to have it captured before sending; the arm is
// still given so a message whose capture did not come back keeps its usual picture. `closeUp` is the
// same for an alert: one coworker, or what stopped several, close enough to read without the words.
export type HeroProps =
  | { variant: HeroVariant; board?: string; closeUp?: string }
  | { scene: HeroScene; board?: string; closeUp?: string }
  | { newsletter: string };

const STRIPE_HEIGHT = 88;

function heroSrc(props: HeroProps, origin?: string): string {
  if ("closeUp" in props && props.closeUp) return props.closeUp;
  if ("board" in props && props.board) return props.board;
  if ("variant" in props) return heroUrl(props.variant, origin);
  if ("scene" in props) return sceneUrl(props.scene, origin);
  return newsletterArtUrl(props.newsletter);
}

export function Hero(props: HeroProps & { origin?: string }) {
  const closeUp = "closeUp" in props && Boolean(props.closeUp);
  const stripe = "variant" in props && !props.board && !closeUp;

  return (
    <Section style={wrap}>
      <Img
        src={heroSrc(props, props.origin)}
        width={stripe ? theme.width.card : SCENE_WIDTH}
        height={stripe ? STRIPE_HEIGHT : closeUp ? CLOSE_UP_HEIGHT : SCENE_HEIGHT}
        alt=""
        style={art}
      />
    </Section>
  );
}

const wrap: React.CSSProperties = {
  fontSize: 0,
  lineHeight: 0,
};

const art: React.CSSProperties = {
  display: "block",
  width: "100%",
  maxWidth: `${theme.width.card}px`,
  height: "auto",
};
