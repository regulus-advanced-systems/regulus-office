/**
 * What the command palette lists (#261), as a pure function of what this
 * browser already holds for its viewer. Nothing here asks the server for
 * more, so the palette can never name something the rest of the HUD does not
 * (D26, D27, D34):
 *
 *   levels, rooms   quick travel's own groups (ui/hud/QuickTravel.tsx): levels
 *                   the server publishes to this viewer, rooms they may enter.
 *                   A closed room and a room they may only see from outside
 *                   are not in those groups, so they are not here either.
 *   people          the "who's where" rows, with the same place wording (a
 *                   closed room is "Behind a closed door").
 *   henchmen,       the OperationRoom states this client has joined (the room
 *   issues, PRs     the player is in and the nearby ones), and of those only
 *                   rooms in the viewer's own REST operation list.
 *   office agents   the bodies in the viewer's BuildingRoom state they may talk to.
 *   actions         only where the client-side mirror of the server's rule
 *                   says this person may; the server checks again.
 *
 * `paletteResults` filters and ranks the entries for what was typed.
 */
import {
  type CardKind,
  hasOperationAccess,
  type OfficeAgentBody,
  type OperationInfo,
  type OperationState,
  type UserRole,
} from "@regulus/protocol";
import { canChatWith } from "../../state/officeAgents.ts";
import { canManageOffice } from "../../state/session.ts";
import { levelDepth, type TravelGroup } from "../hud/QuickTravel.tsx";
import {
  SETTINGS_TAB_LABELS,
  type SettingsTabId,
  visibleSettingsTabs,
} from "../settings/settingsTabs.ts";
import type { WhereaboutsRow } from "../whereabouts/whereabouts.ts";

export type PaletteAction =
  | { kind: "level"; levelId: string }
  | { kind: "room"; roomId: string; levelId: string | null }
  | { kind: "person"; sessionId: string; name: string }
  | { kind: "henchman"; agentId: string; operationId: string; seatId: string; terminal: boolean }
  | { kind: "agentChat"; agentId: string }
  | { kind: "card"; card: CardKind; key: string }
  | { kind: "settings"; tab: SettingsTabId }
  | { kind: "spawn"; seatId: string }
  | { kind: "queueAdd" }
  | { kind: "queuePanel" }
  | { kind: "addOperation" }
  | { kind: "help" }
  | { kind: "search"; query: string };

export type PaletteGroup =
  | "Action"
  | "Level"
  | "Room"
  | "Settings"
  | "Person"
  | "Agent"
  | "Henchman"
  | "Issue"
  | "PR"
  | "Search";

export interface PaletteEntry {
  /** Unique in one list; the option's DOM id is derived from it. */
  id: string;
  group: PaletteGroup;
  title: string;
  /** A few muted words after the title. */
  hint: string;
  action: PaletteAction;
}

export interface PaletteSources {
  /** Quick travel's groups, as built for this viewer. */
  travel: readonly TravelGroup[];
  /** "Who's where" rows. */
  people: readonly WhereaboutsRow[];
  /** OperationRoom states this client has joined, by operation id. */
  rooms: Readonly<Record<string, OperationState>>;
  /** The room the player is in, if it is a project room. */
  currentOperationId: string | null;
  /** The viewer's own operations (REST), with their access; null until loaded. */
  operations: readonly OperationInfo[] | null;
  viewer: { id: string; role: UserRole } | null;
  /** Office agents' bodies in the viewer's building state. */
  agents: readonly OfficeAgentBody[];
}

const byNumber = <T extends { number: number }>(a: T, b: T) => b.number - a.number;

