/**
 * Delivery packages (Phase 9). Built only for QC_APPROVED jobs, from an allow-list of files the
 * app wrote itself. Character reference images and product photos are NOT copied; they appear in
 * the asset manifest by path and SHA-256 only. A test job's package is stamped TEST everywhere.
 */
import fs from "node:fs";
import path from "node:path";
import { env } from "./env";
import { conflict, notFound } from "./errors";
import { repoPath, sha256File, writeJsonFile, writeTextFile } from "./files";
import { loadContext, type Json } from "./pipeline/context";
import { imagePromptsRel, renderSheetRel, scriptNotesRel, productionExtrasRel } from "./pipeline/stages";
import { service } from "./python";
import { providerSummary } from "./providers/video";
import {
  getJob, insertPackage, latestPackage, listApprovals, listEvents, listRenders, listReviews, listUsage, transition,
} from "./repo";
import type { Actor } from "./states";

function nextVersion(jobId: string): number {
  const dir = repoPath(`outputs/${jobId}`);
  const used = fs.existsSync(dir) ? fs.readdirSync(dir).map((f) => /^package_v(\d+)$/.exec(f)?.[1]).filter(Boolean).map(Number) : [];
  return (used.length ? Math.max(...used) : 0) + 1;
}

export async function buildPackage(jobId: string, actor: Actor) {
  const job = getJob(jobId);
  if (job.state !== "QC_APPROVED") throw conflict(`a package is built after QC approval; the job is ${job.state}`);
  const ctx = await loadContext(jobId);
  const p = ctx.production;
  const review = listReviews(jobId).find((r) => r.decision === "approve");
  if (!review) throw conflict("no approving QC review found");
  const takes = listRenders(jobId).filter((r) => review.render_ids.includes(r.id));

  const v = nextVersion(jobId);
  const dirRel = `outputs/${jobId}/package_v${String(v).padStart(2, "0")}`;
  const dir = repoPath(dirRel);
  fs.mkdirSync(path.join(dir, "video"), { recursive: true });
  fs.mkdirSync(path.join(dir, "prompts"), { recursive: true });
  const files: string[] = [];
  const add = (rel: string) => files.push(rel);
  const TEST = job.is_test ? "TEST PACKAGE — fixture data and test media, NOT for commercial delivery. " : "";

  // Videos: the approved takes, plus one assembled edit (delivery size, on-screen text, AI label).
  for (const t of takes) {
    const name = `video/${t.clip_id}_take${String(t.attempt).padStart(2, "0")}.mp4`;
    fs.copyFileSync(repoPath(t.path), path.join(dir, name));
    add(name);
  }
  let edit: Json = { built: false, reason: "" };
  try {
    const out = `${dirRel}/video/${jobId}_edit.mp4`;
    await service(["assemble", job.production_path, "--output", out, ...takes.map((t) => `--take=${t.clip_id}=${t.path}`)], 600_000);
    add(`video/${jobId}_edit.mp4`);
    edit = { built: true, file: `video/${jobId}_edit.mp4`, tool: "tools/assemble.py" };
  } catch (e) {
    edit = { built: false, reason: e instanceof Error ? e.message.slice(0, 500) : String(e) };
  }

  const copyIf = (src: string, dest: string) => {
    if (fs.existsSync(repoPath(src))) {
      fs.copyFileSync(repoPath(src), path.join(dir, dest));
      add(dest);
    }
  };
  copyIf(p.brief, "brief.json");
  copyIf(job.production_path, "production.json");
  copyIf(renderSheetRel(jobId), "prompts/render-sheet.md");
  copyIf(imagePromptsRel(jobId), "prompts/image-prompts.json");
  copyIf(scriptNotesRel(jobId), "script-notes.json");
  copyIf(productionExtrasRel(jobId), "prompts/motion-and-audio.json");
  if (job.analysis_path) copyIf(job.analysis_path, "reference-analysis.json");

  const lang = ctx.brief.script.language;
  writeTextFile(path.join(dir, "script.md"), `# Approved script (${lang})\n\n${TEST}\n\n${p.script || "(no dialogue — " + job.performance_mode + ")"}\n\nClaims used (verbatim from the brief):\n${(p.claims_used as string[]).map((c) => `- ${c}`).join("\n") || "- none"}\n`);
  add("script.md");
  writeJsonFile(path.join(dir, "storyboard.json"), { job_id: jobId, storyboard: p.storyboard, continuity: p.continuity ?? [] });
  add("storyboard.json");
  writeJsonFile(path.join(dir, "prompts/provider-prompts.json"), { provider: job.video_provider, prompt_versions: p.prompt_versions, flow_prompts: p.flow_prompts, seedance_prompts: p.seedance_prompts ?? [] });
  add("prompts/provider-prompts.json");

  const ch = ctx.character;
  writeJsonFile(path.join(dir, "character-manifest.json"), {
    character_id: ch.character_id,
    display_name: ch.display_name,
    approved_appearance_description: ch.physical_description,
    wardrobe: ch.styling_rules?.default_wardrobe ?? [],
    accessories: ch.styling_rules?.accessories ?? [],
    identity_preservation: ch.identity_consistency_instructions ?? [],
    disallowed_variations: ch.disallowed_variations ?? [],
    commercial_use: ch.commercial_use,
    note: "AI-generated virtual character, not a real person's endorsement. Reference images are private and not included.",
  });
  add("character-manifest.json");

  const assets = (p.reference_assets as Json[]).map((a) => {
    const abs = repoPath(a.path);
    return { ...a, sha256: fs.existsSync(abs) ? sha256File(abs) : null, included_in_package: false };
  });
  writeJsonFile(path.join(dir, "asset-manifest.json"), { note: "Inputs used for rendering. Not included in the package (private or customer-owned).", assets });
  add("asset-manifest.json");

  const providers = providerSummary(ctx.configs).find((x) => x.id === job.video_provider);
  writeJsonFile(path.join(dir, "provider.json"), { provider: providers, rendering: "manual (by a person in the provider's web UI)", takes: takes.map((t) => ({ clip_id: t.clip_id, attempt: t.attempt, sha256: t.sha256, probe: t.probe, test_media: t.is_test_media })) });
  add("provider.json");
  writeJsonFile(path.join(dir, "qc-review.json"), review);
  add("qc-review.json");
  writeJsonFile(path.join(dir, "history.json"), { events: listEvents(jobId).reverse(), approvals: listApprovals(jobId), usage: listUsage(jobId) });
  add("history.json");

  const delivery = [
    `# Delivery package: ${jobId} (v${v})`, "",
    job.is_test ? "> **TEST PACKAGE.** Fixture data and test media. Never deliver or publish this commercially." : "> Prepared locally. **Nothing has been uploaded or posted.** Post by hand.",
    "",
    `- Character: \`${job.character_id}\` (AI-generated virtual character) · Mode: ${job.creation_mode} / ${job.performance_mode}`,
    `- Provider: ${job.video_provider} (manual render) · Takes: ${takes.map((t) => `${t.clip_id} a${t.attempt}`).join(", ")}`,
    `- QC: overall ${review.overall} · approved by ${review.reviewer} on ${review.ts.slice(0, 10)}${job.is_test ? " (test approval)" : ""}`,
    `- Edit: ${edit.built ? edit.file : `not built (${edit.reason})`}`, "",
    "## Before posting (by hand)", "",
    "- [ ] Watch the final video once more with sound",
    "- [ ] Switch on the platform's AI-generated content label",
    "- [ ] Add the paid / affiliate disclosure the platform requires",
    "- [ ] Do not add claims, prices or testimonials that are not in this package", "",
  ];
  writeTextFile(path.join(dir, "DELIVERY.md"), delivery.join("\n"));
  add("DELIVERY.md");

  const manifest = {
    package: `${jobId}_package_v${String(v).padStart(2, "0")}`,
    is_test: job.is_test,
    commercial_delivery_allowed: !job.is_test,
    created_at: new Date().toISOString(),
    built_by: actor.name ?? actor.type,
    files: files.map((f) => ({ path: f, sha256: sha256File(path.join(dir, f)), bytes: fs.statSync(path.join(dir, f)).size })),
    excluded: ["character reference images", "product photos", "experiment log", "secrets"],
    edit,
  };
  writeJsonFile(path.join(dir, "manifest.json"), manifest);
  const zipRel = `outputs/${jobId}/${manifest.package}.zip`;
  await service(["zip", zipRel, dirRel, ...files, "manifest.json"]);
  insertPackage(jobId, dirRel, zipRel, manifest, job.is_test);
  return { dir: dirRel, zip: zipRel, manifest };
}

