/**
 * Token usage of workflow robots (#155), attributed to `office` (D2, SPEC §8
 * rule 3): a `usage_samples` row with `userId` null. The usage tracker (#40)
 * can replace this with its `recordUsage` API through {@link UsageRecorder}.
 */
import type { WorkflowProvider } from "@regulus/protocol";
import type { Db } from "../db/index.ts";
import { usageSamples } from "../db/schema/index.ts";
import type { RunUsage } from "./runs.ts";

export interface OfficeUsageSample extends RunUsage {
  provider: WorkflowProvider;
  ts: number;
  /** Always `office` for workflows. */
  attributedTo: "office";
}

export interface UsageRecorder {
  record(sample: OfficeUsageSample): void;
}

export function dbUsageRecorder(db: Db): UsageRecorder {
  return {
    record(sample) {
      if (sample.inputTokens + sample.outputTokens + sample.costUsd === 0) return;
      db.insert(usageSamples)
        .values({
          userId: null,
          agentId: null,
          provider: sample.provider,
          ts: new Date(sample.ts),
          inputTokens: sample.inputTokens,
          outputTokens: sample.outputTokens,
          cacheReadTokens: sample.cacheReadTokens,
          cacheWriteTokens: sample.cacheWriteTokens,
          costUsdEstimate: sample.costUsd,
          source: "inband",
        })
        .run();
    },
  };
}
