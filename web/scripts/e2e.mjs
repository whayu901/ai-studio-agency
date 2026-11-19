#!/usr/bin/env node
/**
 * End-to-end test of the mock/manual-mode workflow against the real HTTP API.
 *
 * It builds an isolated sandbox (a temp copy of schemas/config/tools/prompts/characters with
 * SYNTHETIC test images standing in for female_02's private references), starts the built app on
 * a spare port, and drives two complete jobs:
 *
 *   A. Original Creation · Talking Influencer · female_02 · handbag · Indonesian custom script
 *      (exact-script mode) · Google Flow · through the orchestrator (n8n if ACS_E2E_N8N=1) ·
 *      test MP4 upload · QC review · approval · package download
 *   B. Reference Guided · Fashion Showcase · Seedance · first-frame upload · smaller run
 *
 * Plus negative checks (auth, invalid transitions, exact script, uploads, traversal) and a
 * restart to prove state persists. All media are generated test fixtures; nothing is rendered by
 * any provider and every package is stamped TEST.
 *
 *   npm run build && node scripts/e2e.mjs            # direct orchestration
 *   ACS_E2E_N8N=1 node scripts/e2e.mjs               # through a running local n8n
 */
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const WEB = path.resolve(here, "..");
const REPO = path.resolve(WEB, "..");
const USE_N8N = process.env.ACS_E2E_N8N === "1";
// n8n calls the app at host.docker.internal:3000 with the token from n8n/.env.
const n8nEnv = USE_N8N && fs.existsSync(path.join(REPO, "n8n/.env")) ? fs.readFileSync(path.join(REPO, "n8n/.env"), "utf8") : "";
const PORT = Number(process.env.ACS_E2E_PORT ?? (USE_N8N ? 3000 : 3917));
const BASE = `http://127.0.0.1:${PORT}`;
const TOKEN = process.env.ACS_ORCHESTRATOR_TOKEN ?? (/^ACS_ORCHESTRATOR_TOKEN=(.+)$/m.exec(n8nEnv)?.[1] ?? "e2e-test-token-0123456789abcdef");
const KEEP = process.env.ACS_E2E_KEEP === "1";

let passed = 0;
const failures = [];
const log = (...a) => console.log(...a);
function check(name, cond, detail = "") {
  if (cond) {
    passed++;
    log(`  ✓ ${name}`);
  } else {
    failures.push(`${name} ${detail}`);
    log(`  ✗ ${name} ${detail}`);
  }
}

