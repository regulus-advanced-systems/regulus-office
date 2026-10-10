/**
 * What dictation tells the person (#260), as a card at the bottom of the
 * window: where the audio goes before the first use, the browser's one-time
 * download, the choice of the browser's online service (with who then gets
 * the audio), a terminal that is only watched, and problems.
 *
 * The buttons do not take keyboard focus, so it stays in the box being
 * dictated into.
 */
import type { ReactNode } from "react";
import { Button } from "../components/Button.tsx";
import type { DictationController } from "./controller.ts";
import { type DictationNotice, useDictationStore } from "./dictationStore.ts";
import { ENGINE_AUDIO } from "./engine.ts";
import { DICTATION_HOTKEY } from "./holdKey.ts";

const KEY = DICTATION_HOTKEY.key;

export function MicIcon() {
  return (
    <svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" aria-hidden="true">
      <rect x="9" y="3" width="6" height="11" rx="3" fill="currentColor" />
      <path
        d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3M8.5 21h7"
        stroke="currentColor"
        strokeWidth={2.2}
        strokeLinecap="round"
      />
    </svg>
  );
}

const keepFocus = (e: { preventDefault(): void }) => e.preventDefault();

interface NoticeText {
  title: string;
  body: ReactNode;
  tone: "info" | "warning" | "error";
  actions?: ReactNode;
}

function noticeText(notice: DictationNotice, c: DictationController): NoticeText {
  const later = (
    <Button size="sm" variant="ghost" onMouseDown={keepFocus} onClick={() => c.dismissNotice()}>
      Not now
    </Button>
  );
  switch (notice.kind) {
    case "intro":
      return {
        title: "Dictation",
        tone: "info",
        body: (
          <>
            Hold {KEY} or the mic button and speak; let go to stop. Your words are typed where the
            cursor is, and nothing is sent until you press Enter. {ENGINE_AUDIO.local} Your browser
            asks for the microphone the first time.
          </>
        ),
        actions: (
          <Button
            size="sm"
            variant="primary"
            data-testid="dictation-intro-ok"
            onMouseDown={keepFocus}
            onClick={() => c.acknowledgeIntro()}
          >
            Got it
          </Button>
        ),
      };
    case "download":
      return {
        title: "One download first",
        tone: "info",
        body: (
          <>
            To turn speech into text on this computer, your browser needs its speech pack for{" "}
            {c.lang()}. It downloads it once from its maker; your audio stays here.
          </>
        ),
        actions: (
          <>
            {later}
            <Button
              size="sm"
              variant="primary"
              data-testid="dictation-download"
              onMouseDown={keepFocus}
              onClick={() => void c.download()}
            >
              Download
            </Button>
          </>
        ),
      };
    case "downloading":
      return {
        title: "Downloading",
        tone: "info",
        body: "Your browser is downloading its speech pack. Try again in a moment.",
      };
    case "downloaded":
      return { title: "Ready", tone: "info", body: `Hold ${KEY} and speak.` };
    case "local-unavailable":
      return {
        title: "Not on this computer",
        tone: "warning",
        body: (
          <>
            This browser cannot turn speech ({c.lang()}) into text on this computer; recent Chrome
            and Edge on a desktop can. It can use its online service instead. {ENGINE_AUDIO.vendor}
          </>
        ),
        actions: (
          <>
            {later}
            <Button
              size="sm"
              variant="secondary"
              data-testid="dictation-use-vendor"
              onMouseDown={keepFocus}
              onClick={() => c.useVendor()}
            >
              Use the online service
            </Button>
          </>
        ),
      };
    case "unsupported":
      return {
        title: "No dictation in this browser",
        tone: "warning",
        body: "This browser has no speech recognition. Chrome and Edge have it.",
        actions: later,
      };
    case "watch-only":
      return {
        title: "Watching only",
        tone: "warning",
        body: "Only this henchman's owner can type or dictate into its terminal.",
      };
    case "error":
      return { title: "Dictation", tone: "error", body: notice.message };
  }
}

export function DictationNoticeCard({ controller }: { controller: DictationController }) {
  const notice = useDictationStore((s) => s.notice);
  if (!notice) return null;
  const text = noticeText(notice, controller);
  return (
    <div
      className={`rg-toast rg-toast--${text.tone} rg-dictation-notice`}
      role={text.tone === "error" ? "alert" : "status"}
      data-testid="dictation-notice"
      data-kind={notice.kind}
    >
      <span className="rg-toast__icon">
        <MicIcon />
      </span>
      <div>
        <div className="rg-toast__title">{text.title}</div>
        <div className="rg-dictation-notice__body">{text.body}</div>
        {text.actions && <div className="rg-dictation-notice__actions">{text.actions}</div>}
      </div>
    </div>
  );
}
