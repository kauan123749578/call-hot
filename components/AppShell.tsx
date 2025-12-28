import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

const nav = [
  { href: "/", label: "Dashboard" },
  { href: "/history", label: "Histórico" },
  { href: "/sales", label: "Vendas" },
  { href: "/settings", label: "Configurações" }
] as const;

export function AppShell({
  title,
  children,
  onLogout
}: {
  title?: string;
  children: React.ReactNode;
  onLogout?: () => void;
}) {
  const pathname = usePathname();
  const [open, setOpen] = React.useState(false);

  return (
    <div className="min-h-screen bg-black">
      {/* mobile topbar */}
      <div className="sticky top-0 z-40 border-b border-red-500/20 bg-black/95 backdrop-blur-xl lg:hidden">
        <div className="mx-auto flex max-w-screen-2xl items-center justify-between px-4 py-3">
          <button
            type="button"
            className="grid h-10 w-10 place-items-center rounded-lg border border-red-500/30 bg-black/60 text-white hover:bg-red-500/10 transition-colors"
            onClick={() => setOpen(true)}
            aria-label="Abrir menu"
          >
            ≡
          </button>
          <div className="font-brand text-base font-black text-white">CallHot</div>
          <div className="w-10" />
        </div>
      </div>

      {/* backdrop */}
      <div
        className={cn(
          "fixed inset-0 z-40 bg-black/80 opacity-0 pointer-events-none transition-opacity lg:hidden",
          open && "opacity-100 pointer-events-auto"
        )}
        onClick={() => setOpen(false)}
      />

      <div className="mx-auto grid max-w-screen-2xl grid-cols-1 lg:grid-cols-[280px_1fr]">
        {/* sidebar */}
        <aside
          className={cn(
            "fixed z-50 h-full w-[280px] border-r border-red-500/20 bg-black/95 backdrop-blur-xl p-6 transition-transform lg:static lg:translate-x-0",
            open ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
          )}
        >
          <div className="flex items-center justify-between mb-8">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-red-600">
                <svg viewBox="0 0 24 24" className="h-6 w-6 fill-white">
                  <path d="M8 5v14l11-7z" />
                </svg>
              </div>
              <div>
                <div className="text-xl font-black text-white">CALL</div>
                <div className="text-xl font-black text-red-600">HOT</div>
              </div>
            </div>
            <button
              type="button"
              className="grid h-9 w-9 place-items-center rounded-lg border border-red-500/30 bg-black/60 text-white hover:bg-red-500/10 transition-colors lg:hidden"
              aria-label="Fechar menu"
              onClick={() => setOpen(false)}
            >
              ×
            </button>
          </div>

          <nav className="space-y-2">
            {nav.map((item) => {
              const active = pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setOpen(false)}
                  className={cn(
                    "flex items-center justify-between rounded-lg border px-4 py-3 text-sm font-semibold transition-all",
                    active
                      ? "border-red-500/50 bg-red-500/20 text-white shadow-lg shadow-red-500/20"
                      : "border-white/10 bg-transparent text-white/70 hover:bg-red-500/10 hover:border-red-500/30 hover:text-white"
                  )}
                >
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </nav>

          {onLogout ? (
            <div className="mt-8">
              <Button
                variant="secondary"
                className="w-full"
                onClick={onLogout}
              >
                Sair
              </Button>
            </div>
          ) : null}
        </aside>

        {/* content */}
        <main className="px-4 py-8 sm:px-6 lg:px-10">
          {title ? (
            <div className="mb-6">
              <div className="text-3xl font-black text-white">
                {title}
              </div>
              <div className="mt-2 text-sm text-white/60">
                Gerencie links, histórico e vendas
              </div>
            </div>
          ) : null}
          {children}
        </main>
      </div>
    </div>
  );
}
