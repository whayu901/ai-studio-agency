"use client";
/** Overview, Brief, Script and Storyboard tabs. */
import { useEffect, useMemo, useState } from "react";
import { api, fmtDate } from "@/lib/client";
import { Badge, Button, Card, ConfirmDialog, Issues, KV, Notice, StateBadge, cx, inputCls } from "../ui";
import { ApproveButton, ManualExchange, Provenance, StageButton, useJob } from "./common";

const STEPS = ["DRAFT", "BRIEF_READY", "BRIEF_APPROVED", "SCRIPT_READY", "SCRIPT_APPROVED", "STORYBOARD_READY", "STORYBOARD_APPROVED", "PROMPTS_READY", "AWAITING_RENDER", "RENDER_UPLOADED", "QC_PENDING", "QC_APPROVED", "DELIVERED"];

export function Stepper({ state }: { state: string }) {
  const idx = STEPS.indexOf(state);
  return (
    <ol className="flex flex-wrap gap-1" aria-label="Job progress">
      {STEPS.map((s, i) => (
        <li key={s} title={s} className={cx("h-1.5 w-8 rounded-full sm:w-10", i < idx ? "bg-ok" : i === idx ? "bg-accent" : "bg-line", state === "FAILED" && "bg-bad/60", state === "REVISION_REQUIRED" && i >= 10 && "bg-warn")} />
      ))}
    </ol>
  );
}

const NEXT: Record<string, { text: string; tab: string }> = {
  DRAFT: { text: "Validate the brief to start.", tab: "brief" },
  BRIEF_READY: { text: "Review and approve the brief.", tab: "brief" },
  BRIEF_APPROVED: { text: "Pick a concept, then generate or write the script.", tab: "script" },
  SCRIPT_READY: { text: "Review and approve the script.", tab: "script" },
  SCRIPT_APPROVED: { text: "Generate or write the storyboard.", tab: "storyboard" },
  STORYBOARD_READY: { text: "Review and approve the storyboard.", tab: "storyboard" },
  STORYBOARD_APPROVED: { text: "Compile the provider prompts.", tab: "prompts" },
  PROMPTS_READY: { text: "Check the prompts and mark the job ready for manual rendering.", tab: "prompts" },
  AWAITING_RENDER: { text: "Render each clip by hand in the provider's web UI, then upload the MP4s.", tab: "render" },
  RENDER_UPLOADED: { text: "Upload a take for every clip; each is checked automatically.", tab: "render" },
  QC_PENDING: { text: "Watch every take with sound and record the quality review.", tab: "render" },
  REVISION_REQUIRED: { text: "Reopen the stage that needs changing.", tab: "overview" },
  QC_APPROVED: { text: "Build the delivery package.", tab: "delivery" },
  DELIVERED: { text: "Package ready. Post by hand; nothing was published.", tab: "delivery" },
  FAILED: { text: "Check the error in History and retry.", tab: "history" },
};