export function deliveryManifest(jobId: string) {
  const pkg = latestPackage(jobId);
  if (!pkg) throw notFound("no package yet");
  return pkg;
}

export function markDelivered(jobId: string, actor: Actor) {
  const pkg = latestPackage(jobId);
  if (!pkg) throw conflict("build the package first");
  return transition(jobId, "DELIVERED", actor, `package ${String((pkg.manifest as Json).package)} ready to download${pkg.is_test ? " (TEST)" : ""}; nothing was published`, "QC_APPROVED");
}

/** Reusable prompt pack / n8n templates for resale (e.g. Gumroad). No customer or character assets. */
export async function buildTemplatePack() {
  const root = env().repoRoot;
  const stamp = new Date().toISOString().slice(0, 10);
  const dir = path.join(env().dataDir, "exports", `template-pack-${stamp}`);
  fs.rmSync(dir, { recursive: true, force: true });
  const files: string[] = [];
  const copyDir = (sub: string, filter: (f: string) => boolean) => {
    const src = path.join(root, sub);
    if (!fs.existsSync(src)) return;
    for (const f of fs.readdirSync(src).filter(filter)) {
      fs.mkdirSync(path.join(dir, sub), { recursive: true });
      fs.copyFileSync(path.join(src, f), path.join(dir, sub, f));
      files.push(`${sub}/${f}`);
    }
  };
  copyDir("prompts", (f) => f.endsWith(".md"));
  copyDir("schemas", (f) => f.endsWith(".json"));
  copyDir("n8n/workflows", (f) => f.endsWith(".json"));
  for (const c of ["google-flow.json", "seedance.json", "qc.json"]) {
    fs.mkdirSync(path.join(dir, "config"), { recursive: true });
    fs.copyFileSync(path.join(root, "config", c), path.join(dir, "config", c));
    files.push(`config/${c}`);
  }
  const readme = [
    "# AI Creative Studio — prompt & workflow template pack", "",
    `Exported ${stamp}. Contains prompt templates, JSON Schemas, provider/QC configs and n8n workflow templates.`,
    "It contains no customer briefs, no character profiles or reference images, no renders and no credentials.",
    "Configs hold unverified starter values: check them against your own Google Flow / Dreamina account.",
  ].join("\n");
  fs.writeFileSync(path.join(dir, "README.md"), readme + "\n");
  files.push("README.md");
  const zip = path.join(env().dataDir, "exports", `template-pack-${stamp}.zip`);
  await service(["zip", zip, dir, ...files]);
  return { zip, files };
}

