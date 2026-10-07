/**
 * Office agents (SPEC §4.3 `pm/`, §10 M5, D3; #135, #271).
 *
 * - store.ts          agents, grants of shared agents, the caps admins set
 * - tokens.ts         per-agent bearer tokens (hashed; shown once)
 * - access.ts         what an agent may reach: its owner's access, or its grants
 * - conversations.ts  each person's conversation with an agent; open turns
 * - requests.ts       "ask a human" questions and their answers
 * - engines/          `OfficeAgentEngine`, the CLI session engine, the fake engine
 * - runtime.ts        start / stop / deliver on an engine; what engines report
 * - tools/            the office tools: authorisation, audit, reads and writes
 * - mcp.ts            the office MCP server at `/mcp` (streamable HTTP)
 * - tool-routes.ts    the same tools as REST
 * - service.ts        what people do with agents, with its rules
 * - routes.ts         REST for people
 * - setup.ts          boot wiring
 */
export { OFFICE_AGENT_RUNNER_USER } from "./engines/cli-session.ts";
export { FakeEngine } from "./engines/fake.ts";
export type {
  EngineAgent,
  EngineEvent,
  EngineHealth,
  EngineMessage,
  EngineOffice,
  OfficeAgentEngine,
} from "./engines/types.ts";
export { EngineRefusal } from "./engines/types.ts";
export { createOfficeAgents, type OfficeAgents, type OfficeAgentsOptions } from "./setup.ts";
