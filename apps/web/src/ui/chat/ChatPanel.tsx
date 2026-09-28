/**
 * Lobby chat (issue #91, SPEC §6 channel 1): a collapsible HUD panel,
 * bottom-left, that renders `BuildingState.chat` and sends the `chat`
 * command. T or Enter (when nothing else is focused) focuses the input;
 * Enter sends, Escape blurs. Typing never walks the avatar or fires hotkeys
 * because both handlers ignore text fields. Stable hooks for e2e tests:
 * `data-testid="chat-input"` and `data-testid="chat-log"`.
 */
import type { ChatMessage, CommandRejected } from "@regulus/protocol";
import {
  type FormEvent,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { flushSync } from "react-dom";
import { getOfficeClient } from "../../net/index.ts";
import { selectSelf, useBuildingStore } from "../../state/building.ts";
import { useSessionStore } from "../../state/session.ts";
import { useUiStore } from "../../state/ui.ts";
import { Button } from "../components/Button.tsx";
import type { HotkeyEventDetail } from "../hotkeys/registry.ts";
import { FOCUS_CHAT_HOTKEYS } from "../hotkeys/registry.ts";
import { useHotkeyEvents } from "../hotkeys/useHotkeys.ts";
import { Panel } from "../Panel.tsx";
import {
  CHAT_MAX_LENGTH,
  chatDateTime,
  createChatSelector,
  formatChatTime,
  isOwnMessage,
  prepareChat,
  unreadCount,
} from "./chatModel.ts";
import "./chat.css";

/** The slice of `OfficeClient` the panel uses; injectable for tests. */
export interface ChatClient {
  send(type: "chat", payload: { text: string }): void;
  onRejected(listener: (notice: CommandRejected) => void): () => void;
}

/** Rejections and send failures auto-dismiss instead of piling up as sticky errors. */
const ERROR_TOAST_MS = 8000;
/** Within this many pixels of the bottom the log keeps following new lines. */
const STICK_SLACK_PX = 32;

export function ChatLine({ message, own }: { message: ChatMessage; own: boolean }) {
  return (
    <li className={own ? "rg-chat__line rg-chat__line--own" : "rg-chat__line"}>
      <span className="rg-chat__meta">
        <span className="rg-chat__author">{message.displayName}</span>
        {own && <span className="rg-sr-only"> (you)</span>}{" "}
        <time
          className="rg-chat__time"
          dateTime={chatDateTime(message.ts)}
          title={new Date(message.ts).toLocaleString()}
        >
          {formatChatTime(message.ts)}
        </time>
      </span>
      <span className="rg-chat__text">{message.text}</span>
    </li>
  );
}

export function ChatPanel({ client }: { client?: ChatClient }) {
  const selectChat = useMemo(() => createChatSelector(), []);
  const messages = useBuildingStore((s) => selectChat(s.state?.chat));
  const selfUserId = useBuildingStore((s) => selectSelf(s)?.userId ?? null);
  const sessionUserId = useSessionStore((s) => s.user?.id ?? null);
  const ownId = selfUserId || sessionUserId;
  const toast = useUiStore((s) => s.toast);

  const [collapsed, setCollapsed] = useState(false);
  /** Id of the newest line when the panel was collapsed ("" if none); null while open. */
  const [lastSeenId, setLastSeenId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const logRef = useRef<HTMLOListElement>(null);
  const stickRef = useRef(true);
  const ids = { heading: useId(), body: useId(), input: useId() };
  const unread = unreadCount(messages, collapsed ? lastSeenId : null);

  const chatClient = useCallback(() => client ?? getOfficeClient(), [client]);

  useEffect(
    () =>
      chatClient().onRejected((notice) => {
        if (notice.type !== "chat") return;
        toast({
          kind: "error",
          title: "Message not sent",
          message: notice.reason,
          durationMs: ERROR_TOAST_MS,
        });
      }),
    [chatClient, toast],
  );

  const focusInput = useCallback(() => {
    flushSync(() => setCollapsed(false));
    setLastSeenId(null);
    inputRef.current?.focus();
  }, []);

  useHotkeyEvents(
    useCallback(
      (detail: HotkeyEventDetail) => {
        if (FOCUS_CHAT_HOTKEYS.has(detail.id)) focusInput();
      },
      [focusInput],
    ),
  );

  // Follow new lines while the reader is at the bottom, and always after our own.
  useLayoutEffect(() => {
    const log = logRef.current;
    if (!log || collapsed || messages.length === 0) return;
    const newest = messages[messages.length - 1];
    if (stickRef.current || (newest && isOwnMessage(newest, ownId))) {
      log.scrollTop = log.scrollHeight;
      stickRef.current = true;
    }
  }, [messages, collapsed, ownId]);

  const onScroll = () => {
    const log = logRef.current;
    if (!log) return;
    stickRef.current = log.scrollHeight - log.scrollTop - log.clientHeight <= STICK_SLACK_PX;
  };

  const toggle = () => {
    if (collapsed) {
      setCollapsed(false);
      setLastSeenId(null);
    } else {
      setCollapsed(true);
      setLastSeenId(messages[messages.length - 1]?.id ?? "");
    }
  };

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const input = inputRef.current;
    if (!input) return;
    const prepared = prepareChat(input.value);
    if (!prepared.ok) {
      if (prepared.reason !== "empty") {
        toast({
          kind: "warning",
          title: "Message too long",
          message: `Chat lines are limited to ${CHAT_MAX_LENGTH} characters.`,
        });
      }
      return;
    }
    try {
      chatClient().send("chat", { text: prepared.text });
    } catch {
      toast({
        kind: "error",
        title: "Message not sent",
        message: "Not connected to the office yet. Your message is still in the box.",
        durationMs: ERROR_TOAST_MS,
      });
      return;
    }
    input.value = "";
    stickRef.current = true;
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Escape") return;
    // Keep Escape from also leaving first-person view (FirstPersonRig listens on window).
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.blur();
  };

  return (
    <Panel as="section" flush className="rg-chat" aria-labelledby={ids.heading}>
      <div className="rg-chat__header">
        <h2 id={ids.heading} className="rg-chat__title">
          Chat
        </h2>
        {unread > 0 && (
          <span className="rg-chat__badge">
            {unread}
            <span className="rg-sr-only"> unread</span>
          </span>
        )}
        <button
          type="button"
          className="rg-chat__toggle"
          aria-expanded={!collapsed}
          aria-controls={ids.body}
          onClick={toggle}
        >
          {collapsed ? "Show" : "Hide"}
          <span className="rg-sr-only"> chat</span>
        </button>
      </div>
      <div id={ids.body} className="rg-chat__body" hidden={collapsed}>
        <ol
          ref={logRef}
          className="rg-chat__log"
          role="log"
          aria-live="polite"
          aria-label="Chat messages"
          data-testid="chat-log"
          // Focusable so keyboard users can scroll the history.
          tabIndex={0}
          onScroll={onScroll}
        >
          {messages.length === 0 && <li className="rg-chat__empty">No messages yet. Say hi!</li>}
          {messages.map((m) => (
            <ChatLine key={m.id} message={m} own={isOwnMessage(m, ownId)} />
          ))}
        </ol>
        <form className="rg-chat__form" aria-label="Send a chat message" onSubmit={onSubmit}>
          <label htmlFor={ids.input} className="rg-sr-only">
            Chat message
          </label>
          <input
            ref={inputRef}
            id={ids.input}
            className="rg-chat__input"
            type="text"
            data-testid="chat-input"
            maxLength={CHAT_MAX_LENGTH}
            autoComplete="off"
            enterKeyHint="send"
            placeholder="Press T to chat"
            onKeyDown={onKeyDown}
          />
          <Button type="submit" variant="primary" size="sm">
            Send
          </Button>
        </form>
      </div>
    </Panel>
  );
}
