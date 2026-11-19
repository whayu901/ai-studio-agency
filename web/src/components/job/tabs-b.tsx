"use client";
/** Prompt Studio, Render & QC, Delivery and History tabs. */
import { useEffect, useMemo, useRef, useState } from "react";
import { api, fileUrl, fmtDate } from "@/lib/client";
import { Badge, Button, Card, ConfirmDialog, CopyButton, DownloadButton, Issues, KV, Notice, StateBadge, cx, inputCls } from "../ui";
import { ManualExchange, Provenance, StageButton, useJob } from "./common";

// ----------------------------------------------------------------------------- prompt studio

export function PromptsTab() {
  const { d, act, busy } = useJob();
  const st = d.job.state;
  const p = d.production;
  const seed = d.job.video_provider === "seedance";
  const clips: any[] = seed ? p.seedance_prompts ?? [] : p.flow_prompts ?? [];
  const manual = d.job.ai_mode === "manual";
  const images: any[] = d.image_prompts?.prompts ?? [];
  const [sub, setSub] = useState(seed ? "seedance" : "flow");
  return (
    <div className="flex flex-col gap-6">
      <Card title="Prompt Studio" subtitle="Everything below is pasted into the provider's web UI by a person. No provider is called by this app."
        actions={<><Provenance stage="prompts" />
          {st === "STORYBOARD_APPROVED" && !manual && <StageButton stage="prompts" label="Compile prompts" variant="primary" />}
          {st === "PROMPTS_READY" && !manual && <StageButton stage="prompts" label="Recompile" force />}
          {st === "PROMPTS_READY" && <StageButton stage="await_render" label="Mark ready for manual render" variant="primary" />}</>}>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <Badge tone="info">{seed ? "Seedance / Dreamina (manual)" : "Google Flow (manual)"}</Badge>
          {Object.entries(p.prompt_versions ?? {}).map(([k, v]) => <Badge key={k}>{k}@{String(v)}</Badge>)}
          {d.render_sheet && <DownloadButton text={d.render_sheet} filename={`${d.job.id}-render-sheet.md`} label="Download render sheet" />}
        </div>
        <div className="mt-4"><Issues errors={d.readiness.errors} warnings={d.readiness.warnings} /></div>
        <div className="mt-4 flex flex-wrap gap-1" role="tablist">
          {[["flow", "Google Flow"], ["seedance", "Seedance"], ["image", "Image generation"], ["reference", "Reference analysis"], ["manifest", "Asset manifest"]].map(([id, l]) => (
            <button key={id} role="tab" aria-selected={sub === id} onClick={() => setSub(id)} className={cx("rounded-lg px-3 py-1.5 text-sm", sub === id ? "bg-accent-soft font-medium text-accent" : "text-muted hover:bg-panel-2")}>{l}</button>
          ))}
        </div>
      </Card>

      {sub === "flow" && (seed ? <Notice tone="info">This job renders in Seedance. Google Flow prompts are made only for Flow jobs (create a Flow job from the campaign to get them).</Notice> : <ClipPrompts clips={clips} kind="flow" />)}
      {sub === "seedance" && (!seed ? <Notice tone="info">This job renders in Google Flow. Seedance prompts are made only for Seedance jobs (create a Seedance job from the campaign to get them).</Notice> : <ClipPrompts clips={clips} kind="seedance" />)}
      {sub === "image" && (
        <Card title="Image-generation prompts" subtitle={seed ? "Seedance clips start from these first frames: make each still, then upload it here." : "Optional start frames (for Frames to Video)."}>
          {images.length === 0 ? <p className="text-sm text-muted">Compile the prompts first.</p> : images.map((ip) => <FramePrompt key={ip.clip_id} ip={ip} />)}
        </Card>
      )}
      {sub === "reference" && (d.job.creation_mode === "reference_guided" ? <ManualExchange stage="reference_analysis" title="Reference-video analysis prompt" /> : <Notice tone="info">Only Reference Guided jobs have a reference analysis.</Notice>)}
      {sub === "manifest" && (
        <Card title="Input asset manifest" subtitle="Files the person uploads to the provider. Only this job's character images are listed.">
          <table className="w-full text-sm"><thead className="text-left text-xs text-muted"><tr><th>Preview</th><th>Path</th><th>Kind</th><th>Rights</th></tr></thead>
            <tbody>{p.reference_assets.map((a: any) => (
              <tr key={a.path} className="border-t border-line">
                <td className="py-1.5"><Thumb path={a.path} /></td><td className="font-mono text-xs">{a.path}</td><td>{a.kind}</td>
                <td><Badge tone={["unknown", "internal_test_only"].includes(a.rights_basis) ? "warn" : "ok"}>{a.rights_basis}</Badge></td>
              </tr>))}</tbody></table>
          {p.continuity?.length > 0 && (
            <>
              <h3 className="mt-5 text-sm font-semibold">Continuity manifest</h3>
              {p.continuity.map((c: any) => <div key={c.to_clip} className="mt-2 text-sm"><Badge>{c.from_clip} → {c.to_clip}</Badge> <span className="text-muted">{c.end_state}</span><ul className="ml-5 list-disc text-xs">{c.carry_over.map((x: string) => <li key={x}>{x}</li>)}</ul></div>)}
            </>
          )}
          {d.motion_audio && (
            <>
              <h3 className="mt-5 text-sm font-semibold">Natural motion and audio plan</h3>
              <ul className="ml-5 mt-1 list-disc text-sm">{(d.motion_audio.motion ?? []).map((m: string) => <li key={m}>{m}</li>)}</ul>
              {d.motion_audio.audio && <p className="mt-2 text-sm"><Badge>{d.motion_audio.audio.plan}</Badge> {d.motion_audio.audio.notes.join(" ")}</p>}
            </>
          )}
        </Card>
      )}
      {manual && ["STORYBOARD_APPROVED", "PROMPTS_READY"].includes(st) && <ManualExchange stage="prompts" title="Prompt compiler — manual Claude" />}
    </div>
  );
}