export function OverviewTab({ go }: { go: (tab: string) => void }) {
  const { d, act, busy } = useJob();
  const j = d.job;
  const n = NEXT[j.state];
  const [reopenTo, setReopenTo] = useState("SCRIPT_READY");
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <Card title="Next step" className="lg:col-span-2" actions={<StateBadge state={j.state} label={j.state_label} />}>
        <p className="text-sm">{n?.text}</p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button variant="primary" onClick={() => go(n?.tab ?? "overview")}>Open {n?.tab ?? "overview"}</Button>
          {!["FAILED", "DELIVERED", "AWAITING_RENDER", "RENDER_UPLOADED", "QC_PENDING", "QC_APPROVED"].includes(j.state) && (
            <Button busy={busy === "Send through orchestrator"} onClick={() => act("Send through orchestrator", () => api(`/api/jobs/${j.id}/run`, { body: { event: "job.submitted" } }))}
              title="Runs every stage that does not need a person, and stops at the next approval">
              Run automatic stages ({d.runs.length ? "again" : "n8n / direct"})
            </Button>
          )}
          {j.state === "FAILED" && <Button variant="primary" busy={busy === "Retry"} onClick={() => act("Retry", () => api(`/api/jobs/${j.id}/retry`, { body: {} }))}>Retry ({j.retry_count} used)</Button>}
        </div>
        {(j.state === "REVISION_REQUIRED" || ["BRIEF_APPROVED", "SCRIPT_READY", "SCRIPT_APPROVED", "STORYBOARD_READY", "STORYBOARD_APPROVED", "PROMPTS_READY", "AWAITING_RENDER"].includes(j.state)) && (
          <div className="mt-5 flex flex-wrap items-end gap-2 border-t border-line pt-4">
            <label className="flex flex-col gap-1 text-sm font-medium">Reopen a stage for changes
              <select className={inputCls} value={reopenTo} onChange={(e) => setReopenTo(e.target.value)}>
                {["BRIEF_READY", "SCRIPT_READY", "STORYBOARD_READY", "PROMPTS_READY", ...(j.state === "REVISION_REQUIRED" ? ["AWAITING_RENDER"] : [])].map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>
            <Button onClick={() => { setErr(null); setOpen(true); }}>Reopen…</Button>
            <ConfirmDialog open={open} jobId={j.id} title={`Reopen ${reopenTo}`} confirmLabel="Reopen" error={err} busy={busy === "Reopen"}
              description="Later stages must be reviewed and approved again." onCancel={() => setOpen(false)}
              onConfirm={async (v) => {
                try {
                  await api(`/api/jobs/${j.id}/reopen`, { body: { to: reopenTo, reviewer: v.reviewer, reason: v.notes } });
                  setOpen(false);
                  await act("Reopen", async () => ({ message: `reopened ${reopenTo}` }));
                } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
              }} />
          </div>
        )}
      </Card>
      <Card title="Job">
        <KV items={[
          ["Campaign", d.campaign.name],
          ["Character", <code key="c">{j.character_id}</code>],
          ["Mode", `${j.creation_mode === "reference_guided" ? "Reference Guided" : "Original Creation"} · ${j.performance_mode.replaceAll("_", " ")}`],
          ["Provider", j.video_provider === "seedance" ? "Seedance / Dreamina (manual)" : "Google Flow (manual)"],
          ["AI mode", <AiModeSwitch key="a" />],
          ["Duration", `${d.production.duration_seconds}s · ${d.production.aspect_ratio}`],
          ["Test job", j.is_test ? "yes — never for commercial delivery" : "no"],
          ["Created", fmtDate(j.created_at)],
          ["Updated", fmtDate(j.updated_at)],
        ]} />
      </Card>
      <div className="lg:col-span-3"><Issues errors={d.validation.errors} warnings={d.validation.warnings} /></div>
    </div>
  );
}

function AiModeSwitch() {
  const { d, act } = useJob();
  return (
    <select aria-label="AI execution mode" className="rounded-md border border-line bg-panel px-2 py-1 text-xs" value={d.job.ai_mode}
      onChange={(e) => act("AI mode", () => api(`/api/jobs/${d.job.id}/settings`, { method: "PUT", body: { ai_mode: e.target.value } }))}>
      <option value="mock">mock (templates)</option><option value="manual">manual Claude</option><option value="anthropic">Anthropic API</option>
    </select>
  );
}

// ----------------------------------------------------------------------------- brief

