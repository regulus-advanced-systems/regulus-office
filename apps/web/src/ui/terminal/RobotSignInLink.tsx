/**
 * The sign-in link bar (#156) in a robot's terminal (#158): when the robot's
 * CLI shows its sign-in screen (e.g. Claude Code's first-run login), its
 * owner gets the link with Open and Copy, as in Connect providers. Shown only
 * to the robot's owner and only once a link is found; the link is read from
 * the terminal in this browser and never sent to the office or logged.
 */
import { isCliLoginProvider, type ProviderId } from "@regulus/protocol";
import { SignInLinkBar, useSignInLink } from "../providers/SignInLinkBar.tsx";
import type { TerminalHost } from "./host.ts";
import "../providers/providers.css";

export function RobotSignInLink({
  host,
  provider,
  isOwner,
}: {
  host: TerminalHost | null;
  provider: ProviderId | undefined;
  isOwner: boolean;
}) {
  const loginProvider = provider && isCliLoginProvider(provider) ? provider : null;
  const url = useSignInLink(isOwner && loginProvider ? host : null, loginProvider ?? "claude-code");
  if (!isOwner || !loginProvider || !url) return null;
  return (
    <div className="rg-term__sign-in" data-testid="robot-sign-in-link">
      <SignInLinkBar url={url} />
    </div>
  );
}
