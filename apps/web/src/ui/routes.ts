/**
 * Route table as data so it can be tested without rendering. `App.tsx`
 * attaches a component to each id.
 */
import { matchRoutes } from "react-router";

export type RouteId = "home" | "login" | "join" | "office" | "uiKit";

export const ROUTE_PATHS: Readonly<Record<RouteId, string>> = {
  home: "/",
  login: "/login",
  join: "/join/:token",
  office: "/office",
  /** Dev gallery of every HUD component and state (issue #18); no Storybook. */
  uiKit: "/ui-kit",
};

export const ROUTE_TABLE = (Object.keys(ROUTE_PATHS) as RouteId[]).map((id) => ({
  id,
  path: ROUTE_PATHS[id],
}));

export function joinPath(token: string): string {
  return `/join/${encodeURIComponent(token)}`;
}

export interface RouteMatch {
  id: RouteId;
  params: Record<string, string | undefined>;
}

/** Match a pathname against the table; null when nothing matches. */
export function matchOfficeRoute(pathname: string): RouteMatch | null {
  const matches = matchRoutes(ROUTE_TABLE, pathname);
  const last = matches?.at(-1);
  if (!last) return null;
  return { id: last.route.id as RouteId, params: last.params };
}
