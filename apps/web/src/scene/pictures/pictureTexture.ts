/**
 * A wall picture's texture (#46, SPEC §9.4 "textures loaded via
 * TextureLoader"): the image at `url` (the office's picture endpoint, same
 * origin with the session cookie, or a local object URL for the ghost),
 * loaded once per mounted picture and disposed with it. Null while loading
 * or when it fails (the frame shows a plain face).
 */
import { useEffect, useState } from "react";
import { SRGBColorSpace, type Texture, TextureLoader } from "three";

const loader = new TextureLoader();

export function usePictureTexture(url: string | null): Texture | null {
  const [texture, setTexture] = useState<Texture | null>(null);
  useEffect(() => {
    if (!url) return;
    let alive = true;
    let loaded: Texture | null = null;
    loader.load(
      url,
      (t) => {
        t.colorSpace = SRGBColorSpace;
        t.name = `picture:${url}`;
        if (!alive) return t.dispose();
        loaded = t;
        setTexture(t);
      },
      undefined,
      () => {},
    );
    return () => {
      alive = false;
      loaded?.dispose();
      setTexture(null);
    };
  }, [url]);
  return texture;
}
