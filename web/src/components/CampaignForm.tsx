"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api, fileUrl } from "@/lib/client";
import { Badge, Button, Card, Field, Issues, Notice, cx, inputCls } from "./ui";

type Data = Record<string, any>;

export const EMPTY: Data = {
  name: "", creation_mode: "original", performance_mode: "talking_influencer", video_provider: "google_flow", character_id: "", is_test: false,
  brand: { name: "", guidelines: [], colors: [] },
  product: { name: "", category: "", description: "", key_features: [], visual_identity: [], variants: [], price: null, where_to_buy: null },
  product_images: [], product_image_rights: "owned", verified_claims: [], prohibited_claims: [],
  audience: { description: "", age_range: null, locale: "ID", pain_points: [] },
  language: "id", objective: "", concept_direction: null, tone: [], cta: "", platforms: ["TikTok"],
  duration_seconds: 8, aspect_ratio: "9:16", visual_style: "Natural smartphone video, daylight, realistic",
  script_mode: "ai_generated", custom_script: null, exact_script: true, mandatory_elements: [], restrictions: [], reference_video: null,
};

const RATE: Record<string, number> = { id: 2.0, en: 2.3 };
function speech(text: string, lang: string, duration: number, maxClip: number) {
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  const rate = RATE[lang.slice(0, 2)] ?? 2.1;
  const clips = Math.max(1, Math.ceil(duration / maxClip));
  const budget = Math.max(0, duration - clips);
  return { words, seconds: +(words / rate).toFixed(1), budget, rate, clips };
}

function Lines({ value, onChange, rows = 3, placeholder }: { value: string[]; onChange: (v: string[]) => void; rows?: number; placeholder?: string }) {
  const [text, setText] = useState((value ?? []).join("\n"));
  useEffect(() => setText((value ?? []).join("\n")), [value]);
  return (
    <textarea className={inputCls} rows={rows} value={text} placeholder={placeholder}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => onChange(text.split("\n").map((s) => s.trim()).filter(Boolean))} />
  );
}

function setPath(obj: Data, path: string, v: unknown): Data {
  const [h, ...rest] = path.split(".");
  return { ...obj, [h]: rest.length ? setPath(obj[h] ?? {}, rest.join("."), v) : v };
}