function travelEntries(travel: readonly TravelGroup[]): PaletteEntry[] {
  const levels: PaletteEntry[] = [];
  const rooms: PaletteEntry[] = [];
  for (const group of travel) {
    const levelId = group.level?.levelId ?? null;
    if (levelId && group.label && !group.here) {
      levels.push({
        id: `level:${levelId}`,
        group: "Level",
        title: `Go to ${group.label.title}`,
        hint: [levelDepth(group.label), "lift landing"].filter(Boolean).join(" · "),
        action: { kind: "level", levelId },
      });
    }
    for (const room of group.rooms) {
      rooms.push({
        id: `room:${levelId ?? ""}:${room.id}`,
        group: "Room",
        title: `Go to ${room.name}`,
        hint: group.label?.title ?? "",
        action: { kind: "room", roomId: room.id, levelId },
      });
    }
  }
  return [...levels, ...rooms];
}

function roomEntries(
  state: OperationState,
  current: boolean,
  access: OperationInfo["access"],
): PaletteEntry[] {
  const out: PaletteEntry[] = [];
  const henchmen = Object.values(state.henchmen).sort((a, b) => a.name.localeCompare(b.name));
  for (const h of henchmen) {
    const name = h.name || "Henchman";
    const hint = [h.ownerName && `${h.ownerName}'s`, state.name, h.status]
      .filter(Boolean)
      .join(" · ");
    const target = { agentId: h.agentId, operationId: state.operationId, seatId: h.seatId };
    out.push({
      id: `henchman:${h.agentId}`,
      group: "Henchman",
      title: `Walk to ${name}`,
      hint,
      action: { kind: "henchman", ...target, terminal: false },
    });
    out.push({
      id: `terminal:${h.agentId}`,
      group: "Henchman",
      title: `Open ${name}'s terminal`,
      hint,
      action: { kind: "henchman", ...target, terminal: true },
    });
  }
  // The boards, the spawn dialog and the queue belong to the room the player is in.
  if (!current) return out;
  for (const issue of Object.values(state.issues).sort(byNumber)) {
    out.push({
      id: `issue:${issue.repoId}#${issue.number}`,
      group: "Issue",
      title: `#${issue.number} ${issue.title}`,
      hint: [issue.state, state.name].join(" · "),
      action: { kind: "card", card: "issue", key: `${issue.repoId}#${issue.number}` },
    });
  }
  for (const pull of Object.values(state.pulls).sort(byNumber)) {
    out.push({
      id: `pr:${pull.repoId}#${pull.number}`,
      group: "PR",
      title: `#${pull.number} ${pull.title}`,
      hint: [pull.merged ? "merged" : pull.draft ? "draft" : pull.state, state.name].join(" · "),
      action: { kind: "card", card: "pr", key: `${pull.repoId}#${pull.number}` },
    });
  }
  const actions: PaletteEntry[] = [];
  if (hasOperationAccess(access, "spawn")) {
    const free = Object.values(state.desks)
      .filter((d) => d.agentId === "")
      .map((d) => d.seatId)
      .sort()[0];
    if (free !== undefined) {
      actions.push({
        id: "action:spawn",
        group: "Action",
        title: "Spawn a henchman",
        hint: `at a free desk in ${state.name}`,
        action: { kind: "spawn", seatId: free },
      });
    }
    actions.push({
      id: "action:queue-add",
      group: "Action",
      title: "Queue a task",
      hint: state.name,
      action: { kind: "queueAdd" },
    });
  }
  actions.push({
    id: "action:queue",
    group: "Action",
    title: "Open the task queue",
    hint: state.name,
    action: { kind: "queuePanel" },
  });
  return [...actions, ...out];
}

