import { $numFields, type Metadata, type Schema } from "@colyseus/schema";

/**
 * Any class produced by `schema()` or by extending `Schema`. `schema()`'s
 * return type is not assignable to `typeof Schema`, so introspection accepts
 * the structural shape it actually needs: a zero-arg constructor. The
 * Colyseus field metadata lives on the standard `Symbol.metadata` slot.
 */
export type SchemaClass = new () => Schema;

/** Colyseus field metadata of a schema class, or `undefined` for a plain class. */
export function schemaMetadata(klass: SchemaClass): Metadata | undefined {
  const metadata = (klass as { [Symbol.metadata]?: DecoratorMetadataObject | null })[
    Symbol.metadata
  ];
  return metadata && $numFields in metadata ? (metadata as Metadata) : undefined;
}

/** Ordered field names registered on a Colyseus schema class (from `Symbol.metadata`). */
export function schemaFieldNames(klass: SchemaClass): string[] {
  const metadata = schemaMetadata(klass);
  if (!metadata) return [];
  const names: string[] = [];
  const last = metadata[$numFields];
  for (let i = 0; i <= last; i++) {
    const field = metadata[i];
    if (field) names.push(field.name);
  }
  return names;
}