function Thumb({ path }: { path: string }) {
  const [ok, setOk] = useState(true);
  if (!/\.(png|jpe?g|webp)$/i.test(path)) return <span className="text-xs text-muted">—</span>;
  return ok ? <img src={fileUrl(path)} alt="" onError={() => setOk(false)} className="h-12 w-12 rounded border border-line object-cover" /> : <Badge tone="warn">missing</Badge>;
}

function ClipPrompts({ clips, kind }: { clips: any[]; kind: "flow" | "seedance" }) {
  const { d, act, busy } = useJob();
  const editable = d.job.state === "PROMPTS_READY";
  if (clips.length === 0) return <Notice tone="info">No prompts yet — compile them after the storyboard is approved.</Notice>;
  return (
    <div className="flex flex-col gap-4">
      {clips.map((c) => <ClipCard key={c.clip_id} c={c} kind={kind} editable={editable} busy={busy} onSave={(prompt) => act(`Save ${c.clip_id}`, () => api(`/api/jobs/${d.job.id}/prompts/${c.clip_id}`, { method: "PUT", body: { prompt } }))} />)}
    </div>
  );
}

function ClipCard({ c, kind, editable, onSave, busy }: { c: any; kind: string; editable: boolean; onSave: (p: string) => void; busy: string | null }) {
  const { d } = useJob();
  const [text, setText] = useState(c.prompt);
  useEffect(() => setText(c.prompt), [c.prompt]);
  const uploads = kind === "flow" ? [c.start_frame, c.end_frame, ...c.ingredients].filter(Boolean) : [c.first_frame, ...c.reference_images].filter(Boolean);
  const full = [text, c.avoid?.length ? `\nAvoid: ${c.avoid.join(", ")}` : ""].join("");
  return (
    <Card title={`${c.clip_id} · ${c.start_seconds}–${c.end_seconds}s (${(c.end_seconds - c.start_seconds).toFixed(2).replace(/\.00$/, "")}s)`} subtitle={`${c.model_id} · ${c.generation_mode.replaceAll("_", " ")} · ${d.production.aspect_ratio}${c.continuity_from ? ` · continues from ${c.continuity_from}` : ""}`}
      actions={<><CopyButton text={text} label="Copy prompt" /><DownloadButton text={full} filename={`${d.job.id}-${c.clip_id}-${kind}.txt`} /></>}>
      <div className="mb-3 flex flex-wrap gap-2">
        {uploads.map((u: string, i: number) => <div key={u} className="flex items-center gap-2 rounded-lg border border-line px-2 py-1 text-xs"><span className="font-semibold">{i + 1}</span><Thumb path={u} /><code className="max-w-56 truncate" title={u}>{u.split("/").pop()}</code></div>)}
      </div>
      <textarea aria-label={`${c.clip_id} prompt`} className={`${inputCls} text-sm leading-relaxed`} rows={7} value={text} readOnly={!editable} onChange={(e) => setText(e.target.value)} />
      {kind === "seedance" && c.motion?.length > 0 && <ul className="ml-5 mt-2 list-disc text-xs text-muted">{c.motion.map((m: string) => <li key={m}>{m}</li>)}</ul>}
      {c.avoid?.length > 0 && <p className="mt-2 text-xs text-muted"><span className="font-medium">Avoid:</span> {c.avoid.join(", ")}</p>}
      {c.dialogue && <p className="mt-1 text-xs"><span className="font-medium">Expected dialogue:</span> “{c.dialogue}”</p>}
      {c.notes && <p className="mt-1 text-xs text-muted">{c.notes}</p>}
      {editable && text !== c.prompt && <div className="mt-3"><Button size="sm" busy={busy === `Save ${c.clip_id}`} onClick={() => onSave(text)}>Save prompt</Button></div>}
    </Card>
  );
}

