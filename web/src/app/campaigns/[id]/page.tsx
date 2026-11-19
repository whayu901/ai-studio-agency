"use client";
import Link from "next/link";
import { use, useState } from "react";
import { useRouter } from "next/navigation";
import { CampaignForm } from "@/components/CampaignForm";
import { PageHeader } from "@/components/Shell";
import { Badge, Button, Card, ErrorBox, Loading, Notice, StateBadge, inputCls } from "@/components/ui";
import { api, fmtDate } from "@/lib/client";
import { useData } from "@/lib/useData";

export default function CampaignPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const c = useData<any>(`/api/campaigns/${id}`);
  const chars = useData<any>("/api/characters");
  const settings = useData<any>("/api/settings");
  const [mode, setMode] = useState("mock");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if (c.loading || chars.loading) return <Loading />;
  if (c.error) return <ErrorBox error={c.error} onRetry={c.reload} />;
  if (chars.error) return <ErrorBox error={chars.error} />;
  const camp = c.data.campaign;
  const anthropic = settings.data?.ai?.modes?.anthropic;

  async function createJob() {
    setBusy(true);
    setErr(null);
    try {
      const r = await api("/api/jobs", { body: { campaign_id: id, ai_mode: mode } });
      router.push(`/jobs/${r.job.id}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader title={camp.name} subtitle={<span className="flex flex-wrap items-center gap-2"><code>{camp.id}</code><Badge tone={camp.status === "active" ? "ok" : "warn"}>{camp.status === "active" ? "complete" : "draft"}</Badge>{camp.is_test && <Badge>test data</Badge>}{camp.brief_path && <code className="text-xs text-muted">{camp.brief_path}</code>}</span>} />
      <Card className="mb-6" title="Production jobs" subtitle="Each job snapshots this campaign's brief and keeps its own character, history and approvals.">
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-sm font-medium">AI execution mode
            <select className={inputCls} value={mode} onChange={(e) => setMode(e.target.value)}>
              <option value="mock">Mock — deterministic templates, no AI, free</option>
              <option value="manual">Manual Claude — export prompt, paste JSON back</option>
              <option value="anthropic" disabled={!anthropic?.available}>Anthropic API — paid{anthropic?.available ? "" : ` (${anthropic?.reason ?? "unavailable"})`}</option>
            </select>
          </label>
          <Button variant="primary" busy={busy} disabled={camp.status !== "active"} onClick={createJob} title={camp.status !== "active" ? "Complete and save the campaign first" : undefined}>Create production job</Button>
        </div>
        {err && <div className="mt-3"><Notice tone="bad">{err}</Notice></div>}
        {c.data.jobs.length > 0 && (
          <ul className="mt-4 flex flex-col divide-y divide-line text-sm">
            {c.data.jobs.map((j: any) => (
              <li key={j.id} className="flex flex-wrap items-center gap-3 py-2">
                <Link href={`/jobs/${j.id}`} className="font-medium hover:underline">{j.id}</Link>
                <StateBadge state={j.state} />
                <Badge>{j.ai_mode}</Badge>
                <span className="text-xs text-muted">{fmtDate(j.updated_at)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <CampaignForm id={id} initial={camp.data} characters={chars.data.characters} onSaved={() => c.reload()} />
    </>
  );
}
