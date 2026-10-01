/**
 * Genius avatars (#185) in the e2e flows: the first-login picker driven by
 * the keyboard, a quick pick by mouse, and a probe for the genius a scene
 * draws for a human (`GeniusAvatar` puts its look on the model's userData).
 */
import { expect, type Page } from "@playwright/test";

export interface GeniusLook {
  archetype: string;
  outfit: string;
  trim: string;
  skin: string;
  hair: string;
  accessory: string;
}

/** The look of the genius drawn under the object named `name` (`local-human`, `human-<sid>`). */
export function geniusOf(page: Page, name: string): Promise<GeniusLook | null> {
  return page.evaluate((objectName) => {
    type Obj = {
      name: string;
      userData: { genius?: unknown };
      traverse(f: (o: Obj) => void): void;
      getObjectByName(n: string): Obj | undefined;
    };
    const r3f = (window as unknown as { __regulusR3F?: { scene: Obj } }).__regulusR3F;
    const holder = r3f?.scene.getObjectByName(objectName);
    let look: unknown = null;
    holder?.traverse((o) => {
      if (!look && o.userData.genius) look = o.userData.genius;
    });
    return look as never;
  }, name);
}

const radio = (page: Page, name: RegExp | string) =>
  page.getByRole("dialog").getByRole("radio", { name });

/**
 * The first-login picker, by keyboard only: turn the preview with the arrow
 * keys, then arrow through each radio group (archetype, outfit, trim, skin,
 * hair, accessory) and save. From the default genius this picks a scientist
 * in crimson with silver trim, tan skin, brown hair and the flask.
 */
export async function pickGeniusByKeyboard(page: Page): Promise<GeniusLook> {
  const dialog = page.getByRole("dialog", { name: "Choose your genius" });
  await expect(dialog).toBeVisible();
  const preview = dialog.getByTestId("genius-preview");
  await preview.focus();
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowLeft");
  await expect(radio(page, /^Mastermind/)).toBeChecked();
  await radio(page, /^Mastermind/).focus();
  await page.keyboard.press("ArrowRight");
  await expect(radio(page, /^Scientist/)).toBeChecked();
  await expect(radio(page, /^Scientist/)).toBeFocused();
  for (const [from, to] of [
    ["Outfit: charcoal", "Outfit: crimson"],
    ["Trim: brass", "Trim: silver"],
    ["Skin: light", "Skin: tan"],
    ["Hair: black", "Hair: brown"],
    ["Goggles", "Flask"],
  ] as const) {
    await page.keyboard.press("Tab");
    await expect(radio(page, from)).toBeFocused();
    await page.keyboard.press("ArrowRight");
    await expect(radio(page, to)).toBeChecked();
  }
  const save = dialog.getByRole("button", { name: "Enter the lair" });
  await save.focus();
  await page.keyboard.press("Enter");
  await expect(dialog).toBeHidden();
  return {
    archetype: "scientist",
    outfit: "crimson",
    trim: "silver",
    skin: "tan",
    hair: "brown",
    accessory: "flask",
  };
}

/** The first-login picker by mouse: one archetype with its starting accessory, then save. */
export async function pickGenius(page: Page, archetype: string): Promise<void> {
  const dialog = page.getByRole("dialog", { name: "Choose your genius" });
  await expect(dialog).toBeVisible();
  await dialog.getByText(archetype, { exact: true }).click();
  await expect(radio(page, new RegExp(`^${archetype}`))).toBeChecked();
  await dialog.getByRole("button", { name: "Enter the lair" }).click();
  await expect(dialog).toBeHidden();
}
