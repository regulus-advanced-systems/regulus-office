/**
 * Before/after image previews (#38). The bytes come from the blob route as
 * `application/octet-stream`; the client checks the magic number again and
 * wraps them in a Blob of that raster type, shown through a `blob:` URL
 * that is revoked when the preview goes away. SVG is never previewed (it
 * is diffed as text), so nothing a robot writes can run as a document.
 */
import type { ImageSide } from "@regulus/protocol";
import { useEffect, useState } from "react";
import { type ChangesApi, describeChangesFailure } from "./api.ts";

type State =
  | { status: "loading" }
  | { status: "ready"; url: string }
  | { status: "error"; text: string };

function useImageUrl(api: ChangesApi, agentId: string, path: string, side: ImageSide, key: string) {
  const [state, setState] = useState<State>({ status: "loading" });
  useEffect(() => {
    let alive = true;
    let url: string | null = null;
    setState({ status: "loading" });
    void api.image(agentId, path, side).then((res) => {
      if (!alive) return;
      if (!res.ok) {
        setState({ status: "error", text: describeChangesFailure(res) });
        return;
      }
      const copy = new Uint8Array(res.data.bytes);
      url = URL.createObjectURL(new Blob([copy], { type: res.data.type }));
      setState({ status: "ready", url });
    });
    return () => {
      alive = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [api, agentId, path, side, key]);
  return state;
}

function Side({
  api,
  agentId,
  path,
  side,
  version,
}: {
  api: ChangesApi;
  agentId: string;
  path: string;
  side: ImageSide;
  version: string;
}) {
  const state = useImageUrl(api, agentId, path, side, version);
  const label = side === "base" ? "Before" : "After";
  return (
    <figure className="rg-changes-image" data-side={side}>
      <figcaption>{label}</figcaption>
      {state.status === "ready" ? (
        <img src={state.url} alt={`${label}: ${path}`} />
      ) : (
        <p className="rg-field__hint">{state.status === "loading" ? "Loading…" : state.text}</p>
      )}
    </figure>
  );
}

export function ImagePreview(props: {
  api: ChangesApi;
  agentId: string;
  path: string;
  sides: { base: boolean; work: boolean };
  /** Changes when the file does, to reload. */
  version: string;
}) {
  const { sides, ...rest } = props;
  return (
    <div className="rg-changes-images">
      {sides.base && <Side {...rest} side="base" />}
      {sides.work && <Side {...rest} side="work" />}
    </div>
  );
}
