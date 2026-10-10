/**
 * What a board helper tells whoever walks up to it (#56): its board in a
 * headline and a few lines, read from the office when the window opens. The
 * office makes it from the board as it is, so it costs nothing; the chat
 * below it is for questions and for asking it to queue work.
 */
import { type KioskBrief as Brief, KIOSK_BOARD_LABELS } from "@regulus/protocol";
import { useEffect, useState } from "react";
import type { OfficeAgentsApi } from "./api.ts";
import { KIOSK_WORDS } from "./labels.ts";

export function KioskBrief({ api, agentId }: { api: OfficeAgentsApi; agentId: string }) {
  const [brief, setBrief] = useState<Brief | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    setBrief(null);
    setFailed(false);
    void api.brief(agentId).then((res) => {
      if (!live) return;
      if (res.ok) setBrief(res.data);
      else setFailed(true);
    });
    return () => {
      live = false;
    };
  }, [api, agentId]);

  if (failed) return <p className="rg-field__hint">{KIOSK_WORDS.briefFailed}</p>;
  if (!brief) return <p className="rg-field__hint">Reading the board…</p>;
  return (
    <section
      className="rg-kiosk-brief"
      aria-label={`${KIOSK_BOARD_LABELS[brief.board]} of ${brief.operationName}`}
      data-testid="kiosk-brief"
    >
      <div className="rg-kiosk-brief__where">
        {KIOSK_BOARD_LABELS[brief.board]} · {brief.operationName}
      </div>
      <strong className="rg-kiosk-brief__headline">{brief.headline}</strong>
      {brief.lines.length > 0 && (
        <ul className="rg-kiosk-brief__lines">
          {brief.lines.map((line, i) => (
            <li key={i}>{line}</li>
          ))}
        </ul>
      )}
      <div className="rg-field__hint">
        {brief.canEnqueue ? KIOSK_WORDS.canEnqueue : KIOSK_WORDS.cannotEnqueue}
      </div>
    </section>
  );
}
