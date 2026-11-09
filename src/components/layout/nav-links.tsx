"use client";

import { Link, usePathname } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

export interface NavItem {
  href: "/admin" | "/admin/employees" | "/admin/availability" | "/admin/schedule" | "/admin/requests" | "/employee" | "/employee/schedule";
  label: string;
}

export function NavLinks({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Main" className="flex gap-1 overflow-x-auto">
      {items.map((item) => {
        const active =
          item.href === pathname || (item.href !== "/admin" && pathname.startsWith(item.href));
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "whitespace-nowrap rounded-full px-4 py-2 text-sm font-medium transition-colors",
              active ? "bg-brand-soft text-brand" : "text-ink-soft hover:bg-mist hover:text-ink",
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
