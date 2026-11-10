import type { MetadataRoute } from "next";

// Installable PWA. Icons come from scripts/make-icons.mjs (replace with the official logo when available).
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Horti Magici",
    short_name: "Horti Magici",
    description: "Staff scheduling for Horti Magici",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#F7F2E8",
    theme_color: "#234A49",
    lang: "it",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
