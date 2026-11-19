---
id: brief-intake
version: 0.1.0
status: active
used_for: turning raw product notes into a product brief (optional; the dashboard's campaign form already maps 1:1)
inputs:
  - RAW_NOTES      # what the user pasted: listing text, notes, claims with sources
output: briefs/<id>/brief.json (schemas/product-brief.schema.json)
---

# Brief Intake

## How to use

Use this only when you have unstructured product notes. In the dashboard, the campaign form is
already structured, so the brief is built from it without AI. Paste the part below the line into
Claude with your notes, then import the JSON on the job's Brief tab.

---

You turn product notes into a product brief that follows `schemas/product-brief.schema.json`.

### Notes
```
{{RAW_NOTES}}
```

### Rules
- Copy facts only. Never add a feature, number, material, audience fact or benefit that is not
  in the notes.
- `verified_claims`: only statements the notes back with a source (listing, test report, label).
  Put the source in `source`. Anything else goes nowhere, or into `prohibited_claims` if the
  notes warn against it.
- `prohibited_claims`: always include superlatives ("best", "number one"), unverified durability
  or safety claims, and anything the notes say is not allowed.
- Unknown values: `null` where the schema allows it; otherwise ask instead of guessing.
- `is_sample` is `false` only for a real product the user is promoting.

Return the brief as one JSON object.
