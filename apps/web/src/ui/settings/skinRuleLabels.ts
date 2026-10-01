/** Plain-language names for skin rule matches (#184): "Every Codex robot", "The PM". */
import { PROVIDER_IDS, type ProviderId, parseSkinMatch } from "@regulus/protocol";

export const PROVIDER_LABELS: Readonly<Record<ProviderId, string>> = {
  "claude-code": "Claude Code",
  codex: "Codex",
  "gemini-cli": "Gemini CLI",
  opencode: "OpenCode",
  "kimi-code": "Kimi Code",
  custom: "Custom",
};

export function describeMatch(match: string): string {
  const parsed = parseSkinMatch(match);
  if (!parsed) return match;
  if (parsed.kind === "role") return "The PM";
  if (parsed.kind === "office_agent") return `Office agent ${parsed.value}`;
  const provider = PROVIDER_IDS.find((p) => p === parsed.value);
  return `Every ${provider ? PROVIDER_LABELS[provider] : parsed.value} henchman`;
}
