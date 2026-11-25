import { brandManifestIcons } from "@/lib/brand/icons";
import { getBrand } from "@/lib/brand/server";
import { site } from "@/lib/site";
import { isWhiteLabel } from "@rerun/contracts";
import type { MetadataRoute } from "next";

export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const brand = await getBrand();
  return {
    id: "/",
    name: brand.name,
    short_name: brand.name,
    ...(isWhiteLabel(brand) ? {} : { description: site.description }),
    start_url: "/",
    display: "standalone",
    background_color: "#0a0a0a",
    theme_color: "#0a0a0a",
    icons: brandManifestIcons(brand),
  };
}
