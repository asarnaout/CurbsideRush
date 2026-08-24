import { describe, expect, it } from "vitest";
import { TOKYO_MAP_PACK } from "../app/game/cities/tokyo";
import { nearestPointOnPolyline } from "../app/game/geometry/roadStrips";
import { TOKYO_CHOCHIN_POSTS } from "../app/game/tokyoStreetFurniture";

const CHOCHIN_POST_RADIUS_M = 0.28;

describe("Tokyo street furniture", () => {
  it("keeps every chochin post outside every carriageway", () => {
    for (const post of TOKYO_CHOCHIN_POSTS) {
      for (const road of TOKYO_MAP_PACK.geometry.roadSurfaces ?? []) {
        const nearest = nearestPointOnPolyline(
          post.position,
          road.centerline,
        );
        const clearanceM = Math.hypot(
          post.position.x - nearest.x,
          post.position.z - nearest.z,
        );
        expect(
          clearanceM,
          `${post.id} overlaps ${road.id}`,
        ).toBeGreaterThanOrEqual(road.widthM / 2 + CHOCHIN_POST_RADIUS_M);
      }
    }
  });

  it("leaves the Niban-dori crossing in the Nakamise row open", () => {
    expect(
      TOKYO_CHOCHIN_POSTS.some(
        (post) => post.id === "jp-chochin-yokocho-5",
      ),
    ).toBe(false);
  });
});
