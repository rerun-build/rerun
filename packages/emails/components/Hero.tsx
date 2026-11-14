import * as React from "react";
import { Img, Section } from "@react-email/components";
import {
  heroUrl,
  newsletterArtUrl,
  sceneUrl,
  SCENE_HEIGHT,
  SCENE_WIDTH,
  type HeroScene,
  type HeroVariant,
} from "../assets";
import { theme } from "../theme";

export type HeroProps =
  | { variant: HeroVariant; board?: string }
  | { scene: HeroScene; board?: string }
  | { newsletter: string };

const STRIPE_HEIGHT = 88;

function heroSrc(props: HeroProps): string {
  if ("board" in props && props.board) return props.board;
  if ("variant" in props) return heroUrl(props.variant);
  if ("scene" in props) return sceneUrl(props.scene);
  return newsletterArtUrl(props.newsletter);
}

export function Hero(props: HeroProps) {
  const stripe = "variant" in props && !props.board;

  return (
    <Section style={wrap}>
      <Img
        src={heroSrc(props)}
        width={stripe ? theme.width.card : SCENE_WIDTH}
        height={stripe ? STRIPE_HEIGHT : SCENE_HEIGHT}
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
