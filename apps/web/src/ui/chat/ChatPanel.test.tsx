import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { BuildingState, ChatMessage, CommandRejected } from "@regulus/protocol";
import { buildingFixture, humanFixture } from "@regulus/protocol/src/fixtures.ts";
import { act, type RefObject } from "react";
import { useWasdInput } from "../../scene/movement/useWasdInput.ts";
import type { KeyState } from "../../scene/movement/wasd.ts";
import { useBuildingStore } from "../../state/building.ts";
import { useUiStore } from "../../state/ui.ts";
import { click, type Mounted, mount, press, useDom } from "../a11y/dom.ts";
import { useGlobalHotkeys } from "../hotkeys/useHotkeys.ts";
import { type ChatClient, ChatPanel } from "./ChatPanel.tsx";
import { CHAT_MAX_LENGTH } from "./chatModel.ts";

useDom();

class FakeChatClient implements ChatClient {
  sent: Array<{ type: string; text: string }> = [];
  fail = false;
  private listeners = new Set<(n: CommandRejected) => void>();
  send(type: "chat", payload: { text: string }) {
    if (this.fail) throw new Error('Cannot send "chat": building room not joined');
    this.sent.push({ type, text: payload.text });
  }
  onRejected(listener: (n: CommandRejected) => void) {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  }
  reject(notice: CommandRejected) {
    for (const l of this.listeners) l(notice);
  }
  get listenerCount() {
    return this.listeners.size;
  }
}

const msg = (id: string, userId: string, displayName: string, text: string): ChatMessage => ({
  id,
  userId,
  displayName,
  operationId: "lobby",
  text,
  ts: new Date(2026, 8, 28, 14, 5).getTime(),
});

function building(chat: ChatMessage[]): BuildingState {
  return { ...structuredClone(buildingFixture), chat };
}

const setChat = (chat: ChatMessage[]) =>
  act(async () => useBuildingStore.getState().apply(building(chat)));

const input = () => document.querySelector('[data-testid="chat-input"]') as HTMLInputElement;
const log = () => document.querySelector('[data-testid="chat-log"]') as HTMLOListElement;
const form = () => document.querySelector("form.rg-chat__form") as HTMLFormElement;
const toasts = () => useUiStore.getState().toastQueue.toasts;

async function type(value: string) {
  // The input is uncontrolled: setting the DOM value is what typing does.
  await act(async () => {
    input().value = value;
  });
}