export function CampaignForm({ id, initial, characters, onSaved }: { id: string | null; initial: Data; characters: Record<string, any>; onSaved?: (r: any) => void }) {
  const router = useRouter();
  const [d, setD] = useState<Data>({ ...EMPTY, ...initial });
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const [upBusy, setUpBusy] = useState(false);
  const imgInput = useRef<HTMLInputElement>(null);
  const vidInput = useRef<HTMLInputElement>(null);
  const set = (path: string, v: unknown) => setD((cur) => setPath(cur, path, v));
  const issues: { path: string; message: string }[] = result?.issues ?? [];
  const issueFor = (p: string) => issues.find((i) => i.path === p || i.path.startsWith(p + "."))?.message;
  const est = useMemo(() => speech(d.custom_script ?? "", d.language, Number(d.duration_seconds) || 0, d.video_provider === "seedance" ? 10 : 8), [d.custom_script, d.language, d.duration_seconds, d.video_provider]);
  const char = characters[d.character_id];

  async function save() {
    setBusy(true);
    setErr(null);
    try {
      const payload = { ...d, duration_seconds: Number(d.duration_seconds) };
      const r = id ? await api(`/api/campaigns/${id}`, { method: "PUT", body: { data: payload } }) : await api("/api/campaigns", { body: { data: payload } });
      setResult(r);
      onSaved?.(r);
      if (!id) router.push(`/campaigns/${r.campaign.id}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function upload(kind: "images" | "reference-video", file: File) {
    if (!id) return;
    setUpBusy(true);
    setErr(null);
    try {
      const r = await api(`/api/campaigns/${id}/${kind}?filename=${encodeURIComponent(file.name)}`, { raw: file });
      if (kind === "images") set("product_images", [...(d.product_images ?? []), r.path]);
      else set("reference_video", { path: r.path, rights: d.reference_video?.rights ?? "owned", rights_note: d.reference_video?.rights_note ?? "" });
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setUpBusy(false);
    }
  }

  const sel = (path: string, opts: [string, string][], disabled = false) => (id2: string) => (
    <select id={id2} className={inputCls} disabled={disabled} value={path.split(".").reduce((o: any, k) => o?.[k], d) ?? ""} onChange={(e) => set(path, e.target.value)}>
      {opts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </select>
  );

  return (
    <div className="flex flex-col gap-6">
      <Card title="Campaign" subtitle="Production mode, performance mode, character and format.">
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Campaign name" required error={issueFor("name")}>{(i) => <input id={i} className={inputCls} value={d.name} onChange={(e) => set("name", e.target.value)} />}</Field>
          <Field label="Character" required error={issueFor("character_id")} hint={char ? (char.status === "active" ? "Active character" : `Status: ${char.status} — cannot be rendered yet`) : "The selected character is used for every clip; it is never swapped for another."}>
            {(i) => (
              <select id={i} className={inputCls} value={d.character_id} onChange={(e) => set("character_id", e.target.value)}>
                <option value="">Choose…</option>
                {Object.values(characters).map((c: any) => <option key={c.character_id} value={c.character_id}>{c.display_name} ({c.character_id}) · {c.status}</option>)}
              </select>
            )}
          </Field>
          <Field label="Production mode">{sel("creation_mode", [["original", "Original Creation"], ["reference_guided", "Reference Guided (authorized video)"]])}</Field>
          <Field label="Performance mode" hint={{ talking_influencer: "Speaks to camera; lip-sync is reviewed.", fashion_showcase: "No dialogue; product shown through movement.", voiceover_showcase: "Does not speak on camera; separate narration." }[d.performance_mode as string]}>
            {sel("performance_mode", [["talking_influencer", "Talking Influencer"], ["fashion_showcase", "Fashion / Product Showcase"], ["voiceover_showcase", "Voice-over Showcase"]])}
          </Field>
          <Field label="Video provider (manual rendering)">{sel("video_provider", [["google_flow", "Google Flow"], ["seedance", "Seedance / Dreamina"]])}</Field>
          <Field label="Language" hint="e.g. id, en" error={issueFor("language")}>{(i) => <input id={i} className={inputCls} value={d.language} onChange={(e) => set("language", e.target.value)} />}</Field>
          <Field label="Duration (seconds)" hint="Longer ads are split into clips the provider can render (8 s Flow, 10 s Seedance by config)." error={issueFor("duration_seconds")}>
            {(i) => <input id={i} type="number" min={1} max={180} className={inputCls} value={d.duration_seconds} onChange={(e) => set("duration_seconds", e.target.value)} />}
          </Field>
          <Field label="Aspect ratio">{sel("aspect_ratio", [["9:16", "9:16 vertical"], ["16:9", "16:9"], ["1:1", "1:1"], ["4:5", "4:5"]])}</Field>
          <Field label="Visual style" error={issueFor("visual_style")}>{(i) => <input id={i} className={inputCls} value={d.visual_style} onChange={(e) => set("visual_style", e.target.value)} />}</Field>
          <Field label="Advertising objective" error={issueFor("objective")}>{(i) => <input id={i} className={inputCls} value={d.objective} onChange={(e) => set("objective", e.target.value)} />}</Field>
          <Field label="Call to action" error={issueFor("cta")}>{(i) => <input id={i} className={inputCls} value={d.cta} onChange={(e) => set("cta", e.target.value)} />}</Field>
          <Field label="Platforms (one per line)">{() => <Lines value={d.platforms} onChange={(v) => set("platforms", v)} rows={2} />}</Field>
          <Field label="Tone (one per line)">{() => <Lines value={d.tone} onChange={(v) => set("tone", v)} rows={2} />}</Field>
          <Field label="Concept direction (optional)">{(i) => <input id={i} className={inputCls} value={d.concept_direction ?? ""} onChange={(e) => set("concept_direction", e.target.value || null)} />}</Field>
        </div>
        <label className="mt-4 flex items-center gap-2 text-sm">
          <input type="checkbox" checked={!!d.is_test} onChange={(e) => set("is_test", e.target.checked)} />
          Test / sample data (never approved for commercial delivery; packages are stamped TEST)
        </label>
      </Card>

      <Card title="Product" subtitle="Only facts you can back up. The pipeline never adds features or claims.">
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Brand name" required error={issueFor("brand")}>{(i) => <input id={i} className={inputCls} value={d.brand.name} onChange={(e) => set("brand.name", e.target.value)} />}</Field>
          <Field label="Brand guidelines (one per line)">{() => <Lines value={d.brand.guidelines} onChange={(v) => set("brand.guidelines", v)} />}</Field>
          <Field label="Product name" required error={issueFor("product.name")}>{(i) => <input id={i} className={inputCls} value={d.product.name} onChange={(e) => set("product.name", e.target.value)} />}</Field>
          <Field label="Category" required error={issueFor("product.category")}>{(i) => <input id={i} className={inputCls} value={d.product.category} onChange={(e) => set("product.category", e.target.value)} />}</Field>
          <div className="md:col-span-2">
            <Field label="Description" required error={issueFor("product.description")}>{(i) => <textarea id={i} rows={2} className={inputCls} value={d.product.description} onChange={(e) => set("product.description", e.target.value)} />}</Field>
          </div>
          <Field label="Key features (one per line)" required error={issueFor("product.key_features")}>{() => <Lines value={d.product.key_features} onChange={(v) => set("product.key_features", v)} />}</Field>
          <Field label="Visual identity — what must look right on screen" required error={issueFor("product.visual_identity")}>{() => <Lines value={d.product.visual_identity} onChange={(v) => set("product.visual_identity", v)} />}</Field>
          <Field label="Variants (one per line)">{() => <Lines value={d.product.variants} onChange={(v) => set("product.variants", v)} rows={2} />}</Field>
          <Field label="Where to buy">{(i) => <input id={i} className={inputCls} value={d.product.where_to_buy ?? ""} onChange={(e) => set("product.where_to_buy", e.target.value || null)} />}</Field>
        </div>

        <div className="mt-5">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold">Product photos</h3>
            <div className="flex items-center gap-2">
              <select aria-label="Rights for product photos" className={cx(inputCls, "w-auto")} value={d.product_image_rights} onChange={(e) => set("product_image_rights", e.target.value)}>
                <option value="owned">Rights: owned</option><option value="licensed">licensed</option><option value="written_permission">written permission</option><option value="internal_test_only">internal test only</option>
              </select>
              <input ref={imgInput} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => e.target.files?.[0] && upload("images", e.target.files[0])} />
              <Button size="sm" busy={upBusy} disabled={!id} title={!id ? "Save the draft first" : undefined} onClick={() => imgInput.current?.click()}>Upload photo</Button>
            </div>
          </div>
          {!id && <p className="text-xs text-muted">Save the draft once to enable uploads.</p>}
          <div className="flex flex-wrap gap-3">
            {(d.product_images ?? []).map((p: string) => (
              <figure key={p} className="w-28">
                <img src={fileUrl(p)} alt="" className="h-28 w-28 rounded-lg border border-line object-cover" />
                <figcaption className="mt-1 flex items-center justify-between gap-1 text-[11px] text-muted">
                  <span className="truncate" title={p}>{p.split("/").pop()}</span>
                  <button className="text-bad" onClick={() => set("product_images", d.product_images.filter((x: string) => x !== p))} aria-label={`Remove ${p}`}>✕</button>
                </figcaption>
              </figure>
            ))}
          </div>
          {issueFor("product_images") && <p className="mt-1 text-xs text-bad">{issueFor("product_images")}</p>}
        </div>
      </Card>

      <Card title="Claims" subtitle="Verified claims are the only product statements scripts may make (word for word in meaning). Anything else becomes [CLAIM NEEDED].">
        <div className="flex flex-col gap-2">
          {(d.verified_claims ?? []).map((c: any, i: number) => (
            <div key={i} className="grid gap-2 md:grid-cols-[1fr_1fr_auto]">
              <input aria-label={`Claim ${i + 1}`} className={inputCls} placeholder="Claim" value={c.claim} onChange={(e) => set("verified_claims", d.verified_claims.map((x: any, j: number) => (j === i ? { ...x, claim: e.target.value } : x)))} />
              <input aria-label={`Source ${i + 1}`} className={inputCls} placeholder="Source (listing, label, test report…)" value={c.source} onChange={(e) => set("verified_claims", d.verified_claims.map((x: any, j: number) => (j === i ? { ...x, source: e.target.value } : x)))} />
              <Button size="sm" variant="ghost" onClick={() => set("verified_claims", d.verified_claims.filter((_: any, j: number) => j !== i))}>Remove</Button>
            </div>
          ))}
          <div><Button size="sm" onClick={() => set("verified_claims", [...(d.verified_claims ?? []), { claim: "", source: "" }])}>Add verified claim</Button></div>
          {issueFor("verified_claims") && <p className="text-xs text-bad">{issueFor("verified_claims")}</p>}
        </div>
        <div className="mt-4"><Field label="Prohibited claims (one per line)">{() => <Lines value={d.prohibited_claims} onChange={(v) => set("prohibited_claims", v)} />}</Field></div>
      </Card>

      <Card title="Audience">
        <div className="grid gap-4 md:grid-cols-3">
          <div className="md:col-span-3"><Field label="Target audience" required error={issueFor("audience")}>{(i) => <input id={i} className={inputCls} value={d.audience.description} onChange={(e) => set("audience.description", e.target.value)} />}</Field></div>
          <Field label="Age range">{(i) => <input id={i} className={inputCls} value={d.audience.age_range ?? ""} onChange={(e) => set("audience.age_range", e.target.value || null)} />}</Field>
          <Field label="Locale">{(i) => <input id={i} className={inputCls} value={d.audience.locale} onChange={(e) => set("audience.locale", e.target.value)} />}</Field>
          <Field label="Pain points (one per line)">{() => <Lines value={d.audience.pain_points} onChange={(v) => set("audience.pain_points", v)} rows={2} />}</Field>
        </div>
      </Card>

      <Card title="Script" subtitle="Write your own storytelling script, or let the pipeline draft one from the verified claims.">
        <div className="flex flex-wrap gap-4 text-sm">
          <label className="flex items-center gap-2"><input type="radio" checked={d.script_mode === "ai_generated"} onChange={() => set("script_mode", "ai_generated")} /> Draft a script for me</label>
          <label className="flex items-center gap-2"><input type="radio" checked={d.script_mode === "custom"} onChange={() => set("script_mode", "custom")} /> Use my script</label>
        </div>
        {d.script_mode === "custom" && (
          <div className="mt-4 flex flex-col gap-3">
            <Field label="Your script" required error={issueFor("custom_script")}>
              {(i) => <textarea id={i} rows={5} className={inputCls} value={d.custom_script ?? ""} onChange={(e) => set("custom_script", e.target.value)} />}
            </Field>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={d.exact_script !== false} onChange={(e) => set("exact_script", e.target.checked)} />
              Exact-script mode — use these words unchanged (the validator rejects any edit)
            </label>
            {d.performance_mode !== "fashion_showcase" ? (
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <Badge tone={est.seconds <= est.budget ? "ok" : "warn"}>{est.words} words ≈ {est.seconds}s spoken at {est.rate} w/s</Badge>
                <span className="text-muted">Budget ≈ {est.budget}s ({est.clips} clip(s), ~1 s silence per clip edge)</span>
                {est.seconds > est.budget && <span className="text-warn">Likely too long for {d.duration_seconds}s.</span>}
              </div>
            ) : <Notice tone="warn">Fashion showcase has no dialogue: the script is kept for captions only.</Notice>}
          </div>
        )}
      </Card>

      {d.creation_mode === "reference_guided" && (
        <Card title="Reference video" subtitle="Only videos you own or are authorized to use. Nothing is downloaded from platforms. The new ad adapts the structure, never copies it.">
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <input ref={vidInput} type="file" accept="video/mp4,video/quicktime" hidden onChange={(e) => e.target.files?.[0] && upload("reference-video", e.target.files[0])} />
              <Button size="sm" busy={upBusy} disabled={!id} onClick={() => vidInput.current?.click()}>Upload reference video</Button>
              {d.reference_video?.path && <code className="text-xs">{d.reference_video.path}</code>}
            </div>
            {d.reference_video && (
              <div className="grid gap-3 md:grid-cols-2">
                <Field label="Usage rights">
                  {(i) => (
                    <select id={i} className={inputCls} value={d.reference_video.rights} onChange={(e) => set("reference_video", { ...d.reference_video, rights: e.target.value })}>
                      <option value="owned">I own it</option><option value="licensed">Licensed</option><option value="written_permission">Written permission</option><option value="internal_test_only">Internal test only</option>
                    </select>
                  )}
                </Field>
                <Field label="Rights note (licence id, who gave permission)">{(i) => <input id={i} className={inputCls} value={d.reference_video.rights_note ?? ""} onChange={(e) => set("reference_video", { ...d.reference_video, rights_note: e.target.value })} />}</Field>
              </div>
            )}
            {issueFor("reference_video") && <p className="text-xs text-bad">{issueFor("reference_video")}</p>}
          </div>
        </Card>
      )}

      <Card title="Extra requirements">
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Mandatory elements (one per line)">{() => <Lines value={d.mandatory_elements} onChange={(v) => set("mandatory_elements", v)} />}</Field>
          <Field label="Restrictions (one per line)">{() => <Lines value={d.restrictions} onChange={(v) => set("restrictions", v)} />}</Field>
        </div>
      </Card>

      <div className="sticky bottom-0 z-10 -mx-1 flex flex-wrap items-center gap-3 rounded-xl border border-line bg-panel/95 px-4 py-3 backdrop-blur">
        <Button variant="primary" onClick={save} busy={busy}>{id ? "Save campaign" : "Save draft"}</Button>
        {result && (result.complete ? <Badge tone="ok">Complete — brief validated</Badge> : <Badge tone="warn">Saved as draft · {issues.length} field(s) to finish</Badge>)}
        {err && <span className="text-sm text-bad">{err}</span>}
      </div>
      {result?.report && <Issues errors={result.report.errors} warnings={result.report.warnings} />}
      {result && !result.complete && issues.length > 0 && (
        <Notice tone="warn" title="Still needed before a job can be created">
          <ul className="list-disc pl-5">{issues.slice(0, 12).map((i) => <li key={i.path + i.message}>{i.path || "campaign"}: {i.message}</li>)}</ul>
        </Notice>
      )}
    </div>
  );
}