// ----------------------------------------------------------------------------- sandbox
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), "acs-e2e-"));
const ROOT = path.join(SANDBOX, "repo");
const DATA = path.join(SANDBOX, "data");
const FIX = path.join(SANDBOX, "fixtures");
const H264 = /\blibx264\b/.test(execFileSync("ffmpeg", ["-hide_banner", "-encoders"]).toString());
const VCODEC = H264 ? ["-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "veryfast"] : ["-c:v", "mpeg4", "-q:v", "5"];
function ff(args) {
  execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args]);
}
function buildSandbox() {
  for (const d of ["schemas", "config", "tools", "prompts", "n8n"]) {
    if (fs.existsSync(path.join(REPO, d))) fs.cpSync(path.join(REPO, d), path.join(ROOT, d), { recursive: true, filter: (s) => !s.includes("__pycache__") });
  }
  fs.mkdirSync(path.join(ROOT, "characters"), { recursive: true });
  fs.copyFileSync(path.join(REPO, "characters/registry.json"), path.join(ROOT, "characters/registry.json"));
  const colors = ["0xC08080", "0x80C080", "0x8080C0", "0xC0C080", "0x80C0C0", "0xC080C0"];
  let ci = 0;
  for (const id of ["female_01", "female_02"]) {
    const prof = JSON.parse(fs.readFileSync(path.join(REPO, `characters/${id}/character.json`), "utf8"));
    fs.mkdirSync(path.join(ROOT, `characters/${id}/references`), { recursive: true });
    // Synthetic stand-ins at the same paths: the real private images never leave the repo.
    for (const paths of Object.values(prof.references)) {
      for (const rel of paths) {
        const out = path.join(ROOT, rel.replace(/\.(jpeg|jpg|png)$/i, (m) => m));
        ff(["-f", "lavfi", "-i", `color=c=${colors[ci++ % colors.length]}:s=320x480:d=1`, "-frames:v", "1", "-update", "1", out]);
      }
    }
    fs.writeFileSync(path.join(ROOT, `characters/${id}/character.json`), JSON.stringify(prof, null, 2));
  }
  for (const d of ["assets/products", "assets/reference-videos", "outputs", "briefs"]) fs.mkdirSync(path.join(ROOT, d), { recursive: true });
  fs.writeFileSync(path.join(ROOT, "outputs/.gitkeep"), "");
  fs.mkdirSync(FIX, { recursive: true });
  // Clearly labelled fixtures.
  ff(["-f", "lavfi", "-i", "color=c=0x8a8178:s=600x600:d=1", "-frames:v", "1", "-update", "1", path.join(FIX, "test-handbag.png")]);
  ff(["-f", "lavfi", "-i", "color=c=0xdddddd:s=540x960:d=1", "-frames:v", "1", "-update", "1", path.join(FIX, "first-frame.png")]);
  ff(["-f", "lavfi", "-i", "testsrc=s=360x640:r=25:d=8", "-f", "lavfi", "-i", "sine=frequency=440:duration=8", "-shortest", ...VCODEC, "-c:a", "aac", path.join(FIX, "test-render-8s.mp4")]);
  ff(["-f", "lavfi", "-i", "testsrc2=s=360x640:r=25:d=5", ...VCODEC, "-an", path.join(FIX, "test-render-5s.mp4")]);
  ff(["-f", "lavfi", "-i", "testsrc=s=360x640:r=25:d=6", ...VCODEC, "-an", path.join(FIX, "reference-test.mp4")]);
  fs.writeFileSync(path.join(FIX, "not-a-video.mp4"), "this is text, not a video");
}

// ----------------------------------------------------------------------------- server
let server = null;
async function startServer() {
  const envs = {
    ...process.env, ACS_REPO_ROOT: ROOT, ACS_DATA_DIR: DATA, ACS_ORCHESTRATOR: USE_N8N ? "n8n" : "direct",
    ACS_ORCHESTRATOR_TOKEN: TOKEN, NEXT_TELEMETRY_DISABLED: "1", ACS_FLOW_COST_PER_CREDIT: "0.01",
  };
  delete envs.ANTHROPIC_API_KEY; // the E2E never calls a paid model
  server = spawn(process.execPath, [path.join(WEB, "node_modules/next/dist/bin/next"), "start", "-H", "127.0.0.1", "-p", String(PORT)], { cwd: WEB, env: envs, stdio: ["ignore", "pipe", "pipe"] });
  let out = "";
  server.stdout.on("data", (d) => (out += d));
  server.stderr.on("data", (d) => (out += d));
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`${BASE}/api/settings`);
      if (r.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("server did not start:\n" + out);
}
async function stopServer() {
  if (!server) return;
  const s = server;
  const exited = new Promise((r) => s.once("exit", r));
  s.kill("SIGTERM");
  const timer = setTimeout(() => s.kill("SIGKILL"), 5000);
  await exited;
  clearTimeout(timer);
  server = null;
}

// ----------------------------------------------------------------------------- http
const H = { "content-type": "application/json", "x-acs-client": "dashboard" };
async function api(method, url, body, headers = H) {
  const r = await fetch(BASE + url, { method, headers, body: body === undefined ? undefined : typeof body === "string" || body instanceof Uint8Array ? body : JSON.stringify(body) });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { status: r.status, json, text };
}
const must = async (method, url, body, expect = [200, 201]) => {
  const r = await api(method, url, body);
  if (!expect.includes(r.status)) throw new Error(`${method} ${url} → ${r.status}: ${r.text.slice(0, 800)}`);
  return r.json;
};
const upload = (url, file) => api("POST", url, fs.readFileSync(file), { "x-acs-client": "dashboard", "content-type": "application/octet-stream" });
const job = (id) => must("GET", `/api/jobs/${id}`);
const confirm = (id, extra = {}) => ({ reviewer: "E2E Test Reviewer", confirm_job_id: id, notes: "automated test on fixture data", ...extra });

