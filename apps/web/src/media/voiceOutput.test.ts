/** Remote voice tracks through the shared AudioContext at their spatial level (#48). */
import { describe, expect, test } from "bun:test";
import { createVoiceOutput } from "./voiceOutput.ts";

interface FakeNode {
  kind: string;
  connections: FakeNode[];
  gain: { value: number; targets: number[]; setTargetAtTime(v: number): void };
  connect(n: FakeNode): void;
  disconnect(): void;
  stream?: unknown;
}

function fakeContext() {
  const nodes: FakeNode[] = [];
  const node = (kind: string): FakeNode => {
    const n: FakeNode = {
      kind,
      connections: [],
      gain: {
        value: 1,
        targets: [],
        setTargetAtTime(v: number) {
          this.targets.push(v);
          this.value = v;
        },
      },
      connect(other) {
        n.connections.push(other);
      },
      disconnect() {
        n.connections = [];
      },
    };
    nodes.push(n);
    return n;
  };
  const destination = node("destination");
  return {
    nodes,
    destination,
    ctx: {
      currentTime: 0,
      destination,
      createGain: () => node("gain"),
      createMediaStreamSource: (stream: unknown) => Object.assign(node("source"), { stream }),
    },
  };
}

function fakeElement() {
  return {
    autoplay: false,
    muted: false,
    volume: 1,
    srcObject: null as unknown,
    played: 0,
    paused: false,
    play() {
      this.played += 1;
      return Promise.resolve();
    },
    pause() {
      this.paused = true;
    },
  };
}

const track = (id: string) => ({ id, kind: "audio" }) as unknown as MediaStreamTrack;

describe("voice output", () => {
  test("each remote voice goes source → its own spatial gain → voice master → speakers", () => {
    const f = fakeContext();
    const elements: ReturnType<typeof fakeElement>[] = [];
    const out = createVoiceOutput({
      audio: () => f.ctx as never,
      makeElement: () => {
        const el = fakeElement();
        elements.push(el);
        return el as unknown as HTMLAudioElement;
      },
      makeStream: (t) => ({ tracks: [t] }) as unknown as MediaStream,
    });
    out.attach("s-ada", track("t1"));
    out.attach("s-bob", track("t2"));
    expect(out.ids().sort()).toEqual(["s-ada", "s-bob"]);

    const sources = f.nodes.filter((n) => n.kind === "source");
    expect(sources).toHaveLength(2);
    const spatialAda = sources[0]?.connections[0];
    const master = spatialAda?.connections[0];
    expect(master?.connections[0]).toBe(f.destination);
    expect(sources[1]?.connections[0]?.connections[0]).toBe(master);
    // The element only feeds Web Audio (Chrome needs it playing); it is muted itself.
    expect(elements.every((e) => e.muted && e.played === 1 && e.srcObject !== null)).toBe(true);
    // Silent until the proximity plan gives it a level.
    expect(spatialAda?.gain.value).toBe(0);

    out.setGain("s-ada", 0.42);
    expect(spatialAda?.gain.targets.at(-1)).toBeCloseTo(0.42);
    expect(out.gainOf("s-ada")).toBeCloseTo(0.42);
    out.setGain("s-ada", 3);
    expect(out.gainOf("s-ada")).toBe(1);

    out.setMaster(0.5);
    expect(master?.gain.targets.at(-1)).toBe(0.5);

    out.detach("s-ada");
    expect(out.ids()).toEqual(["s-bob"]);
    expect(sources[0]?.connections).toEqual([]);
    expect(elements[0]?.paused).toBe(true);
    expect(elements[0]?.srcObject).toBeNull();
    out.dispose();
    expect(out.ids()).toEqual([]);
  });

  test("without Web Audio the element plays at the voice's level", () => {
    const el = fakeElement();
    const out = createVoiceOutput({
      audio: () => null,
      makeElement: () => el as unknown as HTMLAudioElement,
      makeStream: () => ({}) as MediaStream,
    });
    out.attach("s-ada", track("t1"));
    expect(el.muted).toBe(false);
    expect(el.volume).toBe(0);
    out.setGain("s-ada", 0.8);
    out.setMaster(0.5);
    expect(el.volume).toBeCloseTo(0.4);
  });
});
