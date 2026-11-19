"use client";
import Link from "next/link";
import { PageHeader } from "@/components/Shell";
import { Badge, Empty, ErrorBox, Loading } from "@/components/ui";
import { fmtDate } from "@/lib/client";
import { useData } from "@/lib/useData";

const PM: Record<string, string> = { talking_influencer: "Talking", fashion_showcase: "Showcase", voiceover_showcase: "Voice-over" };

export default function CampaignsPage() {
  const { data, error, loading, reload } = useData<any>("/api/campaigns");
  return (
    <>
      <PageHeader title="Campaigns" subtitle="A campaign holds the product facts, claims, character and format. Jobs are created from it."
        actions={<Link href="/campaigns/new" className="rounded-lg bg-accent px-3.5 py-2 text-sm font-medium text-white hover:opacity-90">New campaign</Link>} />
      {loading ? <Loading /> : error ? <ErrorBox error={error} onRetry={reload} /> : data.campaigns.length === 0 ? (
        <Empty title="No campaigns yet">Start with <Link className="text-accent underline" href="/campaigns/new">a new campaign</Link>, or import an existing CLI production on the Settings page.</Empty>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-line bg-panel">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted"><tr className="border-b border-line">
              <th className="px-4 py-2">Campaign</th><th>Status</th><th>Mode</th><th>Character</th><th>Provider</th><th>Length</th><th>Updated</th></tr></thead>
            <tbody>
              {data.campaigns.map((c: any) => (
                <tr key={c.id} className="border-b border-line last:border-0 hover:bg-panel-2">
                  <td className="px-4 py-2.5"><Link href={`/campaigns/${c.id}`} className="font-medium hover:underline">{c.name}</Link><div className="text-xs text-muted">{c.id}</div></td>
                  <td><span className="flex gap-1"><Badge tone={c.status === "active" ? "ok" : "warn"}>{c.status === "active" ? "complete" : "draft"}</Badge>{c.is_test && <Badge>test</Badge>}</span></td>
                  <td>{c.creation_mode === "reference_guided" ? "Reference" : "Original"} · {PM[c.performance_mode] ?? c.performance_mode}</td>
                  <td>{c.character_id || "—"}</td>
                  <td>{c.video_provider === "seedance" ? "Seedance" : "Google Flow"}</td>
                  <td>{c.duration_seconds}s</td>
                  <td className="pr-4 text-xs text-muted">{fmtDate(c.updated_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
