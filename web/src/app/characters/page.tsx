"use client";
import { PageHeader } from "@/components/Shell";
import { Badge, Card, ErrorBox, Issues, KV, Loading, Notice } from "@/components/ui";
import { fileUrl } from "@/lib/client";
import { useData } from "@/lib/useData";

export default function CharactersPage() {
  const { data, error, loading, reload } = useData<any>("/api/characters");
  if (loading) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  const chars = Object.values(data.characters) as any[];
  return (
    <>
      <PageHeader title="Character library" subtitle="Reference images are private and local; they are shown only here and never packaged. Add characters in characters/registry.json (see docs/character-registry.md)." />
      <div className="mb-6"><Issues errors={data.report.errors} warnings={data.report.warnings} /></div>
      <div className="flex flex-col gap-6">
        {chars.map((c) => {
          const refs = Object.entries(c.references as Record<string, string[]>).flatMap(([view, paths]) => paths.map((p) => ({ view, p })));
          const cu = c.commercial_use;
          return (
            <Card key={c.character_id} title={<span className="flex items-center gap-2">{c.display_name} <code className="text-xs text-muted">{c.character_id}</code></span>}
              actions={<><Badge tone={c.status === "active" ? "ok" : "warn"}>{c.status}</Badge><Badge tone={cu.authorized ? "ok" : "bad"}>{cu.authorized ? "commercial use authorized" : "not authorized for commercial use"}</Badge></>}>
              {refs.length > 0 ? (
                <div className="mb-4 flex gap-3 overflow-x-auto pb-2">
                  {refs.map(({ view, p }) => (
                    <figure key={p} className="shrink-0">
                      <img src={fileUrl(p)} alt={`${c.display_name} ${view} reference`} className="h-40 w-auto rounded-lg border border-line object-cover" />
                      <figcaption className="mt-1 text-xs text-muted">{view}</figcaption>
                    </figure>
                  ))}
                </div>
              ) : <div className="mb-4"><Notice tone="warn" title="No reference images yet">This character cannot be rendered until a person adds references and writes the description.</Notice></div>}
              <KV items={[
                ["Appearance", c.physical_description ?? <span className="text-muted">Not written yet — describe only as “the person in the attached reference images”.</span>],
                ["Wardrobe", (c.styling_rules?.default_wardrobe ?? []).join(" · ") || "—"],
                ["Hair", c.styling_rules?.hair ?? "—"],
                ["Accessories", (c.styling_rules?.accessories ?? []).join(" · ") || "—"],
                ["Allowed variations", (c.allowed_variations ?? []).join(" · ")],
                ["Rights holder", cu.rights_holder ?? "—"],
                ["Licence", cu.license_reference ?? "—"],
                ["Authorized uses", (cu.authorized_uses ?? []).join(", ") || "—"],
                ["Expires", cu.expires_on ?? "no expiry recorded"],
                ["Notes", c.notes ?? "—"],
              ]} />
            </Card>
          );
        })}
      </div>
    </>
  );
}
