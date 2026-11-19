"use client";
import { CampaignForm, EMPTY } from "@/components/CampaignForm";
import { PageHeader } from "@/components/Shell";
import { ErrorBox, Loading } from "@/components/ui";
import { useData } from "@/lib/useData";

export default function NewCampaignPage() {
  const chars = useData<any>("/api/characters");
  return (
    <>
      <PageHeader title="New campaign" subtitle="Save a draft any time; a job can be created once every required field is filled and the brief validates." />
      {chars.loading ? <Loading /> : chars.error ? <ErrorBox error={chars.error} /> : <CampaignForm id={null} initial={EMPTY} characters={chars.data.characters} />}
    </>
  );
}