/** Every entry this viewer may be offered, in the order an empty palette shows them. */
export function buildEntries(src: PaletteSources): PaletteEntry[] {
  const access = new Map((src.operations ?? []).map((o) => [o.operationId, o.access]));
  const inRooms: PaletteEntry[] = [];
  const ids = Object.keys(src.rooms).sort(
    (a, b) => Number(b === src.currentOperationId) - Number(a === src.currentOperationId),
  );
  for (const id of ids) {
    const state = src.rooms[id];
    const mine = access.get(id);
    // A room state for a room that is not (or no longer) in the viewer's own list is not used.
    if (!state || !mine) continue;
    inRooms.push(...roomEntries(state, id === src.currentOperationId, mine));
  }
  const of = (...groups: PaletteGroup[]) => inRooms.filter((e) => groups.includes(e.group));

  const actions: PaletteEntry[] = of("Action");
  if (canManageOffice(src.viewer?.role)) {
    actions.push({
      id: "action:add-operation",
      group: "Action",
      title: "New operation (build mode)",
      hint: "pick a repo, then place its room",
      action: { kind: "addOperation" },
    });
  }
  actions.push({
    id: "action:help",
    group: "Action",
    title: "Keyboard shortcuts",
    hint: "",
    action: { kind: "help" },
  });

  const settings = visibleSettingsTabs(src.viewer?.role).map(
    (tab): PaletteEntry => ({
      id: `settings:${tab}`,
      group: "Settings",
      title: `Settings: ${SETTINGS_TAB_LABELS[tab]}`,
      hint: "",
      action: { kind: "settings", tab },
    }),
  );

  const people = src.people
    .filter((row) => !row.self)
    .map(
      (row): PaletteEntry => ({
        id: `person:${row.sessionId}`,
        group: "Person",
        title: `Walk to ${row.name}`,
        hint: row.place.label,
        action: { kind: "person", sessionId: row.sessionId, name: row.name },
      }),
    );

  const agents = src.agents
    .filter((body) => canChatWith(body, src.viewer))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(
      (body): PaletteEntry => ({
        id: `agent:${body.agentId}`,
        group: "Agent",
        title: `Talk to ${body.name}`,
        hint: body.ownerUserId === "" ? "office agent" : "your assistant",
        action: { kind: "agentChat", agentId: body.agentId },
      }),
    );

  return [
    ...actions,
    ...travelEntries(src.travel),
    ...settings,
    ...people,
    ...agents,
    ...of("Henchman"),
    ...of("Issue", "PR"),
  ];
}

/** Most rows shown at once; the rest need a longer query. */
export const PALETTE_MAX_SHOWN = 40;

export interface PaletteResults {
  shown: PaletteEntry[];
  /** Matches left out by the cap. */
  more: number;
}

const fold = (s: string) => s.normalize("NFKC").toLocaleLowerCase();

/** 0: the title starts with the query; 1: a word of it does; 2: it is in the title; 3: elsewhere. */
function rank(entry: PaletteEntry, q: string): number {
  const title = fold(entry.title);
  if (title.startsWith(q)) return 0;
  if (title.split(/\s+/).some((w) => w.startsWith(q))) return 1;
  return title.includes(q) ? 2 : 3;
}

/**
 * The entries matching `query` (every word of it somewhere in the group, title
 * or hint), best first, then a hand-over to search (#41) for chat and terminal
 * scrollback, which the palette does not search itself.
 */
export function paletteResults(entries: readonly PaletteEntry[], query: string): PaletteResults {
  const typed = query.trim();
  const q = fold(typed);
  const words = q.split(/\s+/).filter(Boolean);
  let matched: PaletteEntry[];
  if (words.length === 0) matched = [...entries];
  else {
    matched = entries
      .filter((e) => {
        const hay = fold(`${e.group} ${e.title} ${e.hint}`);
        return words.every((w) => hay.includes(w));
      })
      .map((e, i) => ({ e, i, r: rank(e, q) }))
      .sort((a, b) => a.r - b.r || a.i - b.i)
      .map((x) => x.e);
    matched.push({
      id: "search",
      group: "Search",
      title: `Search chat and terminals for “${typed}”`,
      hint: "",
      action: { kind: "search", query: typed },
    });
  }
  const shown = matched.slice(0, PALETTE_MAX_SHOWN);
  // The hand-over to search is always the last row, whatever the cap cut.
  const last = matched[matched.length - 1];
  if (last && last.group === "Search" && !shown.includes(last)) shown[shown.length - 1] = last;
  return { shown, more: matched.length - shown.length };
}
