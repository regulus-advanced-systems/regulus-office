/**
 * "Add operation" dialog (SPEC §9.1, D7, D14): an owner or admin names the
 * operation, picks its room's lair style (the same `decorStyle` room
 * settings changes later; the old office palettes are gone, #282) and chooses its
 * one GitHub repo (one repo per room, #268; the repo's owner decides the
 * level the room is built on). With the office GitHub connection (#141)
 * it is picked from a searchable list of every repo it can see; "Other
 * repo…" (or, without a connection, the only option) takes a typed
 * owner/name with an optional fine-grained PAT scoped to that repo.
 * "Choose a spot…" then continues in build mode (#187): the room's size,
 * place and door are picked on the compound map, and the operation is created
 * when the owner builds it there (ui/build-mode).
 *
 * Tokens live only in their (uncontrolled) password inputs until submitted,
 * then in build mode's memory until the room is built or build mode is
 * cancelled; the inputs are cleared on submit and the token is never shown
 * again (the server reports `hasCredential`).
 */

import {
  type DecorStyle,
  type GitHubRepoInfo,
  isDecorStyle,
  LOBBY_LEVEL_ID,
  levelLoginOf,
  ONE_REPO_PER_ROOM_MESSAGE,
  type PlaceRoomRequest,
} from "@regulus/protocol";
import { useEffect, useId, useState } from "react";
import { useBuildingStore } from "../../state/building.ts";
import { syncCompoundWorld, useCompoundStore } from "../../state/compound.ts";
import { DRAFT_LEVEL_ID, levelList, useLevelStore } from "../../state/level.ts";
import { canManageOffice, useSessionStore } from "../../state/session.ts";
import { showDraftLevel } from "../../state/travel.ts";
import { useUiStore } from "../../state/ui.ts";
import { FormAlert } from "../auth/AuthCard.tsx";
import { buildFrame } from "../build-mode/logic.ts";
import {
  ADD_OPERATION_OVERLAY,
  type AddOperationDraft,
  takeAddOperationDraft,
} from "../build-mode/returnDraft.ts";
import { useBuildModeStore } from "../build-mode/store.ts";
import { Button } from "../components/Button.tsx";
import { Modal } from "../components/Modal.tsx";
import { DecorStylePicker } from "../room-settings/DecorStylePicker.tsx";
import { useGitHubLinkResultOverlay } from "../settings/GitHubLinkSection.tsx";
import { useGitHubResultOverlay } from "../settings/GitHubSection.tsx";
import { createGitHubApi, describeGitHubError, type GitHubApi } from "../settings/githubApi.ts";
import { RepoPicker } from "./RepoPicker.tsx";
import "./operations.css";

export { ADD_OPERATION_OVERLAY };

/** What the form hands to build mode: everything but where the room goes. */
export type AddOperationRequest = Omit<PlaceRoomRequest, "placement">;

const defaultGitHubApi = createGitHubApi();
let rowSeq = 0;

/**
 * Read the uncontrolled form: name, room style, then the repos: those
 * picked from the connection's list first (in the order picked, no token:
 * the connection covers them), then the non-empty typed rows.
 */
export function readAddOperationForm(
  form: HTMLFormElement,
  rowKeys: readonly number[],
  picked: readonly string[] = [],
): AddOperationRequest {
  const data = new FormData(form);
  const field = (name: string) => String(data.get(name) ?? "").trim();
  const style = field("decorStyle");
  const decorStyle: DecorStyle | undefined = isDecorStyle(style) ? style : undefined;
  const typed = rowKeys
    .map((key) => ({ repo: field(`repo-${key}`), token: field(`token-${key}`) }))
    .filter((r) => r.repo)
    .map((r) => (r.token ? r : { repo: r.repo }));
  const repos = [...picked.map((repo) => ({ repo })), ...typed];
  return {
    name: field("name"),
    ...(decorStyle ? { decorStyle } : {}),
    repos,
  };
}

/** The connection's repos: not connected, loading, loaded, or failed (typed repos still work). */
type ConnectionRepos =
  | { state: "none" }
  | { state: "loading" }
  | { state: "ready"; repos: GitHubRepoInfo[]; truncated: boolean }
  | { state: "error"; message: string };

function useConnectionRepos(github: GitHubApi): ConnectionRepos {
  const [value, setValue] = useState<ConnectionRepos>({ state: "loading" });
  useEffect(() => {
    let live = true;
    void (async () => {
      const status = await github.status();
      if (!live) return;
      if (!status.ok || status.data.kind === "none") return setValue({ state: "none" });
      const listed = await github.repos();
      if (!live) return;
      setValue(
        listed.ok
          ? { state: "ready", repos: listed.data.repos, truncated: listed.data.truncated }
          : { state: "error", message: describeGitHubError(listed) },
      );
    })();
    return () => {
      live = false;
    };
  }, [github]);
  return value;
}

