/** Who may hang and change wall pictures, on the client (#46; the server decides). */
import { mayEditPicture, type OperationAccess } from "@regulus/protocol";
import { useOperationsStore } from "../../state/operations.ts";
import { useSessionStore } from "../../state/session.ts";

/** The signed-in human's access to `operationId` (owners and admins: manage). */
export function useOperationAccess(operationId: string | null): OperationAccess | null {
  return useOperationsStore(
    (s) => s.operations?.find((o) => o.operationId === operationId)?.access ?? null,
  );
}

/** Whether the signed-in human may move/remove the picture `placedBy` hung. */
export function useMayEditPicture(operationId: string | null, placedBy: string): boolean {
  const access = useOperationAccess(operationId);
  const me = useSessionStore((s) => s.user?.id ?? "");
  return mayEditPicture(access, me, placedBy);
}
