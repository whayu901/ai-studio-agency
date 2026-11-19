"use client";
import Link from "next/link";
import { PageHeader } from "@/components/Shell";
import { Badge, Empty, ErrorBox, Loading, StateBadge } from "@/components/ui";
import { fmtDate } from "@/lib/client";
import { useData } from "@/lib/useData";

export default function JobsPage() {
  const { data, error, loading, reload } = useData<any>("/api/jobs", 8000);
  return (
    <>
      <PageHeader title="Production jobs" subtitle="Every job moves through the same validated states. Approvals are always made by a named person." />
      {loading ? <Loading /> : error ? <ErrorBox error={error} onRetry={reload} /> : data.jobs.length === 0 ? (
        <Empty title="No jobs yet">Open a complete campaign and click “Create production job”.</Empty>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-line bg-panel">
          <table className="w-full min-w-[900px] text-sm">
            <thead className="text-left text-xs text-muted"><tr className="border-b border-line">
              <th className="px-4 py-2">Job</th><th>Campaign</th><th>Character</th><th>Provider</th><th>Mode</th><th>Status</th><th>Retries</th><th>Created</th><th className="pr-4">Updated</th></tr></thead>
            <tbody>
              {data.jobs.map((j: any) => (
                <tr key={j.id} className="border-b border-line last:border-0 hover:bg-panel-2">
                  <td className="px-4 py-2.5"><Link href={`/jobs/${j.id}`} className="font-medium hover:underline">{j.id}</Link>{j.is_test && <span className="ml-2"><Badge>test</Badge></span>}</td>
                  <td>{j.campaign_name}</td>
                  <td>{j.character_id}</td>
                  <td>{j.video_provider === "seedance" ? "Seedance" : "Google Flow"}</td>
                  <td className="text-xs">{j.creation_mode === "reference_guided" ? "Reference" : "Original"} · {j.performance_mode.replace("_", " ")} · <Badge>{j.ai_mode}</Badge></td>
                  <td><StateBadge state={j.state} label={j.state_label} />{j.last_error && <div className="mt-0.5 max-w-56 truncate text-xs text-bad" title={j.last_error}>{j.last_error}</div>}</td>
                  <td>{j.retry_count}</td>
                  <td className="text-xs text-muted">{fmtDate(j.created_at)}</td>
                  <td className="pr-4 text-xs text-muted">{fmtDate(j.updated_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
