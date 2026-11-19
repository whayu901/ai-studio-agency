"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { api } from "@/lib/client";
import { Badge, cx } from "./ui";

const NAV = [
  { href: "/", label: "Dashboard" },
  { href: "/campaigns", label: "Campaigns" },
  { href: "/jobs", label: "Production jobs" },
  { href: "/characters", label: "Characters" },
  { href: "/settings", label: "Settings & ops" },
];

function ThemeToggle() {
  const [theme, setTheme] = useState<string>("system");
  useEffect(() => {
    try {
      setTheme(localStorage.getItem("acs.theme") ?? "system");
    } catch {
      /* ignore */
    }
  }, []);
  const apply = (t: string) => {
    setTheme(t);
    try {
      localStorage.setItem("acs.theme", t);
    } catch {
      /* ignore */
    }
    if (t === "system") document.documentElement.removeAttribute("data-theme");
    else document.documentElement.setAttribute("data-theme", t);
  };
  return (
    <label className="flex items-center gap-2 text-xs text-muted">
      Theme
      <select className="rounded-md border border-line bg-panel px-1.5 py-1 text-xs text-text" value={theme} onChange={(e) => apply(e.target.value)}>
        <option value="system">System</option>
        <option value="light">Light</option>
        <option value="dark">Dark</option>
      </select>
    </label>
  );
}

function ModeStrip() {
  const [s, setS] = useState<any>(null);
  useEffect(() => {
    api("/api/settings").then(setS).catch(() => setS(null));
  }, []);
  if (!s) return null;
  const n8n = s.orchestrator;
  return (
    <div className="flex flex-col gap-1.5 text-xs">
      <Badge tone={s.ai.modes.anthropic.available ? "accent" : "neutral"} title="Creative stages run as mock templates or manual Claude unless an API key and budget are configured">
        AI: {s.ai.modes.anthropic.available ? "mock · manual · API" : "mock · manual only"}
      </Badge>
      <Badge tone="info" title="Google Flow and Seedance are rendered by a person in their web UIs">Rendering: manual</Badge>
      <Badge tone={n8n.mode === "n8n" ? (n8n.health.reachable ? "ok" : "bad") : "neutral"} title={n8n.health.url}>
        Orchestrator: {n8n.mode === "n8n" ? (n8n.health.reachable ? "n8n online" : "n8n offline") : "direct"}
      </Badge>
    </div>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  return (
    <div className="min-h-screen md:grid md:grid-cols-[232px_1fr]">
      <aside className={cx("border-line bg-panel md:sticky md:top-0 md:flex md:h-screen md:flex-col md:border-r", open ? "flex flex-col border-b" : "hidden md:flex")}>
        <div className="hidden px-5 pb-4 pt-6 md:block">
          <div className="text-sm font-semibold tracking-tight">AI Creative Studio</div>
          <div className="text-xs text-muted">Local · human-reviewed</div>
        </div>
        <nav aria-label="Main" className="flex flex-col gap-0.5 px-3 py-2">
          {NAV.map((n) => {
            const active = n.href === "/" ? path === "/" : path.startsWith(n.href);
            return (
              <Link key={n.href} href={n.href} onClick={() => setOpen(false)} aria-current={active ? "page" : undefined}
                className={cx("rounded-lg px-3 py-2 text-sm", active ? "bg-accent-soft font-medium text-accent" : "text-muted hover:bg-panel-2 hover:text-text")}>
                {n.label}
              </Link>
            );
          })}
        </nav>
        <div className="mt-auto flex flex-col gap-3 px-5 py-5">
          <ModeStrip />
          <ThemeToggle />
        </div>
      </aside>
      <div className="min-w-0">
        <div className="flex items-center justify-between border-b border-line bg-panel px-4 py-3 md:hidden">
          <span className="text-sm font-semibold">AI Creative Studio</span>
          <button className="rounded-md border border-line px-2 py-1 text-sm" aria-expanded={open} onClick={() => setOpen(!open)}>Menu</button>
        </div>
        <main className="mx-auto max-w-6xl px-4 py-6 md:px-8 md:py-8">{children}</main>
      </div>
    </div>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <div className="mt-1 text-sm text-muted">{subtitle}</div>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}