function campaignData(over = {}) {
  return {
    name: "E2E Test Handbag Campaign",
    creation_mode: "original",
    performance_mode: "talking_influencer",
    video_provider: "google_flow",
    character_id: "female_02",
    is_test: true,
    brand: { name: "TESTBRAND", guidelines: ["Test fixture brand — not a real product"], colors: ["Grey"] },
    product: {
      name: "Test Mini Handbag", category: "Fashion bag", description: "Fictional test handbag used only by the automated E2E test.",
      key_features: ["3 ways to carry", "Compact size"], visual_identity: ["Rounded grey body", "Short top handle"], variants: [], price: null, where_to_buy: null,
    },
    product_images: [],
    product_image_rights: "internal_test_only",
    verified_claims: [{ claim: "Bisa dipakai 3 cara", source: "E2E fixture" }],
    prohibited_claims: ["Kulit asli / genuine leather", "Waterproof"],
    audience: { description: "Test audience", age_range: "18-30", locale: "ID", pain_points: ["One bag rarely fits work and weekends"] },
    language: "id",
    objective: "Test the pipeline",
    concept_direction: null,
    tone: ["casual"],
    cta: "Cek link di bio",
    platforms: ["TikTok"],
    duration_seconds: 16,
    aspect_ratio: "9:16",
    visual_style: "Natural smartphone video, daylight",
    script_mode: "custom",
    custom_script: "Aku lagi suka banget sama tas mini ini. Bisa dipakai 3 cara, jadi satu tas cukup buat kerja dan jalan. Cek link di bio ya!",
    exact_script: true,
    mandatory_elements: [],
    restrictions: [],
    reference_video: null,
    ...over,
  };
}

