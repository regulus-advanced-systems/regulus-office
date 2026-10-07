/**
 * Henchman names (SPEC §9.3, D29; #256). Every henchman gets one at spawn and
 * keeps it for life: across resume, restart and upgrade. Names are unique
 * among the henchmen at a desk; one sent home gives its name back.
 *
 * The list is our own: plain workshop, foundry, rigging and volcano words, the
 * kind of thing a lair crew would be nicknamed after. No character names from
 * films, games or books; keep it that way when adding to it.
 */

export const HENCHMAN_NAMES: readonly string[] = [
  // Workshop
  "Rivet",
  "Gasket",
  "Flange",
  "Spanner",
  "Lugnut",
  "Shim",
  "Dowel",
  "Grout",
  "Mortar",
  "Trowel",
  "Girder",
  "Rebar",
  "Truss",
  "Gantry",
  "Hopper",
  "Sluice",
  "Baffle",
  "Damper",
  "Nozzle",
  "Spigot",
  "Bung",
  "Ferrule",
  "Cleat",
  "Shackle",
  "Lanyard",
  "Hasp",
  "Latch",
  "Hinge",
  "Burr",
  "Swarf",
  "Kerf",
  "Chamfer",
  "Knurl",
  "Mandrel",
  "Collet",
  "Gimbal",
  "Winch",
  "Pulley",
  "Hawser",
  "Bilge",
  "Ballast",
  "Bodkin",
  "Tallow",
  "Solder",
  "Bellows",
  "Tongs",
  "Crowbar",
  "Mallet",
  // Foundry and volcano
  "Ingot",
  "Billet",
  "Dross",
  "Slag",
  "Clinker",
  "Crucible",
  "Cinder",
  "Soot",
  "Pumice",
  "Basalt",
  "Scoria",
  "Tephra",
  "Caldera",
  "Lahar",
  "Fumarole",
  "Sulphur",
  "Brimstone",
  "Smelt",
  "Quench",
  "Anneal",
  "Kiln",
  "Bloom",
  "Flux",
  "Tuyere",
  // Control room
  "Klaxon",
  "Rheostat",
  "Busbar",
  "Stator",
  "Varistor",
  "Diode",
  "Ampere",
  "Ohm",
  "Toggle",
  "Dial",
  "Fuse",
  "Relay",
  "Ratio",
  "Vernier",
  "Plumb",
  "Datum",
  "Sonar",
  "Ping",
  "Bleep",
  "Static",
  "Squelch",
  "Dimmer",
  "Breaker",
  "Trip",
  // Schemes
  "Ruse",
  "Ploy",
  "Feint",
  "Decoy",
  "Alibi",
  "Caper",
  "Hunch",
  "Fib",
] as const;

/** Lower-case key: names differ in more than their case. */
const key = (name: string) => name.trim().toLowerCase();

/**
 * A name nobody in `taken` holds: a free one from the list at random, or, with
 * the whole list in use, a list name with the lowest free number ("Rivet 2").
 */
export function pickHenchmanName(
  taken: Iterable<string>,
  random: () => number = Math.random,
  names: readonly string[] = HENCHMAN_NAMES,
): string {
  const used = new Set([...taken].map(key));
  const free = names.filter((n) => !used.has(key(n)));
  if (free.length > 0) return free[Math.floor(random() * free.length) % free.length] as string;
  const base = names[Math.floor(random() * names.length) % names.length] ?? "Henchman";
  for (let n = 2; ; n++) {
    const candidate = `${base} ${n}`;
    if (!used.has(key(candidate))) return candidate;
  }
}
