"use client";
import Link from "next/link";
import { useState } from "react";
import { PageHeader } from "@/components/Shell";
import { Badge, Button, Card, ErrorBox, Issues, KV, Loading, Notice, inputCls } from "@/components/ui";
import { api, fmtDate } from "@/lib/client";
import { useData } from "@/lib/useData";

export default function SettingsPage() {
  const s = useData<any>("/api/settings");
  const diag = useData<any>("/api/diagnostics");
  const imports = useData<any>("/api/imports");
  const [reviewer, setReviewer] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [pack, setPack] = useState<any>(null);
  const [busy, setBusy] = useState<string | null>(null);
  if (s.loading) return <Loading />;
  if (s.error) return <ErrorBox error={s.error} onRetry={s.reload} />;
  const d = s.data;
  const o = d.orchestrator;
  return (
    <>
      <PageHeader title="Settings & operations" subtitle="Configuration comes from environment variables (web/.env.local) and the config/ files. Secrets are shown only as set / not set." />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Execution mode" subtitle="What runs automatically, and what a person does.">
          <KV items={[
            ["Creative stages", <span key="a" className="flex flex-wrap gap-1"><Badge>mock</Badge><Badge tone="info">manual Claude</Badge><Badge tone={d.ai.modes.anthropic.available ? "accent" : "neutral"}>Anthropic API: {d.ai.modes.anthropic.available ? "available" : d.ai.modes.anthropic.reason}</Badge></span>],
            ["API model / budget", `${d.ai.model} · $${d.ai.budget_usd} budget · $${d.ai.spent_usd_estimate} spent (computed from reported usage)`],
            ["Video rendering", "Manual in Google Flow / Dreamina web UIs. No video API is integrated."],
            ["Publishing", "Never. Packages are downloaded and posted by hand."],
          ]} />
        </Card>
        <Card title="n8n orchestrator" actions={<Button size="sm" onClick={() => s.reload()}>Check again</Button>}>
          <KV items={[
            ["Mode", o.mode === "n8n" ? "n8n (jobs go through local workflows)" : "direct (same stages run in-process)"],
            ["URL", o.health.url],
            ["Health", <Badge key="h" tone={o.health.reachable ? "ok" : "bad"}>{o.health.reachable ? "reachable" : `not reachable${o.health.error ? `: ${o.health.error}` : ""}`}</Badge>],
            ["Shared token", o.token_configured ? "set" : "not set — run scripts/setup-local-env.sh"],
          ]} />
          {o.mode === "n8n" && !o.health.reachable && <div className="mt-3"><Notice tone="warn">Start n8n: <code>docker compose -f n8n/docker-compose.yml --env-file n8n/.env up -d</code> (see docs/n8n-integration.md).</Notice></div>}
        </Card>
        <Card title="Video providers" className="lg:col-span-2" subtitle="Capabilities come from config/google-flow.json and config/seedance.json, which you verify in each web UI.">
          {d.providers.map((p: any) => (
            <div key={p.id} className="mb-4">
              <div className="flex flex-wrap items-center gap-2"><span className="font-medium">{p.label}</span><a className="text-xs text-accent underline" href={p.web_ui} target="_blank" rel="noreferrer">{p.web_ui}</a><code className="text-xs text-muted">{p.config_file}</code><Badge tone={p.verified_by_user_on ? "ok" : "warn"}>{p.verified_by_user_on ? `verified ${p.verified_by_user_on}` : "unverified"}</Badge></div>
              <table className="mt-2 w-full text-xs"><thead className="text-left text-muted"><tr><th>Model</th><th>Max clip</th><th>Modes</th><th>Aspect</th><th>Spoken dialogue</th><th>Status</th></tr></thead>
                <tbody>{p.models.map((m: any) => <tr key={m.model_id} className="border-t border-line"><td className="py-1">{m.label}</td><td>{m.max_clip_seconds}s</td><td>{m.generation_modes.join(", ")}</td><td>{m.aspect_ratios.join(", ")}</td><td>{m.supports_spoken_dialogue === null ? "unknown" : String(m.supports_spoken_dialogue)}</td><td><Badge tone={m.verified ? "ok" : "warn"}>{m.verified ? "verified" : "unverified"}</Badge> {!m.enabled && <Badge tone="bad">disabled</Badge>}</td></tr>)}</tbody></table>
            </div>
          ))}
          <Issues errors={[...d.provider_reports.google_flow.errors, ...d.provider_reports.seedance.errors]} warnings={[...d.provider_reports.google_flow.warnings, ...d.provider_reports.seedance.warnings]} />
          <h3 className="mt-4 text-sm font-semibold">API integrations</h3>
          <ul className="mt-1 text-sm">{d.future_api_providers.map((f: any) => <li key={f.id}><Badge>not integrated</Badge> {f.label} — <span className="text-muted">{f.reason}</span></li>)}</ul>
        </Card>
        <Card title="Storage and limits">
          <KV items={[["Repository", <code key="r" className="text-xs">{d.storage.repo_root}</code>], ["Data (database, logs, exports)", <code key="d" className="text-xs">{d.storage.data_dir}</code>], ["Database", <code key="db" className="text-xs">{d.storage.database}</code>],
            ["Upload limits", `${d.limits.max_image_mb} MB images · ${d.limits.max_video_mb} MB videos`], ["Max retries", d.limits.max_retries]]} />
        </Card>
        <Card title="Cost tracking">
          <KV items={[["Flow cost per credit", d.costs.flow_cost_per_credit ? `${d.costs.flow_cost_per_credit} ${d.costs.currency} (estimate)` : "not set (ACS_FLOW_COST_PER_CREDIT)"], ["Note", d.costs.note]]} />
        </Card>
        <Card title="Quality-control criteria" className="lg:col-span-2" subtitle="config/qc.json — weights and minimum scores. Edit the file to change them.">
          <table className="w-full text-xs"><thead className="text-left text-muted"><tr><th>Id</th><th>Category</th><th>Min</th><th>Weight</th><th>Applies to</th></tr></thead>
            <tbody>{d.qc.categories.map((c: any) => <tr key={c.check_id} className="border-t border-line"><td className="py-1 font-mono">{c.check_id}</td><td>{c.label}</td><td>{c.min_pass}</td><td>{c.weight}</td><td>{c.applies_to.map((m: string) => m.split("_")[0]).join(", ")}</td></tr>)}</tbody></table>
        </Card>
        <Card title="Import CLI productions" subtitle="Productions made with the Python tools (outputs/<job>/production.json) that the dashboard does not track yet.">
          {imports.data?.productions?.length ? (
            <>
              <input aria-label="Your name" className={`${inputCls} mb-2`} placeholder="Your name (recorded as importer)" value={reviewer} onChange={(e) => setReviewer(e.target.value)} />
              <ul className="flex flex-col gap-2 text-sm">{imports.data.productions.map((p: any) => (
                <li key={p.job_id} className="flex flex-wrap items-center gap-2"><code>{p.job_id}</code><Badge>{p.status}</Badge><span className="text-xs text-muted">{p.character_id}</span>
                  <Button size="sm" disabled={!reviewer.trim()} busy={busy === p.job_id} onClick={async () => {
                    setBusy(p.job_id); setMsg(null);
                    try { const r = await api("/api/imports", { body: { job_id: p.job_id, reviewer } }); setMsg(`Imported ${r.job.id} at ${r.job.state}`); imports.reload(); } catch (e) { setMsg(e instanceof Error ? e.message : String(e)); } finally { setBusy(null); }
                  }}>Import</Button></li>))}</ul>
            </>
          ) : <p className="text-sm text-muted">Nothing to import.</p>}
          {msg && <div className="mt-2"><Notice tone="info">{msg} {msg.startsWith("Imported") && <Link className="underline" href="/jobs">Open jobs</Link>}</Notice></div>}
        </Card>
        <Card title="Template pack export" subtitle="Prompt templates, schemas, configs and n8n workflow templates for reuse (e.g. a Gumroad product). No briefs, characters, references, renders or credentials.">
          <Button busy={busy === "pack"} onClick={async () => { setBusy("pack"); try { setPack(await api("/api/exports/template-pack", { body: {} })); } catch (e) { setPack({ error: e instanceof Error ? e.message : String(e) }); } finally { setBusy(null); } }}>Build template pack</Button>
          {pack?.file && <p className="mt-2 text-sm">{pack.files.length} files · <a className="text-accent underline" href={`/api/exports/template-pack?file=${pack.file}`}>Download {pack.file}</a></p>}
          {pack?.error && <Notice tone="bad">{pack.error}</Notice>}
        </Card>
        <Card title="Diagnostics" className="lg:col-span-2" actions={<Button size="sm" onClick={() => diag.reload()}>Refresh</Button>}>
          {diag.loading ? <Loading /> : diag.error ? <ErrorBox error={diag.error} /> : (
            <>
              <KV items={[["Node", diag.data.versions.node], ["Python", diag.data.versions.python], ["FFmpeg", diag.data.versions.ffmpeg], ["Docker", diag.data.versions.docker],
                ["Records", Object.entries(diag.data.counts).map(([k, v]) => `${k}: ${v}`).join(" · ")]]} />
              <h3 className="mt-4 text-sm font-semibold">Recent orchestration runs</h3>
              {diag.data.runs.length === 0 ? <p className="text-sm text-muted">None.</p> : <ul className="text-xs">{diag.data.runs.slice(0, 15).map((r: any) => <li key={r.id} className="border-t border-line py-1"><Badge tone={r.status === "failed" ? "bad" : "ok"}>{r.status}</Badge> {r.workflow} · job {r.job_id} · exec <code>{r.execution_id ?? "—"}</code> · {fmtDate(r.updated_at)} {r.last_error && <span className="text-bad">{r.last_error}</span>}</li>)}</ul>}
              <h3 className="mt-4 text-sm font-semibold">Application log (last lines, secrets redacted)</h3>
              <pre className="mt-1 max-h-72 overflow-auto rounded-lg bg-panel-2 p-3 text-[11px] leading-relaxed">{diag.data.log.join("\n") || "(empty)"}</pre>
            </>
          )}
        </Card>
      </div>
    </>
  );
}
