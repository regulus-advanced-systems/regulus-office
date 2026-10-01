/**
 * Migration 0017 (#186): floors still on a pre-compound template switch to
 * generated rooms (#182). The scene now draws every room with `generateRoom`,
 * so their seat rows are renamed through `LEGACY_SEAT_IDS` once, in SQL,
 * instead of resolving old ids at runtime everywhere a seat id is read
 * (server, scene, e2e). Robots keep their seats: `table-a-n1` becomes `d1s1`
 * in `desks.seat_id` and `agents.desk_seat_id` alike. Seats the generated
 * desks add (a 6-seat floor gets 2 desks, 8 seats) get their desk rows, and
 * the floor's `layout_template_id` becomes `room`.
 *
 * The SQL is generated from the map so the two can never drift;
 * `legacy-seats.test.ts` checks the committed migration against it.
 */
import {
  LEGACY_SEAT_IDS,
  legacyDeskCount,
  ROOM_LAYOUT_ID,
  roomDeskSeatIds,
} from "@regulus/floor-layout";

const q = (v: string) => `'${v.replaceAll("'", "''")}'`;
const BREAK = "--> statement-breakpoint";

function caseOf(column: string, map: Readonly<Record<string, string>>): string {
  const arms = Object.entries(map)
    .map(([from, to]) => `\tWHEN ${q(from)} THEN ${q(to)}`)
    .join("\n");
  return `CASE \`${column}\`\n${arms}\n\tELSE \`${column}\`\nEND`;
}

/** The statements of migration 0017, in order, each ending with a semicolon. */
export function legacySeatStatements(): string[] {
  const out: string[] = [];
  for (const [templateId, map] of Object.entries(LEGACY_SEAT_IDS)) {
    const floorsOn = `(SELECT \`id\` FROM \`floors\` WHERE \`layout_template_id\` = ${q(templateId)})`;
    out.push(
      `UPDATE \`desks\` SET \`seat_id\` = ${caseOf("seat_id", map)}\nWHERE \`floor_id\` IN ${floorsOn};`,
    );
    out.push(
      `UPDATE \`agents\` SET \`desk_seat_id\` = ${caseOf("desk_seat_id", map)}\nWHERE \`floor_id\` IN ${floorsOn};`,
    );
    const taken = new Set(Object.values(map));
    const extra = roomDeskSeatIds(legacyDeskCount(templateId) ?? 1).filter((id) => !taken.has(id));
    for (const seatId of extra) {
      out.push(
        "INSERT INTO `desks` (`id`, `floor_id`, `seat_id`, `created_at`, `updated_at`)\n" +
          "SELECT lower(hex(randomblob(16))), `f`.`id`, " +
          `${q(seatId)}, CAST(strftime('%s', 'now') AS INTEGER) * 1000, CAST(strftime('%s', 'now') AS INTEGER) * 1000\n` +
          `FROM \`floors\` \`f\` WHERE \`f\`.\`layout_template_id\` = ${q(templateId)}\n` +
          `AND NOT EXISTS (SELECT 1 FROM \`desks\` \`d\` WHERE \`d\`.\`floor_id\` = \`f\`.\`id\` AND \`d\`.\`seat_id\` = ${q(seatId)});`,
      );
    }
  }
  const legacy = Object.keys(LEGACY_SEAT_IDS).map(q).join(", ");
  out.push(
    `UPDATE \`floors\` SET \`layout_template_id\` = ${q(ROOM_LAYOUT_ID)} WHERE \`layout_template_id\` IN (${legacy});`,
  );
  return out;
}

/** The migration file's body (after its comment header). */
export function legacySeatMigrationSql(): string {
  return `${legacySeatStatements().join(`${BREAK}\n`)}\n`;
}
