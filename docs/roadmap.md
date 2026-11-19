# Roadmap

## Done (MVP)

Local dashboard + API, SQLite persistence, validated job state machine, both creation modes, three
performance modes, mock and manual Claude modes, optional budget-limited Anthropic mode, Google
Flow and Seedance manual production prep, first-frame workflow, render upload and technical checks,
human QC with configurable criteria, delivery ZIP, template-pack export, n8n workflows A–E with
idempotency, error handling and bounded retry, diagnostics.

## Next milestones

1. **Verify provider configs** (user action): confirm Flow and Dreamina capabilities in their UIs
   and set `verified: true`.
2. **Real AI inference**: run the Anthropic mode on a real job with a small budget, compare against
   manual Claude output, tune prompts; add prompt caching for the large brief/character prefix.
3. **Vision for reference analysis and QC notes**: send sampled frames to Claude (images) so the
   Reference Analyst works without manual attaching; keep QC notes advisory.
4. **API video generation**: only after verifying official APIs, pricing and terms; implement
   `ApiVideoProvider` (submit/poll/fetch/cost) with budget limits like the Anthropic mode.
5. **Advanced motion reference**: pose/motion guidance from authorized reference clips where a
   provider supports it.
6. **Captions in the dashboard**: wire `prompts/caption.md` + `validate.py caption` into the Delivery
   tab so packages include per-platform captions with disclosure.
7. **Voice-over in the dashboard**: upload a licensed narration and call `assemble.py --voiceover`.
8. **Client accounts**: authentication, roles (reviewer vs operator), per-client workspaces.
9. **Payment gateway**: only with accounts and an audit trail.
10. **Gumroad package**: polish the template pack (README, example brief with fictional data, n8n
    import guide), license terms.
11. **Browser E2E tests** (Playwright) for the UI.
