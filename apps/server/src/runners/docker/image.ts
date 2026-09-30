/**
 * The runner image (#151): whether it is there, pulling it when it is not,
 * and which image id its tag points at now (to notice a rebuild).
 */
import { DockerApiError, type EngineClient } from "./engine.ts";

/** The runner image is neither on the host nor pullable (#151 `runner_image_missing`). */
export class RunnerImageMissingError extends Error {
  override name = "RunnerImageMissingError";
  constructor(
    readonly image: string,
    readonly detail: string,
  ) {
    super(`the runner image ${image} is not on the Docker host and could not be pulled`);
  }
}

/** `create` said the image is missing (a 404 can also be a missing network). */
export const isImageMissing = (err: unknown): boolean =>
  err instanceof DockerApiError && err.status === 404 && /no such image/i.test(err.message);

/** Pull `image`; a failure means the image stays missing. */
export async function pullImage(engine: EngineClient, image: string): Promise<void> {
  const res = await engine.request("POST", "/images/create", { query: { fromImage: image } });
  const text = await res.text();
  const failure = text
    .split("\n")
    .map((line) => {
      try {
        return (JSON.parse(line) as { error?: string }).error;
      } catch {
        return undefined;
      }
    })
    .find(Boolean);
  if (!res.ok || failure) {
    throw new RunnerImageMissingError(image, `pull failed: ${failure ?? res.status}`);
  }
}

/** How long an image tag's id is trusted before it is looked up again. */
export const IMAGE_ID_TTL_MS = 10_000;

/**
 * The id the runner image tag points at now, briefly cached; null when the
 * tag is missing or cannot be inspected (then nothing counts as drifted).
 * `GET /images/{name}/json` is on the #95 socket-proxy allowlist.
 */
export class ImageIds {
  readonly #cache = new Map<string, { id: string | null; at: number }>();

  constructor(
    private readonly engine: EngineClient,
    private readonly ttlMs: number = IMAGE_ID_TTL_MS,
  ) {}

  async current(image: string): Promise<string | null> {
    const hit = this.#cache.get(image);
    if (hit && Date.now() - hit.at < this.ttlMs) return hit.id;
    let id: string | null = null;
    try {
      id = (await this.engine.json<{ Id: string }>("GET", `/images/${image}/json`)).Id ?? null;
    } catch {
      id = null;
    }
    this.#cache.set(image, { id, at: Date.now() });
    return id;
  }

  /** Forget cached ids (after a pull or recreate the tag may point elsewhere). */
  forget(image: string): void {
    this.#cache.delete(image);
  }
}
