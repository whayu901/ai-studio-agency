"use client";
import { createContext, useContext, useState, type ReactNode } from "react";
import { api } from "@/lib/client";
import { Badge, Button, Card, ConfirmDialog, CopyButton, DownloadButton, Notice, inputCls } from "../ui";

export interface JobCtxValue {
  d: any;
  reload: () => Promise<void>;
  act: (label: string, fn: () => Promise<unknown>) => Promise<unknown>;
  busy: string | null;
  flash: { tone: "ok" | "bad" | "warn" | "info"; text: string } | null;
}
export const JobCtx = createContext<JobCtxValue | null>(null);
export const useJob = () => useContext(JobCtx)!;

export function JobProvider({ d, reload, children }: { d: any; reload: () => Promise<void>; children: ReactNode }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [flash, setFlash] = useState<JobCtxValue["flash"]>(null);
  const act = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(label);
    setFlash(null);
    try {
      const r: any = await fn();
      const msg = r?.message ?? r?.results?.map((x: any) => `${x.stage}: ${x.status}${x.gate ? ` (${x.gate})` : ""}`).join(" · ");
      setFlash({ tone: r?.status === "halted" ? "info" : "ok", text: msg ? `${label}: ${msg}` : `${label}: done` });
      await reload();
      return r;
    } catch (e) {
      setFlash({ tone: "bad", text: `${label}: ${e instanceof Error ? e.message : String(e)}` });
      await reload();
      return null;
    } finally {
      setBusy(null);
    }
  };
  return <JobCtx.Provider value={{ d, reload, act, busy, flash }}>{children}</JobCtx.Provider>;
}

/** Approve a gate with an explicit reviewer name + typed job id. */
export function ApproveButton({ gate, label }: { gate: "brief" | "script" | "storyboard"; label: string }) {
  const { d, act, busy } = useJob();
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <>
      <Button variant="primary" onClick={() => { setErr(null); setOpen(true); }}>{label}</Button>
      <ConfirmDialog open={open} jobId={d.job.id} title={label} busy={busy === label} error={err}
        description={<>Approving records your name, the time and a checksum of what you approved. Generated content is never approved automatically.</>}
        onCancel={() => setOpen(false)}
        onConfirm={async (v) => {
          try {
            await api(`/api/jobs/${d.job.id}/approve/${gate}`, { body: v });
            setOpen(false);
            await act(label, async () => ({ message: "approved" }));
          } catch (e) {
            setErr(e instanceof Error ? e.message : String(e));
          }
        }} />
    </>
  );
}

export function StageButton({ stage, label, force, variant = "secondary" }: { stage: string; label: string; force?: boolean; variant?: "primary" | "secondary" }) {
  const { d, act, busy } = useJob();
  return (
    <Button variant={variant} busy={busy === label} onClick={() => act(label, () => api(`/api/jobs/${d.job.id}/stages/${stage}`, { body: { force: !!force } }))}>
      {label}
    </Button>
  );
}

/** Manual Claude mode: export the filled prompt for a stage, then paste Claude's JSON back. */
export function ManualExchange({ stage, title }: { stage: string; title: string }) {
  const { d, act, busy } = useJob();
  const [exp, setExp] = useState<any>(null);
  const [text, setText] = useState("");
  const [err, setErr] = useState<string | null>(null);
  return (
    <Card title={title} subtitle="Manual Claude mode: run this prompt yourself in claude.ai or Claude Code, then paste the JSON answer here. It is validated before anything changes.">
      <div className="flex flex-wrap gap-2">
        <Button busy={busy === `export ${stage}`} onClick={async () => {
          setErr(null);
          try { setExp(await api(`/api/jobs/${d.job.id}/export/${stage}`)); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
        }}>Export prompt</Button>
        {exp && <><CopyButton text={exp.text} label="Copy prompt" /><DownloadButton text={exp.text} filename={`${d.job.id}-${stage}-prompt.md`} /></>}
        {exp?.templates?.map((t: any) => <Badge key={t.id}>{t.id}@{t.version}</Badge>)}
      </div>
      {err && <div className="mt-2"><Notice tone="bad">{err}</Notice></div>}
      {exp && (
        <>
          {exp.attach_in_order?.length > 0 && <Notice tone="info" title={`Attach these ${exp.attach_in_order.length} frames, in this order`}><code className="text-xs">{exp.attach_in_order.join("\n")}</code></Notice>}
          <textarea readOnly className={`${inputCls} mt-3 font-mono text-xs`} rows={10} value={exp.text} aria-label="Exported prompt" />
        </>
      )}
      <div className="mt-4 flex flex-col gap-2">
        <label className="text-sm font-medium" htmlFor={`imp-${stage}`}>Paste Claude's JSON answer</label>
        <textarea id={`imp-${stage}`} className={`${inputCls} font-mono text-xs`} rows={6} value={text} onChange={(e) => setText(e.target.value)} placeholder='```json { … } ```' />
        <div><Button variant="primary" disabled={text.trim().length < 2} busy={busy === `import ${stage}`} onClick={async () => {
          const r = await act(`import ${stage}`, () => api(`/api/jobs/${d.job.id}/import/${stage}`, { body: { text } }));
          if (r) setText("");
        }}>Import and validate</Button></div>
      </div>
    </Card>
  );
}

export function Provenance({ stage }: { stage: string }) {
  const { d } = useJob();
  const s = d.stages?.[stage];
  if (!s) return null;
  const label = { mock: "Mock (templates, no AI)", manual: "Imported from manual Claude", anthropic: "Anthropic API", human: "Written by a person", deterministic: "Deterministic intake" }[s.mode as string] ?? s.mode;
  return (
    <span className="flex flex-wrap items-center gap-1 text-xs text-muted">
      <Badge tone={s.mode === "mock" ? "neutral" : s.mode === "human" ? "ok" : s.mode === "anthropic" ? "accent" : "info"}>{label}</Badge>
      {s.versions && Object.entries(s.versions).map(([k, v]) => <Badge key={k}>{k}@{String(v)}</Badge>)}
      {s.execution_id && <Badge tone="info">n8n exec {s.execution_id}</Badge>}
    </span>
  );
}
