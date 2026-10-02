/**
 * Where a meeting's work goes (#50): the one-click PR path of the closing
 * member (push the meeting branch with the repo's project credential and open
 * a draft PR, exactly as `agent.pr` does for the starter), or a comment review
 * on the reviewed PR with the same project credential (never a user's token,
 * SPEC §8 / D14). Reviews are always `COMMENT`: a meeting never approves or
 * blocks a merge.
 */
import type { AgentManager } from "../agents/manager/manager.ts";
import type { PullRequestClient } from "../github/pulls.ts";
import type { RepoAccess } from "../github/repo-access.ts";
import type { MeetingOutputs } from "./ports.ts";

export function officeMeetingOutputs(deps: {
  manager: Pick<AgentManager, "openPullRequest">;
  repos: RepoAccess;
  github: PullRequestClient;
}): MeetingOutputs {
  return {
    async openPullRequest(starter, agentId, options) {
      const pr = await deps.manager.openPullRequest(starter, agentId, { draft: true, ...options });
      return { number: pr.number, url: pr.url };
    },
    async postReview(repoId, prNumber, body) {
      const post = deps.github.createCommentReview;
      if (!post) throw new Error("posting reviews is not available");
      return deps.repos.withRepoCredential(repoId, async ({ repo, token }) => {
        if (!token) {
          throw new Error(
            "this operation repo has no access token and the office GitHub connection does not cover it",
          );
        }
        return post.call(deps.github, token, {
          owner: repo.owner,
          repo: repo.name,
          number: prNumber,
          body,
        });
      });
    },
  };
}