export function BriefTab() {
  const { d, act, busy } = useJob();
  const [text, setText] = useState(() => JSON.stringify(d.brief, null, 2));
  const [parseErr, setParseErr] = useState<string | null>(null);
  useEffect(() => setText(JSON.stringify(d.brief, null, 2)), [d.brief]);
  const editable = ["DRAFT", "BRIEF_READY"].includes(d.job.state);
  const b = d.brief;
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card title="Brief" subtitle="This job's own snapshot of the campaign brief." actions={<><Provenance stage="brief" />
        {d.job.state === "DRAFT" && <StageButton stage="brief" label="Validate brief" variant="primary" />}
        {d.job.state === "BRIEF_READY" && <ApproveButton gate="brief" label="Approve brief" />}</>}>
        <KV items={[
          ["Product", `${b.brand.name} — ${b.product.name}`],
          ["Category", b.product.category],
          ["Audience", b.target_audience.description],
          ["Language", b.script.language],
          ["Verified claims", <ul key="v" className="list-disc pl-4">{b.verified_claims.map((c: any) => <li key={c.claim}>{c.claim} <span className="text-xs text-muted">({c.source})</span></li>)}</ul>],
          ["Prohibited", (b.prohibited_claims ?? []).join(" · ") || "—"],
          ["Script", b.script.mode === "custom" ? `custom${b.script.exact_script === false ? " (trimming allowed)" : " — exact-script mode"}` : "drafted by the pipeline"],
          ["Deliverable", `${b.deliverable.duration_seconds}s · ${b.deliverable.aspect_ratio} · ${b.deliverable.visual_style}`],
        ]} />
        {b.is_sample && <div className="mt-4"><Notice tone="warn">Sample / test data: never approved for commercial delivery.</Notice></div>}
      </Card>
      <Card title="Edit brief (JSON)" subtitle={editable ? "Saved revisions are validated against schemas/product-brief.schema.json." : "Locked after approval — reopen BRIEF_READY to edit."}>
        <textarea aria-label="Brief JSON" className={`${inputCls} font-mono text-xs`} rows={22} value={text} readOnly={!editable} onChange={(e) => setText(e.target.value)} />
        {parseErr && <p className="mt-1 text-xs text-bad">{parseErr}</p>}
        {editable && (
          <div className="mt-3"><Button variant="primary" busy={busy === "Save brief"} onClick={() => {
            let brief;
            try { brief = JSON.parse(text); setParseErr(null); } catch { setParseErr("Not valid JSON"); return; }
            act("Save brief", () => api(`/api/jobs/${d.job.id}/brief`, { method: "PUT", body: { brief } }));
          }}>Save revision</Button></div>
        )}
        <h3 className="mt-5 text-sm font-semibold">Revisions</h3>
        <ul className="mt-2 flex flex-col gap-1 text-xs">
          {d.brief_revisions.map((r: any) => <li key={r.id} className="flex gap-2"><Badge>r{r.revision}</Badge><span>{r.source}</span><span className="text-muted">{r.author} · {fmtDate(r.created_at)}</span>{!r.valid && <Badge tone="bad">invalid</Badge>}</li>)}
        </ul>
      </Card>
    </div>
  );
}

// ----------------------------------------------------------------------------- script