// ----------------------------------------------------------------------------- flows
async function flowA() {
  log("\nFlow A — Original · Talking Influencer · female_02 · Google Flow · Indonesian exact script");
  const c = await must("POST", "/api/campaigns", { data: { name: "E2E Test Handbag Campaign" } });
  check("campaign draft saved with only a name", c.complete === false && c.campaign.status === "draft");
  const cid = c.campaign.id;
  const up = await upload(`/api/campaigns/${cid}/images?filename=handbag.png`, path.join(FIX, "test-handbag.png"));
  check("handbag reference image uploaded", up.status === 201 && up.json.path.startsWith(`assets/products/${cid}/`), up.text);
  const saved = await must("PUT", `/api/campaigns/${cid}`, { data: campaignData({ product_images: [up.json.path] }) });
  check("complete campaign saved and brief validated", saved.complete === true && saved.campaign.brief_path === `briefs/${cid}/brief.json`, JSON.stringify(saved.issues));

  const { job: j } = await must("POST", "/api/jobs", { campaign_id: cid, ai_mode: "mock" });
  check("job created in DRAFT with female_02", j.state === "DRAFT" && j.character_id === "female_02");
  const id = j.id;

  // Brief
  await must("POST", `/api/jobs/${id}/stages/brief`, { });
  check("brief stage → BRIEF_READY", (await job(id)).job.state === "BRIEF_READY");
  const bad = await api("POST", `/api/jobs/${id}/approve/brief`, confirm("wrong-id"));
  check("approval with wrong typed job id refused", bad.status === 400);
  const noHeader = await api("POST", `/api/jobs/${id}/approve/brief`, confirm(id), { "content-type": "application/json" });
  check("mutation without x-acs-client header refused", noHeader.status === 403);
  const wrongGate = await api("POST", `/api/jobs/${id}/approve/storyboard`, confirm(id));
  check("approving the storyboard before it exists refused (409)", wrongGate.status === 409);
  await must("POST", `/api/jobs/${id}/approve/brief`, confirm(id));
  check("brief approved by a named human", (await job(id)).job.state === "BRIEF_APPROVED");

  // Script: concepts → pick → exact script
  const s1 = await must("POST", `/api/jobs/${id}/stages/script`, {});
  check("script stage halts for concept selection", s1.status === "halted" && s1.gate === "concept_selection");
  const d1 = await job(id);
  check("3+ mock concepts generated", d1.concepts?.concepts?.length >= 3);
  await must("POST", `/api/jobs/${id}/concept`, { concept_id: d1.concepts.concepts[0].concept_id });
  const s2 = await must("POST", `/api/jobs/${id}/stages/script`, {});
  const d2 = await job(id);
  check("script ready", s2.status === "done" && d2.job.state === "SCRIPT_READY");
  check("custom Indonesian script preserved word for word", d2.production.script === campaignData().custom_script);
  check("speech duration estimated", d2.script_notes?.speech?.seconds > 0 && d2.script_notes.speech.rate === 2);
  const edit = await api("PUT", `/api/jobs/${id}/script`, { script: "Tas ini paling murah se-Indonesia!", claims_used: [] });
  check("changing an exact script is refused", edit.status === 422, edit.text.slice(0, 200));
  check("script unchanged after refused edit", (await job(id)).production.script === campaignData().custom_script);
  await must("POST", `/api/jobs/${id}/approve/script`, confirm(id));

  // Storyboard
  await must("POST", `/api/jobs/${id}/stages/storyboard`, {});
  const d3 = await job(id);
  const clips = [...new Set(d3.production.storyboard.map((s) => s.clip_id))];
  check("storyboard split 16 s into 2 clips of ≤ 8 s", clips.length === 2, JSON.stringify(clips));
  check("storyboard valid per Python validator", d3.validation.valid, JSON.stringify(d3.validation.errors));
  check("every script sentence placed in a shot", d3.production.storyboard.filter((s) => s.dialogue).map((s) => s.dialogue).join(" ").replace(/\s+/g, " ") === campaignData().custom_script);
  await must("POST", `/api/jobs/${id}/approve/storyboard`, confirm(id));

  // Prompts + orchestration
  const run = await must("POST", `/api/jobs/${id}/run`, { event: "job.submitted" });
  check(`job sent through the ${USE_N8N ? "n8n" : "direct"} orchestration path`, run.mode === (USE_N8N ? "n8n" : "direct"), JSON.stringify(run).slice(0, 300));
  if (USE_N8N) {
    check("n8n execution id recorded", !!run.run?.execution_id, JSON.stringify(run.run));
    const dup = await must("POST", `/api/jobs/${id}/run`, { event: "job.submitted" });
    check("duplicate submission returns the earlier run", dup.duplicate === true || (await job(id)).runs.length >= 1);
  }
  const d4 = await job(id);
  check("job awaiting manual render", d4.job.state === "AWAITING_RENDER", d4.job.state + " " + JSON.stringify(d4.readiness.errors));
  check("Google Flow prompts compiled for each clip", d4.production.flow_prompts.length === 2 && d4.production.flow_prompts.every((c) => c.ingredients.length >= 2));
  check("prompts use only female_02 references", d4.production.flow_prompts.flatMap((c) => c.ingredients).every((p) => !p.startsWith("characters/") || p.startsWith("characters/female_02/")));
  check("continuity manifest links C01 → C02", d4.production.continuity?.[0]?.from_clip === "C01" && d4.production.continuity[0].to_clip === "C02");
  check("render sheet written", (d4.render_sheet ?? "").includes("Render sheet") && (d4.render_sheet ?? "").includes("Nothing has been rendered"));
  check("production.json status READY_FOR_MANUAL_RENDER", d4.production.status === "READY_FOR_MANUAL_RENDER", d4.production.status);
  const exp = await must("GET", `/api/jobs/${id}/export/prompts`);
  check("manual Claude prompt export contains provider template", exp.text.includes("google-flow@") && exp.text.includes("Return format"));

  // Restart: state must survive
  await stopServer();
  await startServer();
  check("state survives an app restart", (await job(id)).job.state === "AWAITING_RENDER");

  // Upload renders
  const badVid = await upload(`/api/jobs/${id}/renders?clip=C01&filename=fake.mp4&test=1`, path.join(FIX, "not-a-video.mp4"));
  check("non-video upload refused", badVid.status === 400, badVid.text.slice(0, 200));
  for (const clip of ["C01", "C02"]) {
    const r = await upload(`/api/jobs/${id}/renders?clip=${clip}&filename=${clip}.mp4&credits=20&test=1`, path.join(FIX, "test-render-8s.mp4"));
    check(`test MP4 uploaded for ${clip}`, r.status === 201, r.text.slice(0, 300));
  }
  let d5 = await job(id);
  for (let i = 0; i < 20 && d5.job.state !== "QC_PENDING"; i++) {
    await new Promise((r) => setTimeout(r, 500));
    d5 = await job(id);
  }
  check("renders attached → QC_PENDING", d5.job.state === "QC_PENDING", d5.job.state);
  check("contact sheet and first frame made", d5.renders.every((r) => r.contact_sheet && r.first_frame));
  const vid = await fetch(`${BASE}/api/files?path=${encodeURIComponent(d5.renders[0].path)}`, { headers: { range: "bytes=0-99" } });
  check("video playback supports range requests", vid.status === 206 && (await vid.arrayBuffer()).byteLength === 100);
  const trav = await api("GET", `/api/files?path=${encodeURIComponent("../../etc/passwd")}`);
  check("path traversal refused", trav.status === 403 || trav.status === 400);
  const env = await api("GET", `/api/files?path=${encodeURIComponent(".env")}`);
  check("files outside media folders are not served", env.status === 403);

  // QC
  const scores = Object.fromEntries(d5.qc_categories.map((c) => [c.check_id, 5]));
  const renderIds = d5.renders.map((r) => r.id);
  const failing = await api("POST", `/api/jobs/${id}/review`, { render_ids: renderIds, scores: { ...scores, QC01: 2 }, decision: "approve", reviewer: "E2E Test Reviewer", confirm_job_id: id });
  check("approval refused when a check fails", failing.status === 422);
  await must("POST", `/api/jobs/${id}/review`, { render_ids: renderIds, scores, decision: "draft", comments: "draft save", reviewer: "", confirm_job_id: "" });
  check("draft review saved without state change", (await job(id)).job.state === "QC_PENDING");
  const rv = await must("POST", `/api/jobs/${id}/review`, {
    render_ids: renderIds, scores, decision: "approve", comments: "E2E approval of TEST media", reviewer: "E2E Test Reviewer", confirm_job_id: id,
    defects: [{ check_id: "QC04", start_seconds: 2.0, end_seconds: 2.5, note: "test defect range" }],
  });
  check("QC approved by a person; overall score computed", rv.state === "QC_APPROVED" && rv.score.overall === 5);
  const d6 = await job(id);
  check("test job's production.json is NOT marked APPROVED", d6.production.status !== "APPROVED");

  // Delivery
  const pkg = await must("POST", `/api/jobs/${id}/package`, {});
  let d7 = await job(id);
  for (let i = 0; i < 20 && d7.job.state !== "DELIVERED"; i++) {
    await new Promise((r) => setTimeout(r, 500));
    d7 = await job(id);
  }
  check("package built and job DELIVERED", d7.job.state === "DELIVERED", JSON.stringify(pkg).slice(0, 300));
  const zip = await fetch(`${BASE}/api/jobs/${id}/package/download`);
  const buf = Buffer.from(await zip.arrayBuffer());
  const zipPath = path.join(SANDBOX, `${id}.zip`);
  fs.writeFileSync(zipPath, buf);
  const listing = execFileSync("python3", ["-c", "import sys,zipfile;print('\\n'.join(zipfile.ZipFile(sys.argv[1]).namelist()))", zipPath]).toString().split("\n");
  check("ZIP downloaded", zip.status === 200 && buf.length > 1000);
  for (const f of ["brief.json", "script.md", "storyboard.json", "prompts/provider-prompts.json", "character-manifest.json", "asset-manifest.json", "provider.json", "qc-review.json", "history.json", "DELIVERY.md", "manifest.json"]) {
    check(`package contains ${f}`, listing.includes(f));
  }
  check("package contains the approved takes", listing.filter((f) => f.startsWith("video/C0")).length === 2);
  check("package contains the assembled edit", listing.includes(`video/${id}_edit.mp4`), JSON.stringify(d7.package?.manifest?.edit));
  check("no character reference images in the package", !listing.some((f) => /\.(jpe?g|png)$/i.test(f)));
  const manifest = JSON.parse(execFileSync("python3", ["-c", "import sys,zipfile;print(zipfile.ZipFile(sys.argv[1]).read('manifest.json').decode())", zipPath]).toString());
  check("package stamped TEST / not for commercial delivery", manifest.is_test === true && manifest.commercial_delivery_allowed === false);
  const hist = d7.events.map((e) => e.to_state);
  check("history records every state", ["BRIEF_READY", "BRIEF_APPROVED", "SCRIPT_READY", "SCRIPT_APPROVED", "STORYBOARD_READY", "STORYBOARD_APPROVED", "PROMPTS_READY", "AWAITING_RENDER", "RENDER_UPLOADED", "QC_PENDING", "QC_APPROVED", "DELIVERED"].every((s) => hist.includes(s)));
  check("approval history names the reviewer", d7.approvals.filter((a) => a.reviewer === "E2E Test Reviewer").length >= 4);
  check("credits recorded and cost labelled estimate", d7.usage.some((u) => u.unit_type === "credits" && u.kind === "actual") && d7.usage.some((u) => u.kind === "estimate"));
  return id;
}

