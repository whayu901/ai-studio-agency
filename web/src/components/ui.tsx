"use client";
/** Small accessible UI kit used across the dashboard. */
import { useEffect, useId, useRef, useState, type ReactNode } from "react";

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

type Tone = "neutral" | "accent" | "ok" | "warn" | "bad" | "info";
const TONES: Record<Tone, string> = {
  neutral: "bg-panel-2 text-muted border-line",
  accent: "bg-accent-soft text-accent border-transparent",
  ok: "bg-ok-soft text-ok border-transparent",
  warn: "bg-warn-soft text-warn border-transparent",
  bad: "bg-bad-soft text-bad border-transparent",
  info: "bg-info-soft text-info border-transparent",
};

export function Badge({ tone = "neutral", children, title }: { tone?: Tone; children: ReactNode; title?: string }) {
  return (
    <span title={title} className={cx("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap", TONES[tone])}>
      {children}
    </span>
  );
}

export function stateTone(state: string): Tone {
  if (state === "FAILED") return "bad";
  if (state === "DELIVERED" || state === "QC_APPROVED") return "ok";
  if (["BRIEF_READY", "SCRIPT_READY", "STORYBOARD_READY", "QC_PENDING", "REVISION_REQUIRED"].includes(state)) return "warn";
  if (state === "AWAITING_RENDER" || state === "RENDER_UPLOADED") return "info";
  if (state === "DRAFT") return "neutral";
  return "accent";
}

export function StateBadge({ state, label }: { state: string; label?: string }) {
  return <Badge tone={stateTone(state)}>{label ?? state.replaceAll("_", " ").toLowerCase()}</Badge>;
}

export function ModeBadge({ mode }: { mode: string }) {
  const m: Record<string, [Tone, string]> = {
    mock: ["neutral", "Mock · templates, no AI"],
    manual: ["info", "Manual Claude"],
    anthropic: ["accent", "Anthropic API"],
    human: ["ok", "Written by a person"],
    deterministic: ["neutral", "Deterministic"],
  };
  const [tone, label] = m[mode] ?? ["neutral", mode];
  return <Badge tone={tone}>{label}</Badge>;
}

export function Button({
  children, onClick, variant = "secondary", disabled, busy, type = "button", title, size = "md",
}: { children: ReactNode; onClick?: () => void; variant?: "primary" | "secondary" | "ghost" | "danger"; disabled?: boolean; busy?: boolean; type?: "button" | "submit"; title?: string; size?: "sm" | "md" }) {
  const v = {
    primary: "bg-accent text-white hover:opacity-90 border-transparent",
    secondary: "bg-panel text-text border-line hover:bg-panel-2",
    ghost: "bg-transparent text-muted border-transparent hover:text-text hover:bg-panel-2",
    danger: "bg-bad-soft text-bad border-transparent hover:opacity-90",
  }[variant];
  return (
    <button
      type={type}
      title={title}
      onClick={onClick}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      className={cx("inline-flex items-center justify-center gap-2 rounded-lg border font-medium transition disabled:cursor-not-allowed disabled:opacity-50", size === "sm" ? "px-2.5 py-1 text-xs" : "px-3.5 py-2 text-sm", v)}
    >
      {busy && <Spinner />}
      {children}
    </button>
  );
}

export function Spinner() {
  return <span aria-hidden className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />;
}

export function Card({ title, actions, children, className, subtitle }: { title?: ReactNode; subtitle?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cx("rounded-2xl border border-line bg-panel p-5", className)}>
      {(title || actions) && (
        <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            {title && <h2 className="text-base font-semibold">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-sm text-muted">{subtitle}</p>}
          </div>
          {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

export function Stat({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: string; tone?: Tone }) {
  return (
    <div className="rounded-2xl border border-line bg-panel p-4">
      <div className="text-xs font-medium uppercase tracking-wide text-muted">{label}</div>
      <div className={cx("mt-1 text-2xl font-semibold", tone === "bad" && "text-bad", tone === "warn" && "text-warn", tone === "ok" && "text-ok")}>{value}</div>
      {hint && <div className="mt-1 text-xs text-muted">{hint}</div>}
    </div>
  );
}

export function Field({ label, hint, error, children, required }: { label: string; hint?: string; error?: string; children: (id: string) => ReactNode; required?: boolean }) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium">
        {label} {required && <span className="text-bad" aria-hidden>*</span>}
      </label>
      {children(id)}
      {hint && !error && <p className="text-xs text-muted">{hint}</p>}
      {error && <p className="text-xs text-bad" role="alert">{error}</p>}
    </div>
  );
}

export const inputCls = "w-full rounded-lg border border-line bg-panel px-3 py-2 text-sm text-text placeholder:text-muted/70 disabled:opacity-60";

export function Notice({ tone = "info", title, children }: { tone?: Tone; title?: string; children?: ReactNode }) {
  return (
    <div className={cx("rounded-xl border px-4 py-3 text-sm", TONES[tone])} role={tone === "bad" ? "alert" : "status"}>
      {title && <div className="font-semibold">{title}</div>}
      {children && <div className={cx(title && "mt-1", "text-text/90")}>{children}</div>}
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-line px-6 py-10 text-center">
      <div className="font-medium">{title}</div>
      {children && <div className="mt-2 text-sm text-muted">{children}</div>}
    </div>
  );
}

export function Loading({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 py-10 text-sm text-muted" role="status">
      <Spinner /> {label}
    </div>
  );
}

export function ErrorBox({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const msg = error instanceof Error ? error.message : String(error);
  return (
    <Notice tone="bad" title="Something went wrong">
      <p className="break-words">{msg}</p>
      {onRetry && (
        <div className="mt-2">
          <Button size="sm" onClick={onRetry}>
            Try again
          </Button>
        </div>
      )}
    </Notice>
  );
}

export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <Button
      size="sm"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        } catch {
          /* clipboard blocked */
        }
      }}
    >
      {done ? "Copied" : label}
    </Button>
  );
}

