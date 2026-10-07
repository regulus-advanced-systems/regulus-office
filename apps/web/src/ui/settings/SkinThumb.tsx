/**
 * A skin or form thumbnail (#225, #281): a still image drawn once per skin and trim by the
 * single offscreen renderer in skinThumbRenderer.ts (loaded on first use).
 * Without WebGL (or until the image is ready) a plain plate with the skin's
 * initial stands in. Purely decorative: the label next to it names the skin.
 */
import { CHARACTER_FORM_LABELS, type CharacterFormId } from "@regulus/protocol";
import { useEffect, useState } from "react";

type Render = (skin: string, trim: string | undefined) => string | null;

const cache = new Map<string, string | null>();
let renderer: Promise<Render | null> | null = null;

function loadRenderer(): Promise<Render | null> {
  renderer ??= import("./skinThumbRenderer.ts")
    .then((m) => m.renderSkinThumbnail)
    .catch(() => null);
  return renderer;
}

const keyOf = (skin: string, trim: string | undefined) => `${skin}|${trim ?? ""}`;

/** The thumbnail's data URL once drawn; null while drawing or when it cannot be. */
export function useSkinThumbnail(skin: CharacterFormId, trim: string | undefined): string | null {
  const key = keyOf(skin, trim);
  const [url, setUrl] = useState<string | null>(() => cache.get(key) ?? null);
  useEffect(() => {
    if (cache.has(key)) {
      setUrl(cache.get(key) ?? null);
      return;
    }
    let live = true;
    void loadRenderer().then((render) => {
      if (!cache.has(key)) {
        let drawn: string | null = null;
        try {
          drawn = render?.(skin, trim) ?? null;
        } catch {
          drawn = null;
        }
        cache.set(key, drawn);
      }
      if (live) setUrl(cache.get(key) ?? null);
    });
    return () => {
      live = false;
    };
  }, [key, skin, trim]);
  return url;
}

export function SkinThumb({
  skin,
  trim,
  size = "md",
}: {
  /** A henchman skin or an office-agent form (#281). */
  skin: CharacterFormId;
  trim: string | undefined;
  size?: "sm" | "md";
}) {
  const url = useSkinThumbnail(skin, trim);
  return (
    <span className={`rg-skin-thumb rg-skin-thumb--${size}`} aria-hidden="true">
      {url ? (
        <img src={url} alt="" draggable={false} />
      ) : (
        <span className="rg-skin-thumb__fallback">{CHARACTER_FORM_LABELS[skin].charAt(0)}</span>
      )}
    </span>
  );
}
