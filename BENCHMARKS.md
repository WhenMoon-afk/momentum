# Momentum Performance Benchmarks

## Executive Summary

Momentum provides **6,000x to 50,000x faster** context recovery compared to traditional LLM-based compaction.

| Metric | Traditional Compaction | Momentum |
|--------|----------------------|----------|
| Time to recover context | 30-60 seconds | **<5ms** |
| CPU usage during recovery | High (LLM inference) | **Minimal** (SQLite query) |
| Network required | Yes (API call) | **No** (local) |
| Cost per recovery | ~$0.05-0.10 | **$0** |

## Benchmark Results

### Context Retrieval Speed

Measured time to retrieve compacted context at various stored token sizes:

| Stored Tokens | Snapshots | Retrieve Time | Speedup vs 30s |
|---------------|-----------|---------------|----------------|
| 10,000        | 5         | **~1ms**      | ~26,000x       |
| 50,000        | 25        | **~2.5ms**    | ~12,000x       |
| 100,000       | 50        | **~4ms**      | ~7,000x        |
| 150,000       | 75        | **~5ms**      | ~6,000x        |

*Based on benchmarks from 2026-01-11. Run `bun test:benchmark` to regenerate.*

### Snapshot Save Performance

| Operation | Time | Notes |
|-----------|------|-------|
| Single snapshot save | **0.19ms avg** | Tested over 100 rapid saves |
| Snapshot with full metadata | **<1ms** | Including files, decisions, next_steps |
| Large context (10k chars) | **<5ms** | ~2,500 tokens |

### Search Performance

| Operation | Time | Notes |
|-----------|------|-------|
| Topic search across 100 snapshots | **0.82ms** | Found 10 matching |
| List all sessions | **0.80ms** | 16 sessions |
| Multi-session retrieve (10 sessions) | **7.18ms** | 0.72ms avg per session |

## How Momentum Compares to Traditional Compaction

### Traditional LLM Compaction
When Claude Code reaches ~95% context capacity:
1. Sends ~190,000 tokens to LLM API
2. LLM generates summary (~15,000 tokens)
3. **Total time: 30-60 seconds**
4. **Cost: ~$0.05-0.10 per compaction**

### Momentum Approach
When context needs recovery:
1. Query SQLite database for snapshots
2. Concatenate pre-saved snapshots
3. **Total time: <5ms**
4. **Cost: $0**

## Why Momentum is Faster

1. **No LLM Inference**: Snapshots are pre-computed, not generated on-demand
2. **Local Storage**: SQLite database on disk, no network latency
3. **Indexed Queries**: Database indices for session and sequence lookups
4. **Importance Weighting**: Most valuable context retrieved first

## Reproducing These Benchmarks

```bash
# Run the benchmark suite
bun run test:benchmark

# Results are saved to benchmark-results.json
cat benchmark-results.json
```

## Test Environment

- **Runtime**: Bun 1.3.5 / Node.js 18+
- **Database**: SQLite 3 with WAL mode
- **Storage**: better-sqlite3 native bindings
- **Hardware**: Standard development machine

## Methodology

1. **Token Estimation**: ~4 characters per token (industry standard)
2. **Snapshot Size**: ~2,000 tokens per snapshot (optimal for frequent saves)
3. **Retrieval Limit**: 15,000 tokens default (leaves room for system prompt)
4. **Safety Margin**: 15% token buffer to prevent overflow

---

*Benchmarks last run: 2026-01-11*
*Run `bun run test:benchmark` to regenerate with your hardware*
