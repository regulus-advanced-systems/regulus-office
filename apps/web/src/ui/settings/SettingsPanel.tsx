/**
 * Settings (SPEC §11, #225): a wide dialog with tabs on a rail at the left
 * (a wrapping row of tabs on narrow screens). Rendered inside a Modal by
 * the HUD.
 *
 * - You: the account (invites, sign-out) and your genius.
 * - Office (owners and admins): GitHub, archived operations, AI providers.
 * - Henchmen (owners and admins): henchman skin rules.
 * - Agents: office agents, shared and personal (#271).
 * - Notifications: desktop notifications and team channels.
 * - Display and sound: graphics, first person, motion, volume, clock.
 *
 * The open tab is remembered for the session (settingsTabs.ts).
 */
import { type ReactNode, useSyncExternalStore } from "react";
import { useSessionStore } from "../../state/session.ts";
import { AccountSection } from "../auth/AccountSection.tsx";
import { GeniusSettingsSection } from "../avatar-picker/GeniusSettingsSection.tsx";
import { Button } from "../components/Button.tsx";
import { type TabItem, Tabs } from "../components/Tabs.tsx";
import { OfficeAgentsSection } from "../office-agents/OfficeAgentsSection.tsx";
import { openProvidersPanel } from "../providers/providersStore.ts";
import { DisplaySettings } from "./DisplaySettings.tsx";
import { GitHubSection } from "./GitHubSection.tsx";
import { NotificationsSection } from "./NotificationsSection.tsx";
import { OperationsSection } from "./OperationsSection.tsx";
import { SkinRulesSection } from "./SkinRulesSection.tsx";
import {
  effectiveSettingsTab,
  SETTINGS_TAB_LABELS,
  type SettingsTabId,
  useSettingsTabStore,
  visibleSettingsTabs,
} from "./settingsTabs.ts";
import "./settings.css";

/** Where the rail stands at the left; below it, the tabs wrap above the panel. */
const RAIL_QUERY = "(min-width: 760px)";

function subscribeRail(onChange: () => void): () => void {
  try {
    const mq = window.matchMedia(RAIL_QUERY);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  } catch {
    return () => {};
  }
}

function railNow(): boolean {
  try {
    return window.matchMedia(RAIL_QUERY).matches;
  } catch {
    return true;
  }
}

function YouPanel() {
  return (
    <div className="rg-settings__columns">
      <AccountSection />
      <GeniusSettingsSection />
    </div>
  );
}

function ProvidersSection() {
  return (
    <section className="rg-settings__group" aria-label="AI providers">
      <h3 className="rg-settings__heading">AI providers</h3>
      <div className="rg-field__hint">
        Sign in to Claude Code or Codex in your own runner, or add API and plan keys.
      </div>
      <div>
        <Button variant="secondary" size="sm" onClick={() => openProvidersPanel()}>
          Connect providers
        </Button>
      </div>
    </section>
  );
}

function OfficePanel() {
  return (
    <div className="rg-settings__columns">
      <GitHubSection />
      <div className="rg-settings__stack">
        <ProvidersSection />
        <OperationsSection />
      </div>
    </div>
  );
}

const RENDER: Readonly<Record<SettingsTabId, () => ReactNode>> = {
  you: () => <YouPanel />,
  office: () => <OfficePanel />,
  henchmen: () => <SkinRulesSection />,
  agents: () => <OfficeAgentsSection />,
  notifications: () => (
    <div className="rg-settings__columns">
      <NotificationsSection />
    </div>
  ),
  display: () => <DisplaySettings />,
};

export function SettingsForm() {
  const role = useSessionStore((s) => s.user?.role);
  const chosen = useSettingsTabStore((s) => s.tab);
  const setTab = useSettingsTabStore((s) => s.setTab);
  const rail = useSyncExternalStore(subscribeRail, railNow, () => true);
  const tabs: TabItem<SettingsTabId>[] = visibleSettingsTabs(role).map((id) => ({
    id,
    label: SETTINGS_TAB_LABELS[id],
    render: RENDER[id],
  }));

  return (
    <Tabs
      label="Settings sections"
      className="rg-settings"
      tabs={tabs}
      active={effectiveSettingsTab(chosen, role)}
      onSelect={setTab}
      orientation={rail ? "vertical" : "horizontal"}
    />
  );
}
