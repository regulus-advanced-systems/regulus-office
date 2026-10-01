/**
 * `bun test` preload (bunfig.toml). Loads three.js as ES modules before any
 * test file runs. @react-three/fiber resolves to its CommonJS build under
 * bun test and `require`s three; when that require is the first load of
 * three, Bun refuses it ("require() async module ... is unsupported"), so
 * whether a scene test passed depended on which file happened to run first.
 */
import "three";