export function AddOperationForm({
  github = defaultGitHubApi,
  draft = null,
  onSubmit,
}: {
  github?: GitHubApi;
  /** Back from build mode with a refusal: start from what was typed. */
  draft?: AddOperationDraft | null;
  onSubmit: (request: AddOperationRequest) => void;
}) {
  const [rows] = useState<number[]>(() => [++rowSeq]);
  const [picked, setPicked] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(draft?.error ?? null);
  const ids = { name: useId() };
  const connection = useConnectionRepos(github);
  const listed = connection.state === "ready";

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const request = readAddOperationForm(form, rows, listed ? picked : []);
    if (!request.name || request.repos.length === 0) {
      setError("Give the operation a name and a repo.");
      return;
    }
    if (request.repos.length > 1) {
      setError(`${ONE_REPO_PER_ROOM_MESSAGE} Pick the repo from the list or type one, not both.`);
      return;
    }
    // Tokens leave the page's inputs here; build mode holds them until the room is built.
    for (const input of form.querySelectorAll<HTMLInputElement>('input[type="password"]')) {
      input.value = "";
    }
    setError(null);
    onSubmit(request);
  };

  const typedRows = (
    <>
      {rows.map((key, i) => (
        <div key={key} className="rg-operation-form__repo">
          <input
            name={`repo-${key}`}
            defaultValue={draft?.repos[i] ?? ""}
            className="rg-input"
            aria-label={`Repo ${i + 1}`}
            placeholder="owner/name or https://github.com/owner/name"
          />
          <input
            name={`token-${key}`}
            className="rg-input"
            type="password"
            autoComplete="off"
            aria-label={`Access token for repo ${i + 1}`}
            placeholder="Fine-grained token (private repos)"
          />
        </div>
      ))}
      <div className="rg-field__hint">
        A room has one repo; add another room for another repo. The room is built on the level of
        the repo's owner. Public repos, and repos the office GitHub connection covers, need no
        token; for another private repo use a fine-grained token scoped to that repo only. Tokens
        are stored encrypted and never shown again.
      </div>
    </>
  );

  return (
    <form onSubmit={submit} aria-label="New operation">
      <div className="rg-field">
        <label className="rg-field__label" htmlFor={ids.name}>
          Operation name
        </label>
        <input
          id={ids.name}
          name="name"
          className="rg-input"
          maxLength={80}
          defaultValue={draft?.name ?? ""}
        />
      </div>
      <DecorStylePicker name="decorStyle" defaultValue={draft?.decorStyle} />
      <fieldset className="rg-field rg-operation-form__repos">
        <legend className="rg-field__label">Repo</legend>
        {connection.state === "loading" && (
          <div className="rg-field__hint">Loading repos from GitHub…</div>
        )}
        {connection.state === "error" && <FormAlert>{connection.message}</FormAlert>}
        {listed && (
          <>
            <RepoPicker repos={connection.repos} selected={picked} onChange={setPicked} />
            {connection.truncated && (
              <div className="rg-field__hint">
                GitHub listed more repos than the office shows; use Other repo… for the rest.
              </div>
            )}
          </>
        )}
        {listed ? (
          <details className="rg-operation-form__other">
            <summary>Other repo…</summary>
            {typedRows}
          </details>
        ) : (
          typedRows
        )}
        {connection.state === "none" && (
          <div className="rg-field__hint">
            Connect GitHub in Settings to pick repos from a list instead of typing them.
          </div>
        )}
      </fieldset>
      {error && <FormAlert>{error}</FormAlert>}
      <div className="rg-field__hint">
        Next you pick the room's size, place and door on the compound map.
      </div>
      <Button variant="primary" type="submit">
        Choose a spot…
      </Button>
    </form>
  );
}

/** The level a new room for `repo` (`owner/name` or a GitHub URL) is built on, as far as we know it. */
export function levelForRepo(repo: string): string {
  const path = repo.trim().replace(/^https?:\/\/[^/]+\//i, "");
  const owner = levelLoginOf(path.split("/")[0] ?? "");
  const levels = levelList(useBuildingStore.getState().state);
  return levels.find((l) => l.login !== "" && l.login === owner)?.levelId ?? DRAFT_LEVEL_ID;
}

/**
 * Mounted in the HUD; managers only. The form hands over to build mode,
 * which creates the operation once its room is placed.
 */
export function AddOperationDialogHost({ github = defaultGitHubApi }: { github?: GitHubApi }) {
  const open = useUiStore((s) => s.overlay === ADD_OPERATION_OVERLAY);
  const close = useUiStore((s) => s.closeOverlay);
  const allowed = useSessionStore((s) => canManageOffice(s.user?.role));
  const [draft, setDraft] = useState<AddOperationDraft | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Back from build mode with a refusal: the form starts from what was typed.
  useEffect(() => {
    if (open) setDraft(takeAddOperationDraft());
  }, [open]);
  // Back from the GitHub App manifest flow: show the result in Settings.
  useGitHubResultOverlay();
  // Back from linking a GitHub account (#267): show the result in Settings → You.
  useGitHubLinkResultOverlay();
  if (!allowed) return null;
  const toBuildMode = (request: AddOperationRequest) => {
    // The room goes on its repo owner's level (#268): build mode shows that level's grid.
    // An owner without a level yet gets a new one: the spot is picked on the empty grid
    // that level will have, with its lift landing (the draft level, #269).
    const levelId = levelForRepo(request.repos[0]?.repo ?? "");
    if (levelId === DRAFT_LEVEL_ID) showDraftLevel();
    else if (levelId !== useLevelStore.getState().levelId) {
      useLevelStore.getState().set(levelId);
      syncCompoundWorld();
    }
    const world = useCompoundStore.getState().world;
    if (!world) {
      setError("The compound map is still loading. Try again in a moment.");
      return;
    }
    setError(null);
    useBuildModeStore.getState().start(world, { kind: "create", request }, buildFrame(world));
  };
  return (
    <Modal
      open={open}
      onClose={() => close(ADD_OPERATION_OVERLAY)}
      title="New operation"
      width={560}
    >
      <AddOperationForm
        key={draft ? "draft" : "new"}
        github={github}
        draft={draft}
        onSubmit={toBuildMode}
      />
      {error && <FormAlert>{error}</FormAlert>}
    </Modal>
  );
}
