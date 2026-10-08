/**
 * Who needs to link GitHub before a room opens (SPEC D26, D27; #270). A room
 * opens with the person's own GitHub access to its repo, so someone without a
 * linked account (or whose link GitHub no longer accepts) is in the lobby
 * only. This store holds the viewer's own link state for the prompts: the
 * lobby panel (GitHubLinkPrompt.tsx) and closed doors (the scene, #269).
 *
 * The state is only ever the viewer's own (`GET /api/github/link`), and it
 * decides nothing: the server alone decides what a person may see.
 */
import type { GitHubLinkStatus } from "@regulus/protocol";
import { create } from "zustand";
import { createGitHubLinkApi, type GitHubLinkApi } from "../settings/githubLinkApi.ts";

/** The sentence for the lobby and for closed doors. */
export const LINK_TO_ENTER_ROOMS = "Link your GitHub account to enter your rooms.";
export const LINK_AGAIN_TO_ENTER_ROOMS =
  "GitHub no longer accepts your link. Link your account again to enter your rooms.";

export interface LinkPrompt {
  /** What to tell the person. */
  text: string;
  /** False when linking is not set up on this office: there is nothing to press. */
  canLink: boolean;
  /** More for the person who runs the office, when linking is not set up. */
  hint?: string;
}

/** The prompt for a link status, or null when the person is linked (or the state is unknown). */
export function linkPromptFor(
  status: Pick<GitHubLinkStatus, "state" | "available" | "unavailableReason"> | null,
  officeManager: boolean,
): LinkPrompt | null {
  if (!status || status.state === "linked") return null;
  const text = status.state === "revoked" ? LINK_AGAIN_TO_ENTER_ROOMS : LINK_TO_ENTER_ROOMS;
  if (status.available) return { text, canLink: true };
  const missing =
    status.unavailableReason === "master_key_required"
      ? "OFFICE_MASTER_KEY"
      : "GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET";
  return {
    text,
    canLink: false,
    hint: officeManager
      ? `Linking is not set up on this office yet: set ${missing} on the server (README, "Upgrading: rooms open with GitHub access"). Until then every room stays closed for everyone.`
      : "Linking is not set up on this office yet. Ask the person who runs it.",
  };
}

export interface LinkStore {
  status: GitHubLinkStatus | null;
  /** Read the viewer's own link state from the server. */
  refresh: (api?: GitHubLinkApi) => Promise<void>;
  clear: () => void;
}

const defaultApi = createGitHubLinkApi();

export const useLinkStore = create<LinkStore>()((set) => ({
  status: null,
  refresh: async (api = defaultApi) => {
    const res = await api.status();
    if (res.ok) set({ status: res.data });
  },
  clear: () => set({ status: null }),
}));
