// Smoke test for docker-proxy (deploy/docker-compose.yml): run it inside the office container,
// where DOCKER_HOST points at the proxy and there is no Docker socket.
//
//   docker compose exec -T -e CHECK_IMAGE=<image> office bun run - < docker-proxy-check.ts
//
// It walks the docker runner backend's lifecycle (SPEC §8) through the proxy: list, pull or
// inspect the image, create a credential volume and a runner container, start it, run a tmux
// session and an interactive exec over the hijacked attach stream, resize it, then remove
// everything. It also asserts that endpoints outside the allowlist, and bind mounts of the
// Docker socket or the host root, are refused with 403. No dependencies beyond Bun.

const image =
  process.env.CHECK_IMAGE ?? "ghcr.io/regulus-advanced-systems/regulus-office-runner:latest";
const dockerHost = process.env.DOCKER_HOST ?? "";
const hostMatch = /^tcp:\/\/([^:/]+):(\d+)$/.exec(dockerHost);
if (!hostMatch) throw new Error(`DOCKER_HOST must be tcp://host:port, got "${dockerHost}"`);
const [, host, portText] = hostMatch as unknown as [string, string, string];
const port = Number(portText);
const base = `http://${host}:${port}`;
const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const failures: string[] = [];

function check(ok: boolean, label: string): void {
  console.log(`${ok ? "ok  " : "FAIL"} ${label}`);
  if (!ok) failures.push(label);
}

