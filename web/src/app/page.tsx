"use client";
import Link from "next/link";
import { PageHeader } from "@/components/Shell";
import { Badge, Card, Empty, ErrorBox, Loading, Stat, StateBadge } from "@/components/ui";
import { fmtDate } from "@/lib/client";
import { useData } from "@/lib/useData";

export default function DashboardPage() {
  const { data, error, loading, reload } = useData<any>("/api/dashboard", 10000);
  if (loading) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  const t = data.totals;
  const costs = (data.usage as any[]).filter((u) => u.amount != null);
  const credits = (data.usage as any[]).filter((u) => u.unit_type === "credits" && u.kind === "actual");
  return (
    <>
      <PageHeader
        title="Dashboard"
        subtitle="Planning, manual rendering and human review for virtual-influencer ads. Nothing here renders video or publishes anything."
        actions={<Link href="/campaigns/new" className="rounded-lg bg-accent px-3.5 py-2 text-sm font-medium text-white hover:opacity-90">New campaign</Link>}
      />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        <Stat label="Campaigns" value={t.campaigns} />
        <Stat label="Active jobs" value={t.active_jobs} />
        <Stat label="Awaiting approval" value={t.awaiting_approval} tone={t.awaiting_approval ? "warn" : undefined} />
        <Stat label="Awaiting render" value={t.awaiting_render} hint="manual, in Flow / Dreamina" />
        <Stat label="Delivered" value={t.delivered} tone="ok" hint={t.test_jobs ? `${t.test_jobs} test job(s) total` : undefined} />
        <Stat label="Failed" value={t.failed} tone={t.failed ? "bad" : undefined} />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Card title="Waiting for you" className="lg:col-span-1">
          {data.awaiting.length === 0 ? (
            <p className="text-sm text-muted">No approvals pending.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {data.awaiting.map((j: any) => (
                <li key={j.id} className="flex items-center justify-between gap-2">
                  <Link href={`/jobs/${j.id}`} className="truncate text-sm font-medium hover:underline">{j.id}</Link>
                  <span className="flex gap-1">{j.is_test && <Badge>test</Badge>}<StateBadge state={j.state} label={j.label} /></span>
                </li>
              ))}
            </ul>
          )}
          {data.failed.length > 0 && (
            <div className="mt-5 border-t border-line pt-4">
              <h3 className="mb-2 text-sm font-semibold text-bad">Failed jobs</h3>
              <ul className="flex flex-col gap-2 text-sm">
                {data.failed.map((f: any) => (
                  <li key={f.id}>
                    <Link href={`/jobs/${f.id}?tab=history`} className="font-medium hover:underline">{f.id}</Link>
                    <p className="text-xs text-muted">{f.last_error}</p>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>

        <Card title="Recent activity" className="lg:col-span-2">
          {data.recent.length === 0 ? (
            <Empty title="No activity yet">Create a campaign, then a production job.</Empty>
          ) : (
            <ol className="flex flex-col divide-y divide-line">
              {data.recent.map((e: any) => (
                <li key={e.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm">
                  <span className="w-36 shrink-0 text-xs text-muted">{fmtDate(e.ts)}</span>
                  <Link href={`/jobs/${e.job_id}`} className="font-medium hover:underline">{e.job_id}</Link>
                  <StateBadge state={e.to_state} />
                  <span className="min-w-0 flex-1 truncate text-muted" title={e.reason}>{e.reason}</span>
                  <Badge tone={e.actor_type === "human" ? "ok" : e.actor_type === "orchestrator" ? "info" : "neutral"}>{e.actor_name ?? e.actor_type} · {e.source}</Badge>
                </li>
              ))}
            </ol>
          )}
        </Card>
      </div>

      <Card title="Usage and estimated costs" className="mt-6" subtitle="Credits are what people reported after rendering. Money amounts are estimates unless a provider reported actual usage.">
        {costs.length === 0 && credits.length === 0 ? (
          <p className="text-sm text-muted">No usage recorded yet. Mock and manual modes cost nothing in this app.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted"><tr><th className="py-1">Provider</th><th>Kind</th><th>Units</th><th>Amount</th></tr></thead>
            <tbody>
              {(data.usage as any[]).map((u, i) => (
                <tr key={i} className="border-t border-line">
                  <td className="py-1.5">{u.provider}</td>
                  <td><Badge tone={u.kind === "estimate" ? "warn" : "ok"}>{u.kind}</Badge></td>
                  <td>{u.units != null ? `${u.units} ${u.unit_type ?? ""}` : "—"}</td>
                  <td>{u.amount != null ? `${Number(u.amount).toFixed(2)} ${u.currency ?? ""}` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
}
