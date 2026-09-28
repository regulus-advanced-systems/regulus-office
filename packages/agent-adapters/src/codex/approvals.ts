/**
 * Office permission decisions → Codex approval responses
 * (https://learn.chatgpt.com/docs/app-server, "Approvals").
 *
 * | office       | command / file change | item/permissions/requestApproval      |
 * |--------------|-----------------------|---------------------------------------|
 * | allow_once   | "accept"              | grant requested subset, scope "turn"    |
 * | allow_always | "acceptForSession"    | grant requested subset, scope "session" |
 * | reject       | "decline"             | grant nothing, scope "turn"             |
 *
 * "decline" (not "cancel") lets the agent continue the turn without the
 * action, which matches a human saying no at the desk; `interrupt()` is the
 * way to stop the turn.
 */
import type { PermissionDecision } from "@regulus/protocol";
import type { ApprovalRequest } from "./events.ts";
import type {
  CommandExecutionRequestApprovalResponse,
  FileChangeRequestApprovalResponse,
  GrantedPermissionProfile,
  PermissionsRequestApprovalResponse,
} from "./generated/v2/index.ts";

type SimpleDecision = CommandExecutionRequestApprovalResponse["decision"] &
  FileChangeRequestApprovalResponse["decision"];

const SIMPLE: Record<PermissionDecision, SimpleDecision> = {
  allow_once: "accept",
  allow_always: "acceptForSession",
  reject: "decline",
};

export type ApprovalResponse =
  | CommandExecutionRequestApprovalResponse
  | FileChangeRequestApprovalResponse
  | PermissionsRequestApprovalResponse;

export function approvalResponse(
  req: ApprovalRequest,
  decision: PermissionDecision,
): ApprovalResponse {
  if (req.method !== "item/permissions/requestApproval") return { decision: SIMPLE[decision] };
  if (decision === "reject") return { permissions: {}, scope: "turn" };
  const requested = req.params.permissions;
  const granted: GrantedPermissionProfile = {};
  if (requested.network) granted.network = requested.network;
  if (requested.fileSystem) granted.fileSystem = requested.fileSystem;
  return { permissions: granted, scope: decision === "allow_always" ? "session" : "turn" };
}
