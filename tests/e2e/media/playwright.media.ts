/**
 * Playwright config for the by-hand voice and lounge TV check (#48; media.verify.ts):
 * two Chromiums with fake microphone and screen capture against an office that has
 * LiveKit configured (MEDIA_BASE_URL). Not run by `bun run e2e`.
 */
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "media.verify.ts",
  workers: 1,
  retries: 0,
  timeout: 300_000,
  expect: { timeout: 60_000 },
  reporter: [["list"]],
  use: {
    baseURL: process.env.MEDIA_BASE_URL ?? "http://127.0.0.1:4620",
    viewport: { width: 1280, height: 800 },
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1280, height: 800 },
        launchOptions: {
          args: [
            "--use-angle=swiftshader",
            "--enable-unsafe-swiftshader",
            // A beeping fake microphone, and the screen picker answered with a fake screen.
            "--use-fake-device-for-media-stream",
            "--use-fake-ui-for-media-stream",
            "--auto-select-desktop-capture-source=Entire screen",
            "--autoplay-policy=no-user-gesture-required",
            // Chrome's fake microphone is a steady beep, which noise suppression soon
            // treats as noise; a WAV of speech-like syllables keeps LiveKit's speaker
            // detection busy.
            ...(process.env.MEDIA_FAKE_AUDIO
              ? [`--use-file-for-fake-audio-capture=${process.env.MEDIA_FAKE_AUDIO}`]
              : []),
          ],
        },
      },
    },
  ],
});