async function flowB() {
  log("\nFlow B — Reference Guided · Fashion Showcase · Seedance (smaller)");
  const c = await must("POST", "/api/campaigns", { data: { name: "E2E Test Reference Campaign" } });
  const cid = c.campaign.id;
  const img = await upload(`/api/campaigns/${cid}/images?filename=bag.png`, path.join(FIX, "test-handbag.png"));
  const ref = await upload(`/api/campaigns/${cid}/reference-video?filename=ref.mp4`, path.join(FIX, "reference-test.mp4"));
  check("authorized reference video uploaded", ref.status === 201, ref.text.slice(0, 200));
  const data = campaignData({
    name: "E2E Test Reference Campaign", creation_mode: "reference_guided", performance_mode: "fashion_showcase", video_provider: "seedance",
    duration_seconds: 10, script_mode: "ai_generated", custom_script: null, product_images: [img.json.path],
    reference_video: { path: ref.json.path, rights: "internal_test_only", rights_note: "E2E generated test video" },
  });
  const saved = await must("PUT", `/api/campaigns/${cid}`, { data });
  check("reference campaign complete", saved.complete, JSON.stringify(saved.issues));
  const { job: j } = await must("POST", "/api/jobs", { campaign_id: cid, ai_mode: "mock" });
  const id = j.id;
  const r1 = await must("POST", `/api/jobs/${id}/run`, { event: "job.submitted" });
  let d = await job(id);
  check("frames extracted and manifest valid", d.manifest?.frames?.length >= 5);
  check("mock reference analysis labels unknowns", d.analysis?.unknowns?.some((u) => /audio/i.test(u)));
  check("run stops at brief approval", d.job.state === "BRIEF_READY", d.job.state + JSON.stringify(r1).slice(0, 300));
  await must("POST", `/api/jobs/${id}/approve/brief`, confirm(id));
  await must("POST", `/api/jobs/${id}/stages/script`, {});
  d = await job(id);
  await must("POST", `/api/jobs/${id}/concept`, { concept_id: d.concepts.concepts[0].concept_id });
  check("reference concept K00 offered", d.concepts.concepts[0].concept_id === "K00");
  await must("POST", `/api/jobs/${id}/stages/script`, {});
  d = await job(id);
  check("fashion showcase has no dialogue", d.production.script === "" && d.job.state === "SCRIPT_READY");
  await must("POST", `/api/jobs/${id}/approve/script`, confirm(id));
  await must("POST", `/api/jobs/${id}/stages/storyboard`, {});
  d = await job(id);
  check("storyboard has no dialogue", d.production.storyboard.every((s) => s.dialogue === null));
  await must("POST", `/api/jobs/${id}/approve/storyboard`, confirm(id));
  await must("POST", `/api/jobs/${id}/run`, { event: "job.submitted" });
  d = await job(id);
  check("Seedance prompts compiled (1 clip ≤ 10 s)", d.production.seedance_prompts.length === 1 && d.production.seedance_prompts[0].generation_mode === "image_to_video");
  check("not ready to render until the first frame exists", d.job.state === "PROMPTS_READY" && d.readiness.errors.some((e) => e.includes("_first")), d.job.state);
  const ff1 = await upload(`/api/jobs/${id}/frames?clip=C01&filename=first.png`, path.join(FIX, "first-frame.png"));
  check("first frame uploaded", ff1.status === 201, ff1.text.slice(0, 200));
  await must("POST", `/api/jobs/${id}/stages/await_render`, {});
  d = await job(id);
  check("AWAITING_RENDER after first frame", d.job.state === "AWAITING_RENDER", JSON.stringify(d.readiness.errors));
  const up = await upload(`/api/jobs/${id}/renders?clip=C01&filename=C01.mp4&credits=10&test=1`, path.join(FIX, "test-render-5s.mp4"));
  check("Seedance test render uploaded", up.status === 201, up.text.slice(0, 200));
  for (let i = 0; i < 20 && d.job.state !== "QC_PENDING"; i++) {
    await new Promise((r) => setTimeout(r, 500));
    d = await job(id);
  }
  check("technical check flags the 5 s take vs 10 s plan", d.renders[0].probe?.technical_checks?.some((t) => t.includes("length")));
  const cats = d.qc_categories.map((c) => c.check_id);
  check("lip-sync and dialogue checks are N/A for fashion showcase", !cats.includes("QC07") && !cats.includes("QC08"));
  const scores = Object.fromEntries(cats.map((k) => [k, 4]));
  const bad = await api("POST", `/api/jobs/${id}/review`, { render_ids: [d.renders[0].id], scores: { ...scores, QC10: 5, QC01: "na" }, decision: "approve", reviewer: "E2E Test Reviewer", confirm_job_id: id });
  check("N/A refused for an applicable check", bad.status === 400);
  const rej = await must("POST", `/api/jobs/${id}/review`, { render_ids: [d.renders[0].id], scores: { ...scores, QC10: 5, QC05: 2 }, decision: "reject", comments: "bag shape wrong (test)", reviewer: "E2E Test Reviewer", confirm_job_id: id });
  check("rejected take returns job to AWAITING_RENDER", rej.state === "AWAITING_RENDER");
  await upload(`/api/jobs/${id}/renders?clip=C01&filename=C01b.mp4&test=1`, path.join(FIX, "test-render-5s.mp4"));
  d = await job(id);
  for (let i = 0; i < 20 && d.job.state !== "QC_PENDING"; i++) { await new Promise((r) => setTimeout(r, 500)); d = await job(id); }
  const take = d.renders.find((r) => r.attempt === 2);
  const ok = await must("POST", `/api/jobs/${id}/review`, { render_ids: [take.id], scores: { ...scores, QC10: 5 }, decision: "approve", reviewer: "E2E Test Reviewer", confirm_job_id: id });
  check("second take approved", ok.state === "QC_APPROVED");
  await must("POST", `/api/jobs/${id}/package`, {});
  for (let i = 0; i < 20 && d.job.state !== "DELIVERED"; i++) { await new Promise((r) => setTimeout(r, 500)); d = await job(id); }
  check("Reference Guided job delivered as TEST package", d.job.state === "DELIVERED" && d.package?.is_test === true);
  const dl = await fetch(`${BASE}/api/jobs/${id}/package/download`);
  check("package downloadable", dl.status === 200 && (await dl.arrayBuffer()).byteLength > 1000);
}

