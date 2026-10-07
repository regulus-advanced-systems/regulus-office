/**
 * The lair style picker (#282): one radio card per decor style, with a small
 * cutaway preview drawn in the style's own colours, its name and what it
 * furnishes the room with. The list and the names are `DECOR_STYLES` and
 * `DECOR_STYLE_SPECS`, the same ones room settings shows, so a style reads
 * the same when the operation is added and when it is changed later.
 *
 * Plain radios named `name`: an uncontrolled form reads the picked style
 * from its FormData.
 */
import { DECOR_STYLES, DEFAULT_DECOR_STYLE, type DecorStyle } from "@regulus/protocol";
import { DECOR_STYLE_SPECS, type DecorStyleSpec } from "@regulus/room-layout";
import "./decorStyle.css";

/** A tiny cutaway of a room in the style's floor, walls, light and accent. */
export function DecorStylePreview({ spec }: { spec: DecorStyleSpec }) {
  const { palette: p, lighting } = spec;
  return (
    <svg
      className="rg-decor-style__preview"
      viewBox="0 0 64 44"
      aria-hidden="true"
      data-style={spec.id}
    >
      <rect width="64" height="44" fill={p.exterior} />
      {/* Back wall, side wall, floor. */}
      <polygon points="14,6 60,6 60,22 14,22" fill={p.wall} />
      <polygon points="4,14 14,6 14,22 4,34" fill={p.wallAlt} />
      <polygon points="14,22 60,22 52,40 4,34" fill={p.floor} />
      <polygon points="30,22 46,22 40,38 22,36" fill={p.floorAlt} />
      <polygon points="14,6 60,6 60,8 14,8" fill={p.cap} />
      {/* The board wall's accent light, a desk under its pendant, a prop in the corner. */}
      <rect x="20" y="11" width="12" height="7" fill={p.cap} />
      <rect x="21" y="12" width="10" height="5" fill={lighting.accent} />
      <ellipse cx="36" cy="31" rx="11" ry="4" fill={lighting.pendant} opacity="0.28" />
      <polygon points="28,27 44,27 42,33 26,33" fill={p.cap} />
      <rect x="28" y="26" width="16" height="2" fill={p.accent} />
      <rect x="50" y="15" width="6" height="10" fill={p.accent} opacity="0.85" />
    </svg>
  );
}

export function DecorStylePicker({
  name,
  defaultValue = DEFAULT_DECOR_STYLE,
  legend = "Room style",
}: {
  name: string;
  defaultValue?: DecorStyle;
  legend?: string;
}) {
  return (
    <fieldset className="rg-field rg-decor-style">
      <legend className="rg-field__label">{legend}</legend>
      <div className="rg-decor-style__list">
        {DECOR_STYLES.map((id) => {
          const spec = DECOR_STYLE_SPECS[id];
          return (
            <label key={id} className="rg-decor-style__card">
              <input type="radio" name={name} value={id} defaultChecked={id === defaultValue} />
              <DecorStylePreview spec={spec} />
              <span className="rg-decor-style__name">{spec.name}</span>
              <span className="rg-decor-style__blurb">{spec.blurb}</span>
            </label>
          );
        })}
      </div>
      <div className="rg-field__hint">Room settings can change the style later.</div>
    </fieldset>
  );
}