export function DownloadButton({ text, filename, label = "Download" }: { text: string; filename: string; label?: string }) {
  return (
    <Button
      size="sm"
      onClick={() => {
        const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
      }}
    >
      {label}
    </Button>
  );
}

export function Tabs({ tabs, active, onChange }: { tabs: { id: string; label: string; badge?: ReactNode }[]; active: string; onChange: (id: string) => void }) {
  return (
    <div role="tablist" className="flex gap-1 overflow-x-auto border-b border-line">
      {tabs.map((t) => (
        <button
          key={t.id}
          role="tab"
          aria-selected={t.id === active}
          onClick={() => onChange(t.id)}
          className={cx("-mb-px flex items-center gap-2 whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium", t.id === active ? "border-accent text-text" : "border-transparent text-muted hover:text-text")}
        >
          {t.label}
          {t.badge}
        </button>
      ))}
    </div>
  );
}

/**
 * Approval dialog: the reviewer types their name and the job id. Used for every human gate
 * (brief, script, storyboard, QC) so approvals are always explicit.
 */
export function ConfirmDialog({
  open, title, jobId, description, confirmLabel = "Approve", onCancel, onConfirm, busy, error, danger,
}: {
  open: boolean; title: string; jobId: string; description?: ReactNode; confirmLabel?: string; onCancel: () => void;
  onConfirm: (v: { reviewer: string; confirm_job_id: string; notes: string }) => void; busy?: boolean; error?: string | null; danger?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [reviewer, setReviewer] = useState("");
  const [typed, setTyped] = useState("");
  const [notes, setNotes] = useState("");
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      try {
        setReviewer(localStorage.getItem("acs.reviewer") ?? "");
      } catch {
        /* ignore */
      }
      setTyped("");
      setNotes("");
      d.showModal();
    }
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} onCancel={onCancel} className="m-auto w-[min(520px,calc(100vw-2rem))] rounded-2xl border border-line bg-panel p-0 text-text backdrop:bg-black/40">
      <form
        method="dialog"
        className="flex flex-col gap-4 p-6"
        onSubmit={(e) => {
          e.preventDefault();
          try {
            localStorage.setItem("acs.reviewer", reviewer);
          } catch {
            /* ignore */
          }
          onConfirm({ reviewer, confirm_job_id: typed, notes });
        }}
      >
        <h2 className="text-lg font-semibold">{title}</h2>
        {description && <div className="text-sm text-muted">{description}</div>}
        <Field label="Your name (reviewer)" required>
          {(id) => <input id={id} className={inputCls} value={reviewer} onChange={(e) => setReviewer(e.target.value)} required autoComplete="name" />}
        </Field>
        <Field label={`Type the job id to confirm: ${jobId}`} required>
          {(id) => <input id={id} className={cx(inputCls, "font-mono")} value={typed} onChange={(e) => setTyped(e.target.value)} required autoComplete="off" />}
        </Field>
        <Field label="Notes (optional)">
          {(id) => <textarea id={id} className={inputCls} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />}
        </Field>
        {error && <Notice tone="bad">{error}</Notice>}
        <div className="flex justify-end gap-2">
          <Button onClick={onCancel}>Cancel</Button>
          <Button type="submit" variant={danger ? "danger" : "primary"} busy={busy} disabled={!reviewer.trim() || typed.trim() !== jobId}>
            {confirmLabel}
          </Button>
        </div>
      </form>
    </dialog>
  );
}

export function KV({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-[max-content_1fr]">
      {items.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-muted">{k}</dt>
          <dd className="min-w-0 break-words">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Issues({ errors = [], warnings = [] }: { errors?: string[]; warnings?: string[] }) {
  if (!errors.length && !warnings.length) return <Badge tone="ok">Validator: no issues</Badge>;
  return (
    <div className="flex flex-col gap-2">
      {errors.length > 0 && (
        <Notice tone="bad" title={`${errors.length} error(s)`}>
          <ul className="list-disc pl-5">{errors.map((e) => <li key={e}>{e}</li>)}</ul>
        </Notice>
      )}
      {warnings.length > 0 && (
        <Notice tone="warn" title={`${warnings.length} warning(s)`}>
          <ul className="list-disc pl-5">{warnings.map((w) => <li key={w}>{w}</li>)}</ul>
        </Notice>
      )}
    </div>
  );
}
