/** Cream viewport with a radial vignette to darker tan at the corners (SPEC §12). */
export const CREAM = "#FFF6D9";
export const VIGNETTE_EDGE = "#E6D3A9";

export function vignetteBackground(cream = CREAM, edge = VIGNETTE_EDGE): string {
  return `radial-gradient(ellipse 80% 75% at 50% 45%, ${cream} 0%, ${cream} 45%, ${edge} 100%)`;
}