async function api(method: string, path: string, body?: unknown): Promise<Response> {
  return fetch(`${base}${path}`, {
    method,
    headers: body === undefined ? {} : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function expectStatus(method: string, path: string, want: number[], body?: unknown) {
  const res = await api(method, path, body);
  const text = await res.text();
  check(want.includes(res.status), `${method} ${path} -> ${res.status} (want ${want.join("|")})`);
  const json = res.headers.get("content-type")?.includes("json") && text.length > 0;
  return json ? (JSON.parse(text) as never) : null;
}

// Hijacked exec start, as a docker client does for an interactive tmux attach: HTTP upgrade to a
// raw TCP stream, write to stdin, read the echoed output.
async function hijackedExec(v: string, execId: string): Promise<string> {
  let output = "";
  let upgraded = false;
  const { promise: done, resolve } = Promise.withResolvers<void>();
  const socket = await Bun.connect({
    hostname: host,
    port,
    socket: {
      data(_s, chunk) {
        output += chunk.toString();
        if (!upgraded && output.includes("\r\n\r\n")) upgraded = true;
        if (output.includes("got:ping")) resolve();
      },
      close() {
        resolve();
      },
      error() {
        resolve();
      },
    },
  });
  const payload = JSON.stringify({ Detach: false, Tty: true });
  socket.write(
    `POST ${v}/exec/${execId}/start HTTP/1.1\r\nHost: docker\r\nConnection: Upgrade\r\n` +
      `Upgrade: tcp\r\nContent-Type: application/json\r\nContent-Length: ${payload.length}\r\n\r\n${payload}`,
  );
  for (let i = 0; i < 50 && !upgraded; i++) await Bun.sleep(100);
  check(/^HTTP\/1\.1 101/.test(output), "exec start upgrades to a hijacked stream (101)");
  await expectStatus("POST", `${v}/exec/${execId}/resize?h=40&w=120`, [200, 201]);
  socket.write("ping\n");
  await Promise.race([done, Bun.sleep(10_000)]);
  socket.end();
  return output;
}

const version = (await (await api("GET", "/version")).json()) as { ApiVersion: string };
const v = `/v${version.ApiVersion}`;
console.log(`docker-proxy at ${base}, Engine API ${version.ApiVersion}, image ${image}`);

// Allowed: the runner backend's calls.
await expectStatus("HEAD", "/_ping", [200]);
await expectStatus("GET", `${v}/containers/json?all=1`, [200]);
await expectStatus("GET", `${v}/networks`, [200]);
if ((await api("GET", `${v}/images/${image}/json`)).status === 404) {
  const [name, tag] = image.includes(":") ? image.split(/:(?=[^:/]+$)/) : [image, "latest"];
  const pull = await api(
    "POST",
    `${v}/images/create?fromImage=${encodeURIComponent(name ?? image)}&tag=${tag}`,
  );
  await pull.text();
  check(pull.status === 200, `pull ${image} -> ${pull.status}`);
}
await expectStatus("GET", `${v}/images/${image}/json`, [200]);

const volume = `rg-proxy-check-${suffix}`;
const container = `rg-proxy-check-${suffix}`;
await expectStatus("POST", `${v}/volumes/create`, [201], { Name: volume });
await expectStatus("GET", `${v}/volumes/${volume}`, [200]);
await expectStatus("POST", `${v}/containers/create?name=${container}`, [201], {
  Image: image,
  Cmd: ["sleep", "300"],
  Env: ["IS_SANDBOX=1"],
  HostConfig: { Mounts: [{ Type: "volume", Source: volume, Target: "/home/check" }] },
});
try {
  await expectStatus("POST", `${v}/containers/${container}/start`, [204]);
  const info = (await expectStatus("GET", `${v}/containers/${container}/json`, [200])) as {
    State?: { Running?: boolean };
  } | null;
  check(info?.State?.Running === true, "runner container is running");
  await expectStatus("GET", `${v}/containers/${container}/top`, [200]);

  // tmux session via a detached exec (skipped when the image has no tmux, e.g. busybox in CI).
  const tmux = (await expectStatus("POST", `${v}/containers/${container}/exec`, [201], {
    Cmd: [
      "sh",
      "-c",
      "command -v tmux >/dev/null || exit 42; tmux new-session -d -s probe 'sleep 30' && tmux has-session -t probe",
    ],
  })) as { Id: string };
  await expectStatus("POST", `${v}/exec/${tmux.Id}/start`, [200], { Detach: false, Tty: false });
  let tmuxInfo = { Running: true, ExitCode: -1 };
  for (let i = 0; i < 50 && tmuxInfo.Running; i++) {
    const res = await api("GET", `${v}/exec/${tmux.Id}/json`);
    tmuxInfo = (await res.json()) as typeof tmuxInfo;
    if (tmuxInfo.Running) await Bun.sleep(200);
  }
  if (tmuxInfo.ExitCode === 42) console.log("skip tmux session (no tmux in this image)");
  else check(tmuxInfo.ExitCode === 0, `tmux session in the runner (exit ${tmuxInfo.ExitCode})`);

  const interactive = (await expectStatus("POST", `${v}/containers/${container}/exec`, [201], {
    AttachStdin: true,
    AttachStdout: true,
    AttachStderr: true,
    Tty: true,
    Cmd: ["sh", "-c", "read line; echo got:$line"],
  })) as { Id: string };
  const out = await hijackedExec(v, interactive.Id);
  check(out.includes("got:ping"), "stdin/stdout round trip over the hijacked exec stream");

  // Denied: everything outside the allowlist, and bind mounts that would hand a runner the host.
  await expectStatus("POST", `${v}/build`, [403]);
  await expectStatus("GET", `${v}/swarm`, [403]);
  await expectStatus("GET", `${v}/info`, [403]);
  await expectStatus("GET", `${v}/secrets`, [403]);
  await expectStatus("POST", `${v}/networks/create`, [403], { Name: `rg-denied-${suffix}` });
  await expectStatus("POST", `${v}/containers/${container}/archive`, [403]);
  // No PUT rule at all, so the proxy answers 405 Method Not Allowed.
  await expectStatus("PUT", `${v}/containers/${container}/archive?path=/`, [403, 405]);
  await expectStatus("POST", `${v}/containers/prune`, [403]);
  for (const bind of ["/var/run/docker.sock:/var/run/docker.sock", "/:/host"]) {
    await expectStatus("POST", `${v}/containers/create?name=rg-denied-${suffix}`, [403], {
      Image: image,
      HostConfig: { Binds: [bind] },
    });
  }
} finally {
  await expectStatus("POST", `${v}/containers/${container}/stop?t=1`, [204, 304]);
  await expectStatus("DELETE", `${v}/containers/${container}?force=1`, [204]);
  await expectStatus("DELETE", `${v}/volumes/${volume}`, [204]);
}

if (failures.length > 0) {
  console.error(`${failures.length} check(s) failed`);
  process.exit(1);
}
console.log("docker-proxy: all checks passed");
