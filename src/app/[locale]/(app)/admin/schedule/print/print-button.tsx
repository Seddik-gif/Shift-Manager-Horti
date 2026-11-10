"use client";

import { Button } from "@/components/ui/button";

export function PrintButton({ label }: { label: string }) {
  return <Button onClick={() => window.print()}>🖨 {label}</Button>;
}
