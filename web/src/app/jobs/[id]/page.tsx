"use client";
import Link from "next/link";
import { use, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { PageHeader } from "@/components/Shell";
import { Badge, ErrorBox, Loading, Notice, StateBadge, Tabs } from "@/components/ui";
import { JobProvider, useJob } from "@/components/job/common";
import { BriefTab, OverviewTab, ScriptTab, Stepper, StoryboardTab } from "@/components/job/tabs-a";
import { DeliveryTab, HistoryTab, PromptsTab, RenderTab } from "@/components/job/tabs-b";
import { useData } from "@/lib/useData";

const TABS = [
  { id: "overview", label: "Overview" }, { id: "brief", label: "Brief" }, { id: "script", label: "Script" }, { id: "storyboard", label: "Storyboard" },
  { id: "prompts", label: "Prompt Studio" }, { id: "render", label: "Render & QC" }, { id: "delivery", label: "Delivery" }, { id: "history", label: "History" },
];
const WAITING: Record<string, string> = { BRIEF_READY: "brief", SCRIPT_READY: "script", STORYBOARD_READY: "storyboard", PROMPTS_READY: "prompts", AWAITING_RENDER: "render", RENDER_UPLOADED: "render", QC_PENDING: "render", QC_APPROVED: "delivery", FAILED: "history" };

function Body({ tab, go }: { tab: string; go: (t: string) => void }) {
  const { d, flash } = useJob();
  const j = d.job;
  return (
    <>
      <PageHeader title={j.id} subtitle={<span className="flex flex-wrap items-center gap-2">
        <Link href={`/campaigns/${j.campaign_id}`} className="hover:underline">{d.campaign.name}</Link>
        <StateBadge state={j.state} label={j.state_label} />
        {j.is_test && <Badge tone="warn">TEST JOB</Badge>}
        <Badge>{j.ai_mode === "mock" ? "mock · no AI" : j.ai_mode}</Badge>
      </span>} />
      <div className="mb-4"><Stepper state={j.state} /></div>
      {flash && <div className="mb-4"><Notice tone={flash.tone}>{flash.text}</Notice></div>}
      <Tabs tabs={TABS.map((t) => ({ ...t, badge: WAITING[j.state] === t.id ? <span className="h-2 w-2 rounded-full bg-warn" aria-label="needs attention" /> : undefined }))} active={tab} onChange={go} />
      <div className="mt-6">
        {tab === "overview" && <OverviewTab go={go} />}
        {tab === "brief" && <BriefTab />}
        {tab === "script" && <ScriptTab />}
        {tab === "storyboard" && <StoryboardTab />}
        {tab === "prompts" && <PromptsTab />}
        {tab === "render" && <RenderTab />}
        {tab === "delivery" && <DeliveryTab />}
        {tab === "history" && <HistoryTab />}
      </div>
    </>
  );
}

export default function JobPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const sp = useSearchParams();
  const router = useRouter();
  const [tab, setTab] = useState(sp.get("tab") ?? "overview");
  useEffect(() => setTab(sp.get("tab") ?? "overview"), [sp]);
  const { data, error, loading, reload } = useData<any>(`/api/jobs/${id}`);
  const go = (t: string) => { setTab(t); router.replace(`/jobs/${id}?tab=${t}`, { scroll: false }); };
  if (loading) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  return <JobProvider d={data} reload={reload}><Body tab={tab} go={go} /></JobProvider>;
}
