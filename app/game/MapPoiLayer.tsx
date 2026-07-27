"use client";

import { HudGlyph } from "./DriveHud";
import { MAP_POI_FAMILY, type MapPoi } from "./mapPoi";
import type { MinimapProjector } from "./minimap";

/**
 * The place markers, as DOM over the map canvas rather than pixels in it.
 *
 * Both maps use this, which is the point: the legend, the corner widget and the
 * whole-city view all render the *same* `HudGlyph` from the same path data, so
 * a symbol cannot mean one thing in the key and another on the map. Drawing
 * them into the canvas instead would have meant hand-rolling a spanner and a
 * shopping bag out of line segments — bespoke imperative code per family, a
 * second definition to keep in step with the legend's, and unreadable at the
 * 11 px the touch widget gives them.
 *
 * SVG also stays crisp at any device pixel ratio for free, which the corner
 * canvas does not: its backing store is CSS pixels, so a glyph rasterised into
 * it would be soft on every phone the game is played on.
 */
export function MapPoiLayer({
  pois,
  projector,
  width,
  height,
  glyphPx,
  testId = "map-poi",
}: {
  readonly pois: readonly MapPoi[];
  readonly projector: MinimapProjector;
  readonly width: number;
  readonly height: number;
  /** Glyph edge in CSS pixels; the disc behind it is sized from this. */
  readonly glyphPx: number;
  readonly testId?: string;
}) {
  const disc = Math.round(glyphPx * 1.62);
  return (
    <>
      {pois.map((poi) => {
        const at = projector.project(poi.x, poi.z);
        // Cull before rendering rather than letting `overflow: hidden` clip.
        // The widget scrolls a 500 m window over a 3 km city, so all but a
        // handful of New York's markers are off the box at any moment and
        // there is no reason to lay them out.
        if (
          at.x < -disc ||
          at.y < -disc ||
          at.x > width + disc ||
          at.y > height + disc
        ) {
          return null;
        }
        const family = MAP_POI_FAMILY[poi.kind];
        return (
          <span
            key={poi.id}
            data-testid={testId}
            data-poi-kind={poi.kind}
            title={poi.label}
            style={{
              position: "absolute",
              left: at.x,
              top: at.y,
              width: disc,
              height: disc,
              // Placed by its centre, so the marker sits *on* the thing rather
              // than hanging down and to the right of it.
              transform: "translate(-50%, -50%)",
              borderRadius: "50%",
              // Nearly opaque under the glyph: a wrench over a bright junction
              // patch is otherwise unreadable.
              background: "rgba(9,12,14,.82)",
              border: `1px solid ${family.color}`,
              display: "grid",
              placeItems: "center",
              pointerEvents: "none",
            }}
          >
            <HudGlyph path={family.icon} size={glyphPx} strokeWidth={2.3} color={family.color} />
          </span>
        );
      })}
    </>
  );
}