export function ScriptTab() {
  const { d, act, busy } = useJob();
  const p = d.production;
  const b = d.brief;
  const st = d.job.state;
  const exact = b.script.mode === "custom" && b.script.exact_script !== false;
  const [script, setScript] = useState(p.script);
  const [claims, setClaims] = useState<string[]>(p.claims_used ?? []);
  useEffect(() => { setScript(p.script); setClaims(p.claims_used ?? []); }, [p.script, p.claims_used]);
  const editable = ["BRIEF_APPROVED", "SCRIPT_READY"].includes(st);
  const concepts = d.concepts?.concepts ?? [];
  const speech = d.script_notes?.speech;
  const manual = d.job.ai_mode === "manual";
  const fashion = d.job.performance_mode === "fashion_showcase";
  return (
    <div className="flex flex-col gap-6">
      <Card title="Concept" subtitle="A person picks the concept before the script is written." actions={<Provenance stage="concepts" />}>
        {p.concept?.title ? (
          <KV items={[["Chosen", p.concept.title], ["Angle", p.concept.angle], ["Hook", p.concept.hook], ["Key message", p.concept.key_message]]} />
        ) : concepts.length === 0 ? (
          <div className="flex flex-wrap gap-2">
            {st === "BRIEF_APPROVED" ? <StageButton stage="concepts" label="Generate concepts" variant="primary" /> : <p className="text-sm text-muted">Available after the brief is approved.</p>}
          </div>
        ) : null}
        {concepts.length > 0 && editable && (
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            {concepts.map((c: any, i: number) => {
              const cid = c.concept_id ?? `K${String(i + 1).padStart(2, "0")}`;
              const chosen = p.concept?.title === c.title;
              return (
                <div key={cid} className={cx("flex flex-col rounded-xl border p-4", chosen ? "border-accent bg-accent-soft" : "border-line")}>
                  <div className="flex items-center justify-between gap-2"><span className="font-medium">{c.title}</span><Badge>{cid}</Badge></div>
                  <p className="mt-2 text-sm text-muted">{c.angle}</p>
                  <p className="mt-2 text-xs"><span className="font-medium">Hook:</span> {c.hook}</p>
                  <div className="mt-auto pt-3">
                    <Button size="sm" variant={chosen ? "primary" : "secondary"} busy={busy === `Pick ${cid}`} onClick={() => act(`Pick ${cid}`, () => api(`/api/jobs/${d.job.id}/concept`, { body: { concept_id: cid } }))}>{chosen ? "Chosen" : "Choose"}</Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>
      {manual && st === "BRIEF_APPROVED" && concepts.length === 0 && <ManualExchange stage="concepts" title="Concepts — manual Claude" />}

      <Card title="Script" subtitle={fashion ? "Fashion showcase: no dialogue is generated." : exact ? "Exact-script mode: the user's script is used word for word and cannot be edited here." : "Edit freely; claims must come from the brief."}
        actions={<><Provenance stage="script" />
          {st === "BRIEF_APPROVED" && p.concept?.title && !manual && <StageButton stage="script" label="Generate script" variant="primary" />}
          {st === "SCRIPT_READY" && !exact && !manual && <StageButton stage="script" label="Regenerate" force />}
          {st === "SCRIPT_READY" && <ApproveButton gate="script" label="Approve script" />}</>}>
        <textarea aria-label="Script" className={`${inputCls} text-base leading-relaxed`} rows={6} value={script} readOnly={!editable || exact || fashion} onChange={(e) => setScript(e.target.value)} placeholder={fashion ? "(no dialogue)" : "Script…"} />
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
          <Badge>{b.script.language}</Badge>
          {speech && !fashion && <Badge tone={speech.fits ? "ok" : "warn"}>{speech.words} words ≈ {speech.seconds}s at {speech.rate} w/s · budget {speech.budget_seconds}s</Badge>}
          {exact && <Badge tone="info">exact script</Badge>}
          {d.job.performance_mode === "voiceover_showcase" && <Badge tone="info">narration (recorded separately)</Badge>}
        </div>
        {speech?.lines?.length > 0 && !fashion && (
          <table className="mt-3 w-full text-sm"><thead className="text-left text-xs text-muted"><tr><th>Line</th><th className="w-20">Words</th><th className="w-20">≈ sec</th></tr></thead>
            <tbody>{speech.lines.map((l: any, i: number) => <tr key={i} className="border-t border-line"><td className="py-1">{l.text}</td><td>{l.words}</td><td>{l.seconds}</td></tr>)}</tbody></table>
        )}
        <h3 className="mt-4 text-sm font-semibold">Claims used (only verified claims)</h3>
        <div className="mt-2 flex flex-col gap-1">
          {b.verified_claims.map((c: any) => (
            <label key={c.claim} className="flex items-center gap-2 text-sm">
              <input type="checkbox" disabled={!editable} checked={claims.includes(c.claim)} onChange={(e) => setClaims(e.target.checked ? [...claims, c.claim] : claims.filter((x) => x !== c.claim))} /> {c.claim}
            </label>
          ))}
        </div>
        {(d.script_notes?.notes ?? []).length > 0 && <div className="mt-3"><Notice tone="info">{d.script_notes.notes.join(" ")}</Notice></div>}
        {editable && p.concept?.title && !exact && !fashion && (
          <div className="mt-4"><Button busy={busy === "Save script"} onClick={() => act("Save script", () => api(`/api/jobs/${d.job.id}/script`, { method: "PUT", body: { script, claims_used: claims } }))}>Save script</Button></div>
        )}
      </Card>
      {manual && editable && p.concept?.title && !exact && !fashion && <ManualExchange stage="script" title="Script — manual Claude" />}
    </div>
  );
}

// ----------------------------------------------------------------------------- storyboard

const SHOT_FIELDS: [string, string][] = [["action", "Action"], ["dialogue", "Dialogue / VO"], ["framing", "Framing"], ["camera_movement", "Camera"], ["facial_expression", "Expression"], ["on_screen_text", "On-screen text"], ["product_visibility", "Product visibility"], ["setting", "Setting"]];

export function StoryboardTab() {
  const { d, act, busy } = useJob();
  const st = d.job.state;
  const [shots, setShots] = useState<any[]>(d.production.storyboard);
  useEffect(() => setShots(d.production.storyboard), [d.production.storyboard]);
  const editable = ["SCRIPT_APPROVED", "STORYBOARD_READY"].includes(st);
  const clips = useMemo(() => [...new Set(shots.map((s) => s.clip_id))], [shots]);
  const manual = d.job.ai_mode === "manual";
  const fashion = d.job.performance_mode === "fashion_showcase";
  const upd = (i: number, k: string, v: any) => setShots(shots.map((s, j) => (j === i ? { ...s, [k]: v } : s)));
  return (
    <div className="flex flex-col gap-6">
      <Card title="Storyboard" subtitle={`${shots.length} shot(s) in ${clips.length} clip(s). A clip is one manual generation; cuts happen only between clips.`}
        actions={<><Provenance stage="storyboard" />
          {st === "SCRIPT_APPROVED" && !manual && <StageButton stage="storyboard" label="Generate storyboard" variant="primary" />}
          {st === "STORYBOARD_READY" && !manual && <StageButton stage="storyboard" label="Regenerate" force />}
          {st === "STORYBOARD_READY" && <ApproveButton gate="storyboard" label="Approve storyboard" />}</>}>
        {shots.length === 0 ? <p className="text-sm text-muted">No shots yet{st === "SCRIPT_APPROVED" ? "." : " — available after the script is approved."}</p> : (
          <div className="flex flex-col gap-5">
            {clips.map((c) => (
              <div key={c}>
                <h3 className="mb-2 text-sm font-semibold">Clip {c}</h3>
                <div className="grid gap-3 md:grid-cols-2">
                  {shots.map((s, i) => s.clip_id !== c ? null : (
                    <div key={s.shot_id} className="rounded-xl border border-line p-3">
                      <div className="mb-2 flex flex-wrap items-center gap-2">
                        <Badge tone="accent">{s.shot_id}</Badge><Badge>{s.purpose}</Badge>
                        <span className="text-xs text-muted">{s.start_seconds}–{s.end_seconds}s</span>
                      </div>
                      <div className="flex flex-col gap-2">
                        {SHOT_FIELDS.map(([k, label]) => (k === "dialogue" && fashion) ? null : (
                          <label key={k} className="text-xs text-muted">{label}
                            <textarea rows={k === "action" ? 2 : 1} className={`${inputCls} mt-0.5 text-sm`} readOnly={!editable} value={s[k] ?? ""} onChange={(e) => upd(i, k, e.target.value === "" && (k === "dialogue" || k === "on_screen_text") ? null : e.target.value)} />
                          </label>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
        {editable && shots.length > 0 && <div className="mt-4"><Button busy={busy === "Save storyboard"} onClick={() => act("Save storyboard", () => api(`/api/jobs/${d.job.id}/storyboard`, { method: "PUT", body: { storyboard: shots } }))}>Save storyboard</Button></div>}
      </Card>
      {manual && editable && <ManualExchange stage="storyboard" title="Storyboard — manual Claude" />}
      {d.analysis && (
        <Card title="Reference analysis" subtitle="From sampled frames only: audio, exact dialogue, off-frame action and motion between frames are unknown.">
          <KV items={[["Format", d.analysis.summary.format], ["Pacing", d.analysis.summary.pacing], ["Borrow structure", d.analysis.adaptation_plan.borrow_structure.join("; ")], ["Must not copy", d.analysis.adaptation_plan.must_not_copy.join("; ")], ["Unknown", d.analysis.unknowns.join("; ")]]} />
        </Card>
      )}
    </div>
  );
}
