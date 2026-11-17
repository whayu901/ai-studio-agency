# Experiment log

Log **one row per Flow generation attempt** (not per finished video), so retries and credit
spend are visible. The easiest way is the logger, which creates `experiments/experiment-log.csv`
on first use and fills in ids, attempt numbers, mode, model and prompt versions for you:

```bash
python3 tools/log_attempt.py outputs/<job>/production.json --clip C01 --credits 20 --scores QC01=4,QC02=5 --decision RETRY
```

Real logs are gitignored, because they may hold client names and spend. You can also copy the
template and fill it in by hand in Numbers, Excel or Google Sheets. Keep the header unchanged
so the logger can keep appending.

| Column | Meaning |
|---|---|
| `experiment_id` | `EXP-0001`, `EXP-0002`, … |
| `production_mode` | `original` or `reference_guided` |
| `character_id` | e.g. `female_02` |
| `flow_model` / `generation_mode` | what you selected in Flow |
| `prompt_versions` | from `production.json` → `prompt_versions`, e.g. `original-creation@0.1.0;google-flow@0.1.0` |
| `generation_attempts` | how many times you pressed generate for this clip so far |
| `credits_consumed` | Flow credits used by this attempt (read it from Flow) |
| `estimated_cost` | your share of the subscription for those credits |
| `qc_*` | 1–5 scores from `docs/quality-control-checklist.md` |
| `quality_score_avg` | average of the qc columns |
| `problems_encountered` | short and specific, e.g. "6 fingers at 2.4 s; lid colour drifted" |
| `output_file` | where you saved the download, e.g. `outputs/demo-001/renders/C01_a03.mp4` |
| `final_approval_status` | `REJECTED`, `RETRY`, `SELECTED`, `APPROVED_FOR_DELIVERY` |
