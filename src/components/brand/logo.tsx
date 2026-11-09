import fs from "node:fs";
import path from "node:path";
import { cn } from "@/lib/utils";

const LOGO_PATH = "/brand/horti-magici-logo.png";
const logoExists = () => fs.existsSync(path.join(process.cwd(), "public", LOGO_PATH));

/**
 * Uses the official logo when public/brand/horti-magici-logo.png is present;
 * otherwise falls back to a typographic wordmark so the app never shows a broken image.
 */
export function Logo({ className, size = 48 }: { className?: string; size?: number }) {
  if (logoExists()) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={LOGO_PATH} alt="Horti Magici" height={size} style={{ height: size, width: "auto" }} className={className} />;
  }
  return (
    <span className={cn("font-display whitespace-nowrap text-brand tracking-[0.18em] uppercase", className)} style={{ fontSize: size * 0.5 }}>
      Horti Magici
    </span>
  );
}
