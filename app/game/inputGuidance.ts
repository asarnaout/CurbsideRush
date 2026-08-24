/**
 * What the pause card tells a player the controls are.
 *
 * It lives out here rather than in `GameCanvas` — which renders it — because
 * the keys it describes are not all the session's any more. **M opens the city
 * map, and that key is bound in `SideSwapApp`**: copy in one ring documenting a
 * binding in another is exactly how a control list goes quietly wrong. Out here
 * both rings can read it and a node test can check it, which `GameCanvas`'s own
 * 14k lines made impractical.
 */

export type InputFamily = "keyboard" | "gamepad" | "touch";

export interface InputGuidance {
  readonly label: string;
  readonly details: string;
}

export const INPUT_GUIDANCE: Readonly<Record<InputFamily, InputGuidance>> =
  Object.freeze({
    keyboard: {
      label: "Keyboard + mouse",
      details:
        "W or ↑ drives. S or ↓ brakes, and keeps going into reverse once you have stopped. Space is the brake on its own, and A/D or ←/→ steer. Hold right mouse and drag in any direction to look around; use the wheel to zoom the chase camera. Z/X/V glance left/right/behind. Q/E signal, C changes camera, M opens the map of the whole city, H sounds the horn, and P or Escape pauses.",
    },
    gamepad: {
      // No map here on purpose: nothing on a controller opens it, and copy that
      // promises a button there would send the player hunting for one.
      label: "Controller",
      details:
        "Use the left stick to steer and the right trigger to drive. The left trigger brakes, and keeps going into reverse once you have stopped. A sounds the horn, B changes camera, X/Y signal, and Start pauses.",
    },
    touch: {
      label: "Touch",
      details:
        "Drag your left thumb anywhere on the lower-left of the screen to steer — wherever you touch down becomes centre, so there is no pad to find. Drive and Brake are on the right, and holding Brake once you have stopped reverses. The map of the whole city, camera, horn and pause are in the top-right corner. Swipe the road view to look around.",
    },
  });