async function submit() {
  await act(async () => {
    form().dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
}

function Host({ client, keys }: { client: ChatClient; keys?: { ref?: RefObject<KeyState> } }) {
  useGlobalHotkeys();
  const held = useWasdInput();
  if (keys) keys.ref = held;
  return (
    <>
      <button type="button" id="other">
        Other
      </button>
      <ChatPanel client={client} />
    </>
  );
}

let m: Mounted | null = null;
let client: FakeChatClient;

beforeEach(async () => {
  client = new FakeChatClient();
  await act(async () => {
    useBuildingStore.getState().clear();
    useBuildingStore.getState().setSessionId(humanFixture.sessionId);
    useUiStore.getState().clearToasts();
    useUiStore.setState({ overlay: null });
  });
});

afterEach(async () => {
  await m?.unmount();
  m = null;
});

describe("ChatPanel", () => {
  test("renders the building chat with author, time and own lines marked", async () => {
    await setChat([
      msg("m1", humanFixture.userId, "Ante", "hello office"),
      msg("m2", "u2", "Bob", "hi Ante"),
    ]);
    m = await mount(<ChatPanel client={client} />);
    const list = log();
    expect(list.getAttribute("role")).toBe("log");
    expect(list.getAttribute("aria-live")).toBe("polite");
    expect(list.getAttribute("aria-label")).toBe("Chat messages");
    const lines = list.querySelectorAll("li.rg-chat__line");
    expect(lines).toHaveLength(2);
    expect(lines[0]?.classList.contains("rg-chat__line--own")).toBe(true);
    expect(lines[0]?.textContent).toContain("(you)");
    expect(lines[1]?.classList.contains("rg-chat__line--own")).toBe(false);
    expect(lines[1]?.querySelector(".rg-chat__author")?.textContent).toBe("Bob");
    expect(lines[1]?.querySelector(".rg-chat__text")?.textContent).toBe("hi Ante");
    expect(lines[1]?.querySelector("time")?.textContent).toMatch(/14[:.]05/);

    // New lines from the room appear; an unchanged patch keeps the same nodes.
    const before = list.querySelector("li");
    await setChat([
      msg("m1", humanFixture.userId, "Ante", "hello office"),
      msg("m2", "u2", "Bob", "hi Ante"),
    ]);
    expect(list.querySelector("li")).toBe(before);
    await setChat([
      msg("m1", humanFixture.userId, "Ante", "hello office"),
      msg("m2", "u2", "Bob", "hi Ante"),
      msg("m3", "u2", "Bob", "lunch?"),
    ]);
    expect(list.querySelectorAll("li.rg-chat__line")).toHaveLength(3);
  });

  test("shows an empty hint before anyone speaks", async () => {
    m = await mount(<ChatPanel client={client} />);
    expect(log().textContent).toContain("No messages yet");
    expect(input().getAttribute("aria-label") ?? input().labels?.[0]?.textContent).toBe(
      "Chat message",
    );
  });

  test("Enter sends the trimmed text through the client and clears the input", async () => {
    m = await mount(<ChatPanel client={client} />);
    await type("  hello there  ");
    await submit();
    expect(client.sent).toEqual([{ type: "chat", text: "hello there" }]);
    expect(input().value).toBe("");
    await type("   ");
    await submit();
    expect(client.sent).toHaveLength(1);
    expect(toasts()).toHaveLength(0);
  });

  test("respects the protocol length limit", async () => {
    m = await mount(<ChatPanel client={client} />);
    expect(input().maxLength).toBe(CHAT_MAX_LENGTH);
    await type("x".repeat(CHAT_MAX_LENGTH + 1));
    await submit();
    expect(client.sent).toHaveLength(0);
    expect(toasts()[0]?.title).toBe("Message too long");
    await type("x".repeat(CHAT_MAX_LENGTH));
    await submit();
    expect(client.sent[0]?.text).toHaveLength(CHAT_MAX_LENGTH);
  });

  test("a send while disconnected toasts and keeps the text", async () => {
    client.fail = true;
    m = await mount(<ChatPanel client={client} />);
    await type("are you there?");
    await submit();
    expect(input().value).toBe("are you there?");
    expect(toasts()[0]?.kind).toBe("error");
  });

  test("server rejections of chat commands show a toast; other commands do not", async () => {
    m = await mount(<ChatPanel client={client} />);
    await act(async () => client.reject({ type: "move", reason: "invalid move: out of bounds" }));
    expect(toasts()).toHaveLength(0);
    await act(async () => client.reject({ type: "chat", reason: "invalid chat: text: too big" }));
    expect(toasts()[0]?.title).toBe("Message not sent");
    expect(toasts()[0]?.message).toBe("invalid chat: text: too big");
    await m.unmount();
    m = null;
    expect(client.listenerCount).toBe(0);
  });

  test("T or Enter focuses the input; Escape blurs; Enter on a focused button does not", async () => {
    m = await mount(<Host client={client} />);
    await press(document.body, "t");
    expect(document.activeElement).toBe(input());
    await press(input(), "Escape");
    expect(document.activeElement).not.toBe(input());

    await press(document.body, "Enter");
    expect(document.activeElement).toBe(input());
    await press(input(), "Escape");

    const other = document.getElementById("other") as HTMLButtonElement;
    other.focus();
    await press(other, "Enter");
    expect(document.activeElement).toBe(other);
    // T is not a button key, so it still jumps to chat from a focused button.
    await press(other, "t");
    expect(document.activeElement).toBe(input());
  });

  test("typing in the chat input neither walks the avatar nor fires hotkeys", async () => {
    const keys: { ref?: RefObject<KeyState> } = {};
    m = await mount(<Host client={client} keys={keys} />);
    await press(document.body, "t");
    await press(input(), "w");
    await press(input(), "?");
    expect(Object.values(keys.ref?.current ?? {}).some(Boolean)).toBe(false);
    expect(useUiStore.getState().overlay).toBeNull();
    // Outside the input the same key does walk.
    await press(input(), "Escape");
    await press(document.body, "w");
    expect(Object.values(keys.ref?.current ?? {}).some(Boolean)).toBe(true);
  });

  test("collapses, counts unread lines, and the hotkey reopens it", async () => {
    await setChat([msg("m1", "u2", "Bob", "one")]);
    m = await mount(<Host client={client} />);
    const toggle = document.querySelector(".rg-chat__toggle") as HTMLButtonElement;
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    await click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect((document.querySelector(".rg-chat__body") as HTMLElement).hidden).toBe(true);
    expect(document.querySelector(".rg-chat__badge")).toBeNull();
    await setChat([msg("m1", "u2", "Bob", "one"), msg("m2", "u2", "Bob", "two")]);
    expect(document.querySelector(".rg-chat__badge")?.textContent).toBe("1 unread");
    toggle.blur();
    await press(document.body, "t");
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(document.activeElement).toBe(input());
    expect(document.querySelector(".rg-chat__badge")).toBeNull();
  });
});