function FramePrompt({ ip }: { ip: any }) {
  const { d, act, busy } = useJob();
  const ref = useRef<HTMLInputElement>(null);
  const seed = d.job.video_provider === "seedance";
  const clip = (seed ? d.production.seedance_prompts : d.production.flow_prompts).find((c: any) => c.clip_id === ip.clip_id);
  const current = seed ? clip?.first_frame : d.production.reference_assets.find((a: any) => a.kind === "start_frame" && a.path.includes(`${ip.clip_id}_first`))?.path;
  const can = ["PROMPTS_READY", "AWAITING_RENDER"].includes(d.job.state);
  return (
    <div className="mb-4 rounded-xl border border-line p-3">
      <div className="mb-2 flex flex-wrap items-center gap-2"><Badge tone="accent">{ip.clip_id}</Badge><span className="text-xs text-muted">{ip.purpose}</span><CopyButton text={ip.prompt} /></div>
      <p className="text-sm">{ip.prompt}</p>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        {current && <Thumb path={current} />}
        <input ref={ref} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) act(`Upload ${ip.clip_id} first frame`, () => api(`/api/jobs/${d.job.id}/frames?clip=${ip.clip_id}&filename=${encodeURIComponent(f.name)}`, { raw: f }));
        }} />
        <Button size="sm" disabled={!can} busy={busy === `Upload ${ip.clip_id} first frame`} onClick={() => ref.current?.click()}>Upload first frame</Button>
        <code className="text-xs text-muted">{current ?? ip.save_as}</code>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------------- render & QC

export function RenderTab() {
  const { d } = useJob();
  const seed = d.job.video_provider === "seedance";
  const clips: any[] = seed ? d.production.seedance_prompts ?? [] : d.production.flow_prompts ?? [];
  const canUpload = ["AWAITING_RENDER", "RENDER_UPLOADED", "QC_PENDING"].includes(d.job.state);
  return (
    <div className="flex flex-col gap-6">
      {!canUpload && !["QC_APPROVED", "DELIVERED"].includes(d.job.state) && <Notice tone="info">Uploads open once the job is awaiting manual render.</Notice>}
      {clips.map((c) => <ClipRenders key={c.clip_id} clip={c} canUpload={canUpload} />)}
      {d.job.state === "RENDER_UPLOADED" && <AttachNow />}
      {(d.job.state === "QC_PENDING" || d.reviews.length > 0) && <QcForm clips={clips} />}
    </div>
  );
}