async function negativeOrchestrator() {
  log("\nOrchestrator auth and contract");
  const r1 = await api("POST", "/api/orchestrator/ping", "{}", { "content-type": "application/json" });
  check("callback without token refused", r1.status === 403);
  const r2 = await api("POST", "/api/orchestrator/ping", "{}", { "content-type": "application/json", "x-acs-token": "wrong-token-wrong-token" });
  check("callback with wrong token refused", r2.status === 403);
  const r3 = await api("POST", "/api/orchestrator/ping", "{}", { "content-type": "application/json", "x-acs-token": TOKEN, "x-acs-execution-id": "123" });
  check("callback with token accepted", r3.status === 200 && r3.json.execution_id === "123");
  const settings = await must("GET", "/api/settings");
  check("settings never return secret values", !JSON.stringify(settings).includes(TOKEN));
  check("Anthropic mode disabled without key and budget", settings.ai.modes.anthropic.available === false);
}

async function flowErrors(campaignId) {
  log("\nn8n error handling, safe retry and forged webhooks");
  const N8N = (/^N8N_HOST_PORT=(\d+)$/m.exec(n8nEnv)?.[1]) ?? "5678";
  const forged = await fetch(`http://127.0.0.1:${N8N}/webhook/acs-original-creation`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ job_id: "e2e-test-handbag-campaign-01", idempotency_key: "e2e-test-handbag-campaign-01:job.submitted:v1" }) });
  const forgedBody = await forged.text();
  await new Promise((r) => setTimeout(r, 1500));
  const target = await job("e2e-test-handbag-campaign-01");
  check("forged webhook without token gets no result and touches no job", !forgedBody.includes("execution_id") && target.job.state === "DELIVERED" && !target.events.some((e) => e.to_state === "FAILED"), forgedBody.slice(0, 200));
  const { job: j } = await must("POST", "/api/jobs", { campaign_id: campaignId, ai_mode: "anthropic" });
  const id = j.id;
  await must("POST", `/api/jobs/${id}/run`, { event: "job.submitted" });
  await must("POST", `/api/jobs/${id}/approve/brief`, confirm(id));
  const fail = await api("POST", `/api/jobs/${id}/run`, { event: "job.submitted" });
  check("stage failure inside n8n is reported to the dashboard", fail.status === 502, `${fail.status} ${fail.text.slice(0, 200)}`);
  let d = await job(id);
  for (let i = 0; i < 20 && !(d.job.state === "FAILED" && d.runs.some((r) => r.status === "failed" && r.last_error)); i++) { await new Promise((r) => setTimeout(r, 500)); d = await job(id); }
  check("job marked FAILED with the error recorded", d.job.state === "FAILED" && /Anthropic mode is not available/.test(d.job.last_error ?? ""), d.job.last_error);
  check("failed run keeps its n8n execution id", d.runs.some((r) => r.status === "failed" && r.execution_id), JSON.stringify(d.runs.map((r) => [r.status, r.execution_id])));
  check("FAILED event carries the execution id", d.events.some((e) => e.to_state === "FAILED" && e.execution_id));
  const e2 = d.job.last_error;
  await new Promise((r) => setTimeout(r, 2000));
  check("error workflow (E) reported the failure to the app", (await job(id)).job.last_error !== null && e2 !== undefined);
  await must("PUT", `/api/jobs/${id}/settings`, { ai_mode: "mock" });
  const retry = await must("POST", `/api/jobs/${id}/retry`, {});
  d = await job(id);
  check("retry returns the job to where it failed and resubmits", d.job.retry_count === 1 && d.job.state === "BRIEF_APPROVED" && retry.resubmitted?.mode === "n8n", `${d.job.state} ${d.job.retry_count}`);
  check("history preserved across failure and retry", ["BRIEF_APPROVED", "FAILED"].every((s) => d.events.some((e) => e.to_state === s)) && d.events.filter((e) => e.to_state === "BRIEF_APPROVED").length >= 2);
  const again = await api("POST", `/api/jobs/${id}/retry`, {});
  check("retry refused when the job is not failed", again.status === 409);
}

async function main() {
  log(`Sandbox: ${SANDBOX}`);
  buildSandbox();
  await startServer();
  try {
    await negativeOrchestrator();
    await flowA();
    await flowB();
    if (USE_N8N) await flowErrors("e2e-test-handbag-campaign");
  } catch (e) {
    failures.push(`aborted: ${e.message}`);
    log(`\n  ✗ aborted: ${e.stack}`);
  } finally {
    await stopServer();
    if (!KEEP && failures.length === 0) fs.rmSync(SANDBOX, { recursive: true, force: true });
  }
  log(`\n${passed} passed, ${failures.length} failed${failures.length ? `\n- ${failures.join("\n- ")}` : ""}`);
  if (failures.length) log(`(sandbox kept at ${SANDBOX})`);
  process.exit(failures.length ? 1 : 0);
}
main();
