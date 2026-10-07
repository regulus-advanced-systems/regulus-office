/** Request bodies of the operation create routes, as the server reads them. */
import { CreateOperationRequest, RepoInput } from "@regulus/protocol";
import { z } from "zod";

/**
 * What the create routes read: the request with room for several repos, so a
 * request that names more than one is refused by `OperationService.create`
 * with `one_repo_per_room` and a sentence saying what to do, instead of the
 * body validator's bare `invalid_body`.
 */
export const CreateOperationBody = CreateOperationRequest.extend({
  repos: z.array(RepoInput).min(1).max(8),
});
