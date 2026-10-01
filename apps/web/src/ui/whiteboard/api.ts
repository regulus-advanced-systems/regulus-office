/**
 * Whiteboard REST (#45, server `whiteboard/routes.ts`): the caller's access to
 * a board, and the wall snapshot upload. Same-origin requests with the
 * session cookie; the browser adds `Origin`, which the upload requires.
 */
import {
  WhiteboardInfo,
  WhiteboardSnapshotResponse,
  whiteboardApiPath,
  whiteboardSnapshotPath,
} from "@regulus/protocol";

export interface WhiteboardApi {
  info(boardId: string): Promise<WhiteboardInfo>;
  uploadSnapshot(boardId: string, png: Blob): Promise<number>;
}

export function createWhiteboardApi(fetchFn: typeof fetch = fetch): WhiteboardApi {
  return {
    async info(boardId) {
      const res = await fetchFn(whiteboardApiPath(boardId), { credentials: "same-origin" });
      if (!res.ok) throw new Error(res.status === 404 ? "not_found" : `http_${res.status}`);
      return WhiteboardInfo.parse(await res.json());
    },
    async uploadSnapshot(boardId, png) {
      const res = await fetchFn(whiteboardSnapshotPath(boardId), {
        method: "PUT",
        credentials: "same-origin",
        headers: { "content-type": "image/png" },
        body: png,
      });
      if (!res.ok) throw new Error(`snapshot upload failed: ${res.status}`);
      return WhiteboardSnapshotResponse.parse(await res.json()).version;
    },
  };
}

/** Cursor colours for collaborators, picked from the user id (stable per human). */
const CURSOR_COLORS = ["#D7263D", "#2EC4B6", "#C9A227", "#1E6FE0", "#8E44AD", "#3DA35D", "#F26522"];

export function cursorColor(userId: string): string {
  let h = 0;
  for (let i = 0; i < userId.length; i++) h = (h * 31 + userId.charCodeAt(i)) >>> 0;
  return CURSOR_COLORS[h % CURSOR_COLORS.length] ?? "#D7263D";
}
