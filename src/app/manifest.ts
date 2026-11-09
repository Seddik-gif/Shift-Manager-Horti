import type { MetadataRoute } from "next";

// Installable PWA manifest. Icons are added once the official logo files are supplied.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Horti Magici",
    short_name: "Horti Magici",
    description: "Staff scheduling for Horti Magici",
    start_url: "/",
    display: "standalone",
    background_color: "#F7F2E8",
    theme_color: "#234A49",
    lang: "it",
  };
}