function AttachNow() {
  const { d, act, busy } = useJob();
  return <Notice tone="info" title="Waiting for a take of every clip">Each upload is checked automatically. <Button size="sm" busy={busy === "Check takes"} onClick={() => act("Check takes", () => api(`/api/jobs/${d.job.id}/renders/attach`, { body: {} }))}>Check again</Button></Notice>;
}

function ClipRenders({ clip, canUpload }: { clip: any; canUpload: boolean }) {
  const { d, act, busy } = useJob();
  const ref = useRef<HTMLInputElement>(null);
  const [credits, setCredits] = useState("");
  const [cost, setCost] = useState("");
  const [testMedia, setTestMedia] = useState(d.job.is_test);
  const takes = d.renders.filter((r: any) => r.clip_id === clip.clip_id);
  const label = `Upload ${clip.clip_id}`;
  return (
    <Card title={`${clip.clip_id} · ${clip.start_seconds}–${clip.end_seconds}s`} subtitle="Render this clip by hand, download the MP4, upload it here.">
      {canUpload && (
        <div className="mb-4 flex flex-wrap items-end gap-3">
          <label className="flex flex-col text-xs text-muted">Credits used<input inputMode="decimal" className={`${inputCls} w-28`} value={credits} onChange={(e) => setCredits(e.target.value)} /></label>
          <label className="flex flex-col text-xs text-muted">Est. cost (optional)<input inputMode="decimal" className={`${inputCls} w-28`} value={cost} onChange={(e) => setCost(e.target.value)} /></label>
          <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={testMedia} onChange={(e) => setTestMedia(e.target.checked)} /> test media (not from a provider)</label>
          <input ref={ref} type="file" accept="video/mp4,video/quicktime" hidden onChange={(e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            const q = new URLSearchParams({ clip: clip.clip_id, filename: f.name, ...(credits ? { credits } : {}), ...(cost ? { cost } : {}), ...(testMedia ? { test: "1" } : {}) });
            act(label, () => api(`/api/jobs/${d.job.id}/renders?${q}`, { raw: f }));
            e.target.value = "";
          }} />
          <Button variant="primary" busy={busy === label} onClick={() => ref.current?.click()}>Upload MP4</Button>
        </div>
      )}
      {takes.length === 0 ? <p className="text-sm text-muted">No takes yet.</p> : (
        <div className="grid gap-4 lg:grid-cols-2">
          {takes.map((t: any) => (
            <div key={t.id} className="rounded-xl border border-line p-3">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <Badge tone="accent">take {t.attempt}</Badge>
                <Badge tone={t.status === "selected" ? "ok" : t.status === "rejected" ? "bad" : "neutral"}>{t.status}</Badge>
                {t.is_test_media && <Badge tone="warn">TEST MEDIA</Badge>}
                {t.probe && <span className="text-xs text-muted">{t.probe.duration_seconds}s · {t.probe.display_width}×{t.probe.display_height} · {t.probe.has_audio ? "audio" : "no audio"}</span>}
                {t.credits != null && <span className="text-xs text-muted">{t.credits} credits</span>}
              </div>
              <video controls preload="metadata" className="max-h-96 w-full rounded-lg bg-black" src={fileUrl(t.path)} />
              {t.probe?.technical_checks?.length > 0 && <div className="mt-2"><Notice tone="warn">{t.probe.technical_checks.join(" · ")}</Notice></div>}
              <div className="mt-2 grid grid-cols-[96px_1fr] gap-2">
                {t.first_frame && <figure><img src={fileUrl(t.first_frame)} alt={`First frame of take ${t.attempt}`} className="w-24 rounded border border-line" /><figcaption className="text-[11px] text-muted">first frame</figcaption></figure>}
                {t.contact_sheet && <a href={fileUrl(t.contact_sheet)} target="_blank" rel="noreferrer"><img src={fileUrl(t.contact_sheet)} alt="Contact sheet" className="max-h-40 rounded border border-line object-contain" /></a>}
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function QcForm({ clips }: { clips: any[] }) {
  const { d, act, busy } = useJob();
  const cats: any[] = d.qc_categories;
  const live = d.renders.filter((r: any) => r.status === "attached" || r.status === "selected");
  const [pick, setPick] = useState<Record<string, number>>({});
  const [scores, setScores] = useState<Record<string, number | null>>({});
  const [defects, setDefects] = useState<any[]>([]);
  const [comments, setComments] = useState("");
  const [dialog, setDialog] = useState<null | "approve" | "revision" | "reject">(null);
  const [stage, setStage] = useState("PROMPTS_READY");
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    const next: Record<string, number> = {};
    for (const c of clips) {
      const latest = live.filter((r: any) => r.clip_id === c.clip_id).sort((a: any, b: any) => b.attempt - a.attempt)[0];
      if (latest) next[c.clip_id] = latest.id;
    }
    setPick((p) => ({ ...next, ...p }));
  }, [d.renders]); // eslint-disable-line react-hooks/exhaustive-deps
  const overall = useMemo(() => {
    let s = 0, w = 0;
    for (const c of cats) if (typeof scores[c.check_id] === "number") { s += (scores[c.check_id] as number) * c.weight; w += c.weight; }
    return w ? Math.round((s / w) * 100) / 100 : null;
  }, [scores, cats]);
  const missing = cats.filter((c) => typeof scores[c.check_id] !== "number");
  const failing = cats.filter((c) => typeof scores[c.check_id] === "number" && (scores[c.check_id] as number) < c.min_pass);
  const open = d.job.state === "QC_PENDING";
  const payload = (decision: string, v?: any) => ({
    render_ids: Object.values(pick), scores, defects: defects.filter((x) => x.note.trim()), comments: v?.notes ? `${comments}${comments ? "\n" : ""}${v.notes}` : comments, decision,
    reviewer: v?.reviewer ?? "", confirm_job_id: v?.confirm_job_id ?? "", ...(decision === "revision" ? { revision_stage: stage } : {}),
  });
  return (
    <Card title="Quality review" subtitle="Scores 1–5 from a person who watched each take in full, with sound. AI notes are never a substitute.">
      {open && (
        <>
          <div className="mb-4 flex flex-wrap gap-3">
            {clips.map((c) => (
              <label key={c.clip_id} className="flex flex-col gap-1 text-xs text-muted">Take for {c.clip_id}
                <select className={inputCls} value={pick[c.clip_id] ?? ""} onChange={(e) => setPick({ ...pick, [c.clip_id]: Number(e.target.value) })}>
                  {live.filter((r: any) => r.clip_id === c.clip_id).map((r: any) => <option key={r.id} value={r.id}>take {r.attempt}</option>)}
                </select>
              </label>
            ))}
          </div>
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted"><tr><th className="py-1">Category</th><th>Min</th><th>Score</th></tr></thead>
            <tbody>
              {cats.map((c) => (
                <tr key={c.check_id} className="border-t border-line">
                  <td className="py-1.5"><span className="font-mono text-xs text-muted">{c.check_id}</span> {c.label}</td>
                  <td>{c.min_pass}</td>
                  <td>
                    <div className="flex gap-1" role="radiogroup" aria-label={c.label}>
                      {[1, 2, 3, 4, 5].map((n) => (
                        <button key={n} role="radio" aria-checked={scores[c.check_id] === n} onClick={() => setScores({ ...scores, [c.check_id]: n })}
                          className={cx("h-7 w-7 rounded-md border text-xs", scores[c.check_id] === n ? (n < c.min_pass ? "border-bad bg-bad-soft text-bad" : "border-accent bg-accent-soft text-accent") : "border-line hover:bg-panel-2")}>{n}</button>
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
            <Badge tone={missing.length || failing.length ? "warn" : "ok"}>Overall {overall ?? "—"}</Badge>
            {missing.length > 0 && <span className="text-xs text-muted">{missing.length} not scored</span>}
            {failing.length > 0 && <span className="text-xs text-bad">Below minimum: {failing.map((f) => f.check_id).join(", ")}</span>}
            <span className="text-xs text-muted">N/A for this mode: lip-sync/dialogue/audio checks are left out where they do not apply.</span>
          </div>
          <h3 className="mt-5 text-sm font-semibold">Defects with time ranges</h3>
          {defects.map((x, i) => (
            <div key={i} className="mt-2 grid gap-2 sm:grid-cols-[120px_80px_80px_1fr_auto]">
              <select aria-label="Category" className={inputCls} value={x.check_id} onChange={(e) => setDefects(defects.map((y, j) => (j === i ? { ...y, check_id: e.target.value } : y)))}>{cats.map((c) => <option key={c.check_id} value={c.check_id}>{c.check_id}</option>)}</select>
              <input aria-label="Start seconds" type="number" step="0.1" min={0} className={inputCls} value={x.start_seconds} onChange={(e) => setDefects(defects.map((y, j) => (j === i ? { ...y, start_seconds: Number(e.target.value) } : y)))} />
              <input aria-label="End seconds" type="number" step="0.1" min={0} className={inputCls} value={x.end_seconds} onChange={(e) => setDefects(defects.map((y, j) => (j === i ? { ...y, end_seconds: Number(e.target.value) } : y)))} />
              <input aria-label="Defect note" className={inputCls} placeholder="What is wrong" value={x.note} onChange={(e) => setDefects(defects.map((y, j) => (j === i ? { ...y, note: e.target.value } : y)))} />
              <Button size="sm" variant="ghost" onClick={() => setDefects(defects.filter((_, j) => j !== i))}>Remove</Button>
            </div>
          ))}
          <div className="mt-2"><Button size="sm" onClick={() => setDefects([...defects, { check_id: cats[0]?.check_id, start_seconds: 0, end_seconds: 0, note: "" }])}>Add defect</Button></div>
          <label className="mt-4 block text-sm font-medium" htmlFor="qc-comments">Reviewer comments</label>
          <textarea id="qc-comments" className={inputCls} rows={3} value={comments} onChange={(e) => setComments(e.target.value)} />
          {err && <div className="mt-3"><Notice tone="bad">{err}</Notice></div>}
          <div className="mt-4 flex flex-wrap gap-2">
            <Button busy={busy === "Save draft review"} onClick={() => act("Save draft review", () => api(`/api/jobs/${d.job.id}/review`, { body: payload("draft") }))}>Keep as draft</Button>
            <Button variant="primary" disabled={missing.length > 0 || failing.length > 0} title={missing.length || failing.length ? "Every check must be scored at or above its minimum" : undefined} onClick={() => { setErr(null); setDialog("approve"); }}>Approve video</Button>
            <Button onClick={() => { setErr(null); setDialog("revision"); }}>Request revision</Button>
            <Button variant="danger" onClick={() => { setErr(null); setDialog("reject"); }}>Reject take</Button>
            {dialog === "revision" && (
              <select aria-label="Stage to reopen" className={`${inputCls} w-auto`} value={stage} onChange={(e) => setStage(e.target.value)}>
                {["AWAITING_RENDER", "PROMPTS_READY", "STORYBOARD_READY", "SCRIPT_READY", "BRIEF_READY"].map((s) => <option key={s} value={s}>reopen {s}</option>)}
              </select>
            )}
          </div>
          <ConfirmDialog open={dialog !== null} jobId={d.job.id} danger={dialog === "reject"} busy={!!busy}
            title={dialog === "approve" ? "Approve this video" : dialog === "revision" ? `Request revision (reopen ${stage})` : "Reject the selected take(s)"}
            confirmLabel={dialog === "approve" ? "Approve" : dialog === "revision" ? "Request revision" : "Reject"}
            description={dialog === "approve" ? (d.job.is_test ? "Test job: this records a TEST approval only; the package will be stamped not for commercial delivery." : "This is the human sign-off for commercial delivery. It also runs the same checks as tools/approve.py.") : undefined}
            error={err} onCancel={() => setDialog(null)}
            onConfirm={async (v) => {
              try {
                await api(`/api/jobs/${d.job.id}/review`, { body: payload(dialog!, v) });
                setDialog(null);
                await act("Review", async () => ({ message: `recorded (${dialog})` }));
              } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
            }} />
        </>
      )}
      {d.reviews.length > 0 && (
        <div className="mt-6">
          <h3 className="text-sm font-semibold">Review history</h3>
          <ul className="mt-2 flex flex-col gap-2 text-sm">
            {d.reviews.map((r: any) => (
              <li key={r.id} className="rounded-lg border border-line p-2">
                <div className="flex flex-wrap items-center gap-2"><Badge tone={r.decision === "approve" ? "ok" : r.decision === "reject" ? "bad" : r.decision === "revision" ? "warn" : "neutral"}>{r.decision}</Badge>
                  <span>overall {r.overall ?? "—"}</span><span className="text-xs text-muted">{r.reviewer ?? "draft"} · {fmtDate(r.ts)}</span></div>
                {r.comments && <p className="mt-1 text-xs text-muted">{r.comments}</p>}
                {r.defects.length > 0 && <ul className="ml-5 mt-1 list-disc text-xs">{r.defects.map((x: any, i: number) => <li key={i}>{x.check_id} {x.start_seconds}–{x.end_seconds}s: {x.note}</li>)}</ul>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}

// ----------------------------------------------------------------------------- delivery

export function DeliveryTab() {
  const { d, act, busy } = useJob();
  const pkg = d.package;
  const m = pkg?.manifest;
  return (
    <div className="flex flex-col gap-6">
      <Card title="Delivery package" subtitle="ZIP with the approved video(s), brief, script, storyboard, prompts, character and asset manifests, provider details, QC review and history. Private reference images are never included. Nothing is uploaded or posted."
        actions={<>
          {d.job.state === "QC_APPROVED" && <Button variant="primary" busy={busy === "Build package"} onClick={() => act("Build package", () => api(`/api/jobs/${d.job.id}/package`, { body: {} }))}>Build package</Button>}
          {pkg && <a className="inline-flex items-center rounded-lg border border-line px-3.5 py-2 text-sm font-medium hover:bg-panel-2" href={`/api/jobs/${d.job.id}/package/download`}>Download ZIP</a>}
        </>}>
        {!pkg ? <p className="text-sm text-muted">{d.job.state === "QC_APPROVED" ? "Ready to build." : "Available after QC approval."}</p> : (
          <>
            {m.is_test && <div className="mb-3"><Notice tone="warn" title="TEST PACKAGE">Fixture data and test media. Never deliver or publish this commercially.</Notice></div>}
            <KV items={[["Package", m.package], ["Created", fmtDate(m.created_at)], ["Edit", m.edit?.built ? m.edit.file : `not built: ${m.edit?.reason ?? ""}`], ["Excluded", (m.excluded ?? []).join(", ")]]} />
            <table className="mt-4 w-full text-xs"><thead className="text-left text-muted"><tr><th>File</th><th>Size</th><th>SHA-256</th></tr></thead>
              <tbody>{m.files.map((f: any) => <tr key={f.path} className="border-t border-line"><td className="py-1 font-mono">{f.path}</td><td>{(f.bytes / 1024).toFixed(1)} KB</td><td className="max-w-40 truncate font-mono text-muted" title={f.sha256}>{f.sha256}</td></tr>)}</tbody></table>
          </>
        )}
      </Card>
    </div>
  );
}

// ----------------------------------------------------------------------------- history

export function HistoryTab() {
  const { d, act, busy } = useJob();
  return (
    <div className="flex flex-col gap-6">
      {d.job.state === "FAILED" && (
        <Notice tone="bad" title="Job failed">
          <p>{d.job.last_error}</p>
          <div className="mt-2"><Button size="sm" variant="primary" busy={busy === "Retry"} onClick={() => act("Retry", () => api(`/api/jobs/${d.job.id}/retry`, { body: {} }))}>Retry ({d.job.retry_count} used)</Button></div>
        </Notice>
      )}
      <Card title="State history">
        <table className="w-full text-sm"><thead className="text-left text-xs text-muted"><tr><th className="py-1">When</th><th>From → to</th><th>Actor</th><th>n8n execution</th><th>Reason</th></tr></thead>
          <tbody>{d.events.map((e: any) => (
            <tr key={e.id} className="border-t border-line align-top">
              <td className="whitespace-nowrap py-1.5 text-xs text-muted">{fmtDate(e.ts)}</td>
              <td className="whitespace-nowrap text-xs">{e.from_state ?? "∅"} → <StateBadge state={e.to_state} /></td>
              <td className="text-xs"><Badge tone={e.actor_type === "human" ? "ok" : e.actor_type === "orchestrator" ? "info" : "neutral"}>{e.actor_name ?? e.actor_type}</Badge> <span className="text-muted">{e.source}</span></td>
              <td className="font-mono text-xs">{e.execution_id ?? "—"}</td>
              <td className="text-xs">{e.reason}</td>
            </tr>))}</tbody></table>
      </Card>
      <Card title="Orchestration runs" subtitle="Each submission to n8n, its execution id, attempts and errors.">
        {d.runs.length === 0 ? <p className="text-sm text-muted">No n8n runs (direct mode or not submitted yet).</p> : (
          <table className="w-full text-sm"><thead className="text-left text-xs text-muted"><tr><th className="py-1">Workflow</th><th>Execution</th><th>Status</th><th>Attempts</th><th>Error</th><th>Updated</th></tr></thead>
            <tbody>{d.runs.map((r: any) => <tr key={r.id} className="border-t border-line"><td className="py-1.5">{r.workflow}</td><td className="font-mono text-xs">{r.execution_id ?? "—"}</td><td><Badge tone={r.status === "failed" ? "bad" : r.status === "completed" ? "ok" : "info"}>{r.status}</Badge></td><td>{r.attempts}</td><td className="max-w-64 truncate text-xs text-bad" title={r.last_error ?? ""}>{r.last_error ?? ""}</td><td className="text-xs text-muted">{fmtDate(r.updated_at)}</td></tr>)}</tbody></table>
        )}
      </Card>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Approvals">
          {d.approvals.length === 0 ? <p className="text-sm text-muted">None yet.</p> : <ul className="flex flex-col gap-1 text-sm">{d.approvals.map((a: any) => <li key={a.id}><Badge tone={a.decision.startsWith("approved") ? "ok" : "warn"}>{a.gate}: {a.decision}</Badge> {a.reviewer} <span className="text-xs text-muted">{fmtDate(a.ts)}</span>{a.notes && <span className="text-xs text-muted"> — {a.notes}</span>}</li>)}</ul>}
        </Card>
        <Card title="Usage and costs" subtitle="Estimates are labelled; credits are what the person reported.">
          {d.usage.length === 0 ? <p className="text-sm text-muted">Nothing recorded.</p> : <ul className="flex flex-col gap-1 text-sm">{d.usage.map((u: any) => <li key={u.id}><Badge tone={u.kind === "estimate" ? "warn" : "ok"}>{u.kind}</Badge> {u.provider} · {u.units != null ? `${u.units} ${u.unit_type}` : ""} {u.amount != null ? `· ${u.amount} ${u.currency}` : ""} <span className="text-xs text-muted">{u.note}</span></li>)}</ul>}
        </Card>
      </div>
      <Issues errors={d.validation.errors} warnings={d.validation.warnings} />
    </div>
  );
}
