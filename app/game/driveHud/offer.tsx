/**
 * The gig offer: `HudOffer`, the desktop card (`DriveOfferCard`), the
 * peripheral edge glow (`DriveOfferGlow`), and the shared panel
 * (`DriveOfferPanel`) with its two placements — floating over the minimap on
 * a phone (`DriveOfferBar`) and docked into `ExpandedMap`'s legend column
 * when the whole-city map is open (#241). Split out of `DriveHud.tsx` (#290);
 * the whole cluster is self-contained apart from the shared tokens, which is
 * why it moved as one file rather than several.
 */

import { DRIVE_LAYER } from "../driveLayers";
import { cluster, HudGlyph, HUD_INK, HUD_SANS, HUD_SERIF } from "./tokens";
import { FOOD_ICON, RIDER_ICON } from "../hudIcons";

// ---------------------------------------------------------------------------
// The offer
// ---------------------------------------------------------------------------

export interface HudOffer {
  readonly kind: "delivery" | "passenger";
  readonly pay: string;
  /** The tip a food customer already named, or the surge on a fare. */
  readonly bonus: string | null;
  readonly title: string;
  readonly sub: string;
  readonly chips: readonly string[];
  /**
   * How far off-route the pickup is, e.g. "0.4 mi" — or null when there is no
   * route to leave. The phone comp draws this as a rail rather than listing it,
   * and the desktop card carries the same figure in its first chip.
   *
   * Named rather than read out of `chips` because that array is positional and
   * its first entry is only the detour *when there is one*; the rail was
   * labelling a run distance as a detour on every offer taken while idle.
   */
  readonly detour: string | null;
  /** The load — "3 items", "2 riders". What the phone hangs off the dropoff. */
  readonly meta: string;
  readonly footnote: string;
  readonly secondsLeft: number;
  /** 0→1 of the window burnt; drives the fuse and its colour. */
  readonly elapsed: number;
  readonly surged: boolean;
}

/**
 * The card's frame, straight off `Curbside Driving HUD Desktop`. Every figure in
 * `DriveOfferCard` below is that comp's, unscaled: the comp is drawn on the same
 * 1920-wide frame `HUD_DESIGN_WIDTH` names, so a number here can be read off the
 * comp without arithmetic.
 *
 * It used to be 430x384 — a third more area — which on a laptop floored at
 * `HUD_MIN_SCALE` covered a quarter of the windscreen and left the minimap
 * roughly six pixels of clearance beneath it. The card is a thing you glance at
 * while driving; it does not need to be the biggest object on screen.
 */
const OFFER_W = 344;
const OFFER_H = 274;

/**
 * How far below the HUD's top inset the card hangs, in comp pixels.
 *
 * The comp puts its top edge at 282 on a frame inset 38, so 244 is the gap it
 * actually draws under the wallet cluster. Scaled rather than fixed because the
 * cluster above it scales too — pinning it would close that gap on a small
 * window and open it on a large one, and the minimap is directly below.
 */
export const OFFER_TOP_OFFSET_PX = 244;

/**
 * How long the fuse takes to reach a new position.
 *
 * `elapsed` arrives on the HUD snapshot, which publishes about ten times a
 * second — so the raw value steps in jumps of roughly a fifteenth of the
 * border, which reads as a stutter crawling round the card. Handing the browser
 * a transition longer than the gap between samples lets it interpolate: each
 * new target arrives partway through the last move, so the stroke never stops.
 *
 * Long enough to ride out a dropped sample (the publish interval is floored at
 * 100ms but lands on a frame boundary, so it stretches under load), short
 * enough that the constant lag it introduces — well under a percent of the
 * offer window — is invisible. The same trick the fuel gauge uses for the pump.
 */
export const FUSE_SMOOTHING_MS = 200;

/**
 * The offer card. Interactive, so it takes `DRIVE_LAYER.offer` rather than the
 * read-only HUD layer — the nav card is `pointerEvents: "none"` and an accept
 * button could never have lived inside it.
 *
 * The border is a fuse: one SVG stroke with `pathLength` normalised to 1000, so
 * the dash offset *is* the fraction burnt regardless of the card's real
 * perimeter. It reads at a glance from the corner of the eye, which a numeral
 * counting down does not.
 */
export function DriveOfferCard({
  scale,
  inset,
  offer,
  acceptKey,
  passKey,
  onAccept,
  onPass,
}: {
  scale: number;
  inset: { readonly top: string; readonly right: string };
  offer: HudOffer;
  acceptKey: string;
  passKey: string;
  onAccept: () => void;
  onPass: () => void;
}) {
  const food = offer.kind === "delivery";
  const fuseHot = offer.elapsed > 0.72;
  return (
    <div
      data-testid="gig-offer"
      style={cluster(scale, "top right", {
        top: inset.top,
        right: inset.right,
        zIndex: DRIVE_LAYER.offer,
      })}
    >
      <div
        style={{
          position: "relative",
          width: OFFER_W,
          height: OFFER_H,
          borderRadius: 24,
          background: "linear-gradient(168deg,#faf4e6,#efe1c8)",
          padding: "15px 17px 14px",
          display: "flex",
          flexDirection: "column",
          boxShadow:
            "0 28px 62px -24px rgba(0,0,0,.86), 0 0 0 1px rgba(255,255,255,.35) inset, 0 0 38px -8px rgba(250,243,228,.22)",
        }}
      >
        <svg
          viewBox={`0 0 ${OFFER_W} ${OFFER_H}`}
          aria-hidden="true"
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            pointerEvents: "none",
            overflow: "visible",
          }}
        >
          <rect
            x="1.75"
            y="1.75"
            width={OFFER_W - 3.5}
            height={OFFER_H - 3.5}
            rx="22.5"
            fill="none"
            stroke="rgba(32,30,29,.1)"
            strokeWidth="3.5"
          />
          <rect
            x="1.75"
            y="1.75"
            width={OFFER_W - 3.5}
            height={OFFER_H - 3.5}
            rx="22.5"
            fill="none"
            stroke={fuseHot ? "#d9614c" : HUD_INK}
            strokeWidth="3.5"
            strokeLinecap="round"
            pathLength={1000}
            strokeDasharray={1000}
            style={{
              strokeDashoffset: Math.min(1, Math.max(0, offer.elapsed)) * 1000,
              transition: `stroke-dashoffset ${FUSE_SMOOTHING_MS}ms linear, stroke .25s ease`,
            }}
          />
        </svg>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 10,
            marginBottom: 9,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              background: food ? "rgba(198,113,57,.15)" : "rgba(90,110,68,.16)",
              borderRadius: 999,
              padding: "4px 11px 4px 9px",
            }}
          >
            <HudGlyph
              path={food ? FOOD_ICON : RIDER_ICON}
              size={14}
              strokeWidth={2.75}
              color={food ? "#a8541f" : "#4e6236"}
            />
            <span
              style={{
                font: `800 11px ${HUD_SANS}`,
                letterSpacing: "1.7px",
                color: food ? "#a8541f" : "#4e6236",
                whiteSpace: "nowrap",
              }}
            >
              {food ? "FOOD DELIVERY" : "RIDESHARE"}
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <span
              data-testid="offer-countdown"
              style={{
                font: `900 17px ${HUD_SANS}`,
                color: "rgba(32,30,29,.45)",
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {offer.secondsLeft}
            </span>
            <span
              style={{
                font: `800 10px ${HUD_SANS}`,
                letterSpacing: "1.4px",
                color: "rgba(32,30,29,.35)",
              }}
            >
              S
            </span>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "baseline", gap: 9, marginBottom: 4 }}>
          <span
            data-testid="offer-pay"
            style={{
              font: `900 40px/.9 ${HUD_SANS}`,
              color: HUD_INK,
              letterSpacing: "-1.6px",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {offer.pay}
          </span>
          {offer.bonus && (
            <span
              data-testid="offer-bonus"
              style={{
                background: offer.surged ? "rgba(168,84,31,.14)" : "rgba(32,30,29,.08)",
                borderRadius: 999,
                padding: "3px 10px",
                font: `800 12.5px ${HUD_SANS}`,
                color: offer.surged ? "#a8541f" : "rgba(32,30,29,.6)",
                whiteSpace: "nowrap",
              }}
            >
              {offer.bonus}
            </span>
          )}
        </div>

        <div
          style={{
            font: `700 24px/1.05 ${HUD_SERIF}`,
            color: HUD_INK,
            marginBottom: 2,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {offer.title}
        </div>
        <div
          style={{
            font: `600 13px ${HUD_SANS}`,
            color: "rgba(32,30,29,.55)",
            marginBottom: 11,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {offer.sub}
        </div>

        <div style={{ display: "flex", gap: 6, marginBottom: "auto", flexWrap: "wrap" }}>
          {offer.chips.map((chip) => (
            <span
              key={chip}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 5,
                border: "1.5px solid rgba(32,30,29,.16)",
                borderRadius: 999,
                padding: "4px 10px",
                font: `700 11.5px ${HUD_SANS}`,
                color: "rgba(32,30,29,.7)",
                whiteSpace: "nowrap",
              }}
            >
              {chip}
            </span>
          ))}
        </div>

        <div style={{ display: "flex", gap: 8, marginBottom: 7 }}>
          <button
            type="button"
            data-testid="offer-pass"
            onClick={onPass}
            aria-label={`Pass on this job (${passKey})`}
            style={{
              width: 100,
              height: 50,
              borderRadius: 15,
              background: "rgba(32,30,29,.06)",
              border: "1.5px solid rgba(217,97,76,.35)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 7,
              cursor: "pointer",
            }}
          >
            <span style={{ font: `900 14px ${HUD_SANS}`, letterSpacing: "1px", color: "#b04a34" }}>
              PASS
            </span>
            <span
              style={{
                display: "grid",
                placeItems: "center",
                minWidth: 19,
                height: 19,
                borderRadius: 5,
                background: "rgba(32,30,29,.12)",
                font: `900 11px ${HUD_SANS}`,
                color: "rgba(32,30,29,.6)",
              }}
            >
              {passKey}
            </span>
          </button>
          <button
            type="button"
            data-testid="offer-accept"
            onClick={onAccept}
            aria-label={`Accept this job (${acceptKey})`}
            style={{
              flex: 1,
              height: 50,
              borderRadius: 15,
              background: "linear-gradient(180deg,#9dbb7f,#7d9e63)",
              border: "none",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 10,
              cursor: "pointer",
              boxShadow:
                "0 10px 22px -12px rgba(125,158,99,.9), inset 0 2px 0 rgba(255,255,255,.34)",
            }}
          >
            <span style={{ font: `900 19px ${HUD_SANS}`, letterSpacing: "1px", color: "#16210f" }}>
              ACCEPT
            </span>
            <span
              style={{
                display: "grid",
                placeItems: "center",
                minWidth: 23,
                height: 23,
                borderRadius: 6,
                background: "rgba(22,33,15,.22)",
                font: `900 13px ${HUD_SANS}`,
                color: "#16210f",
              }}
            >
              {acceptKey}
            </span>
          </button>
        </div>
        <div
          style={{
            textAlign: "center",
            font: `600 11px ${HUD_SANS}`,
            color: "rgba(32,30,29,.42)",
          }}
        >
          {offer.footnote}
        </div>
      </div>
    </div>
  );
}

/**
 * The wash down the right edge while an offer is live. Peripheral rather than
 * legible: it says *something is waiting* to a driver whose eyes are on the
 * road, which the card alone cannot.
 */
export function DriveOfferGlow() {
  return (
    <div
      aria-hidden="true"
      style={{
        position: "absolute",
        top: 0,
        right: 0,
        bottom: 0,
        width: 420,
        pointerEvents: "none",
        zIndex: DRIVE_LAYER.scrim,
        animation: "hudEdgeGlow 1.5s ease-in-out infinite",
        background:
          "linear-gradient(270deg,rgba(250,243,228,.20),rgba(250,243,228,0) 78%)",
      }}
    />
  );
}

/**
 * The offer on a phone, from `Curbside Driving HUD Mobile`.
 *
 * It lives in the minimap's slot and the map fades out beneath it — the comp's
 * own answer to a card this size on a screen this small, and a better one than
 * shrinking it: while you are deciding, the decision is the only thing that
 * matters.
 *
 * The detour is drawn rather than listed. A rail from YOU to BACK ON ROUTE with
 * the pickup pinned partway along says "this is a small dogleg" or "this is
 * miles out of your way" at a glance, which a figure in a chip does not.
 *
 * **`slotHeight` is the hard constraint, not the comp.** The comp is drawn on
 * an 800px frame — 400 CSS pixels — but the shortest landscape phone the rail
 * budget admits is 320, and Safari showing its toolbars leaves ~343. Below
 * `RAIL_MIN_SLOT_PX` the rail is dropped rather than letting the card grow down
 * into the pedals; the distance it carried is on the sub-line either way.
 *
 * **The width is not the comp's either — it is the pedal row's.** The comp
 * draws the card exactly as wide as BRAKE+DRIVE beneath it, which is the whole
 * reason the two read as one column; so `DriveOfferBar` takes a width from
 * whoever knows the pedals (`TOUCH_PEDAL_ROW_PX`) rather than carrying a copy
 * of the comp's 212 that would drift the moment a pedal is resized.
 */
export const MOBILE_OFFER_H = 153;
/** Under this the card cannot hold its own content, whatever the slot says. */
export const MOBILE_OFFER_MIN_H = 120;
/**
 * The dense card's height — the comp with everything the map already tells you
 * taken out. See `dense` on `DriveOfferPanel`.
 *
 * 116 against the comp's 153: 17.5 of padding, the header over 4, the 21 px
 * pay, a 9 px meta line and the 31 px buttons — the pickup name, the dropoff
 * and the whole detour rail gone. The slack is what `marginBottom: "auto"`
 * spends holding the buttons on the floor.
 */
export const MOBILE_OFFER_DENSE_H = 116;
/**
 * Card height under which the detour rail is dropped to keep the card clear.
 *
 * The comp's stack with the rail in it adds up to ~139 — padding 17.5, header
 * 17, pay 20, pickup 14, sub 9, rail 30, buttons 31 — so 140 is the point below
 * which the rail is what has to give rather than the type. It has to stay under
 * `MOBILE_OFFER_H` or the rail the comp draws would never render at all.
 */
export const RAIL_MIN_SLOT_PX = 140;
/**
 * Below this width PASS gives up pixels so ACCEPT can still spell its word.
 * Out on the road the card is the pedal row (180), which keeps the comp's PASS;
 * docked in the map's legend column on a small landscape phone it is ~173, and
 * that is what this catches.
 */
const NARROW_OFFER_PX = 176;

/** Clamps a slot — a phone's rail budget, or the map's column — to the comp. */
export function resolveOfferPanelHeight(slotPx: number) {
  return Math.min(MOBILE_OFFER_H, Math.max(MOBILE_OFFER_MIN_H, slotPx));
}

export function DriveOfferBar({
  inset,
  offer,
  width,
  slotHeight,
  onAccept,
  onPass,
}: {
  inset: { readonly top: string; readonly right: string };
  offer: HudOffer;
  /** The pedal row below it, so the two share both edges — see the note above. */
  width: number;
  /** Height between the button rail and the pedals — see the note above. */
  slotHeight: number;
  onAccept: () => void;
  onPass: () => void;
}) {
  return (
    <div
      data-testid="gig-offer"
      style={{
        position: "absolute",
        top: inset.top,
        right: inset.right,
        zIndex: DRIVE_LAYER.offer,
      }}
    >
      <DriveOfferPanel
        offer={offer}
        width={width}
        height={resolveOfferPanelHeight(slotHeight)}
        onAccept={onAccept}
        onPass={onPass}
      />
    </div>
  );
}

/**
 * The card itself, with no opinion about where on the screen it sits.
 *
 * Split out because it has two homes: floating in the minimap's slot while
 * driving (`DriveOfferBar`), and docked into `ExpandedMap`'s legend column
 * whenever the map is open (#241) — where a card floating over a centred panel
 * read as two windows colliding, and how much it clipped the legend depended on
 * the city's aspect ratio. `width` and `height` come from whichever slot it
 * landed in; everything between them is fluid.
 *
 * **`dense` is not a small version of the card, it is a shorter one.** The type
 * sizes do not move — the pay is still the hero — but the pickup's name, the
 * dropoff and the detour rail come out, because docked on a phone the card is
 * standing on a map that is *already* drawing the dashed line to that pickup.
 * Nothing is lost there that is not on screen a few centimetres to the left,
 * and the alternative was a card that shrank its own text into itself.
 */
export function DriveOfferPanel({
  offer,
  width,
  height,
  dense = false,
  onAccept,
  onPass,
  testId,
}: {
  offer: HudOffer;
  width: number;
  height: number;
  /** Drop what the map beside it already says — see the note above. */
  dense?: boolean;
  onAccept: () => void;
  onPass: () => void;
  /** Set by whichever placement is the one on screen — never both at once. */
  testId?: string;
}) {
  const food = offer.kind === "delivery";
  const showRail = !dense && offer.detour !== null && height >= RAIL_MIN_SLOT_PX;
  const fuseHot = offer.elapsed > 0.72;
  const passPx = width < NARROW_OFFER_PX ? 48 : 57;
  return (
    <div
      data-testid={testId}
      style={{
        position: "relative",
        width,
        height,
        borderRadius: 13.5,
        background: "linear-gradient(168deg,#faf4e6,#efe1c8)",
        padding: "9px 10.5px 8.5px",
        display: "flex",
        flexDirection: "column",
        boxShadow:
          "0 14px 31px -12px rgba(0,0,0,.86), 0 0 0 1px rgba(255,255,255,.35) inset, 0 0 19px -4px rgba(250,243,228,.22)",
      }}
    >
      <svg
        viewBox={`0 0 ${width} ${height}`}
        aria-hidden="true"
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          pointerEvents: "none",
          overflow: "visible",
        }}
      >
        <rect
          x="1"
          y="1"
          width={width - 2}
          height={height - 2}
          rx="12.5"
          fill="none"
          stroke="rgba(32,30,29,.1)"
          strokeWidth="2"
        />
        <rect
          x="1"
          y="1"
          width={width - 2}
          height={height - 2}
          rx="12.5"
          fill="none"
          stroke={fuseHot ? "#d9614c" : HUD_INK}
          strokeWidth="2"
          strokeLinecap="round"
          pathLength={1000}
          strokeDasharray={1000}
          style={{
            strokeDashoffset: Math.min(1, Math.max(0, offer.elapsed)) * 1000,
            transition: `stroke-dashoffset ${FUSE_SMOOTHING_MS}ms linear, stroke .25s ease`,
          }}
        />
      </svg>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 5,
          marginBottom: 4.5,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 3.5,
            background: food ? "rgba(198,113,57,.15)" : "rgba(90,110,68,.16)",
            borderRadius: 999,
            padding: "2.5px 6px 2.5px 5px",
          }}
        >
          <HudGlyph
            path={food ? FOOD_ICON : RIDER_ICON}
            size={7.5}
            strokeWidth={2.75}
            color={food ? "#a8541f" : "#4e6236"}
          />
          <span
            style={{
              font: `800 6px ${HUD_SANS}`,
              letterSpacing: "0.9px",
              color: food ? "#a8541f" : "#4e6236",
              whiteSpace: "nowrap",
            }}
          >
            {food ? "FOOD DELIVERY" : "RIDESHARE"}
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 2.5 }}>
          <span
            data-testid="offer-countdown"
            style={{
              font: `900 9.5px ${HUD_SANS}`,
              color: "rgba(32,30,29,.45)",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {offer.secondsLeft}
          </span>
          <span
            style={{
              font: `800 5.5px ${HUD_SANS}`,
              letterSpacing: "0.7px",
              color: "rgba(32,30,29,.35)",
            }}
          >
            S
          </span>
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "baseline", gap: 5 }}>
        <span
          data-testid="offer-pay"
          style={{
            font: `900 21px/.9 ${HUD_SANS}`,
            color: HUD_INK,
            letterSpacing: "-0.85px",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {offer.pay}
        </span>
        {/*
          Dense moves this to the meta line. The comp's chip does not fit beside
          the pay in the map's narrowest column: it has nothing to give and
          simply hangs off the right edge.
        */}
        {offer.bonus && !dense && (
          <span
            data-testid="offer-bonus"
            style={{
              background: offer.surged ? "rgba(168,84,31,.14)" : "rgba(32,30,29,.08)",
              borderRadius: 999,
              padding: "2px 5.5px",
              font: `800 6.5px ${HUD_SANS}`,
              color: offer.surged ? "#a8541f" : "rgba(32,30,29,.6)",
              whiteSpace: "nowrap",
            }}
          >
            {offer.bonus}
          </span>
        )}
      </div>

      {dense && (
        <div
          data-testid="offer-meta"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 4,
            marginTop: 3,
            marginBottom: "auto",
            font: `800 9px ${HUD_SANS}`,
            color: "#a8541f",
            overflow: "hidden",
            whiteSpace: "nowrap",
          }}
        >
          <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
            {offer.detour ?? offer.meta}
          </span>
          {offer.bonus && (
            <>
              <span
                aria-hidden="true"
                style={{
                  width: 2,
                  height: 2,
                  borderRadius: "50%",
                  background: "rgba(32,30,29,.25)",
                  flex: "none",
                }}
              />
              <span
                data-testid="offer-bonus"
                style={{
                  flex: "none",
                  font: `700 7.5px ${HUD_SANS}`,
                  color: offer.surged ? "#a8541f" : "rgba(32,30,29,.55)",
                }}
              >
                {offer.bonus}
              </span>
            </>
          )}
        </div>
      )}

      {!dense && (
        <>
        <div
          style={{
            font: `700 13px/1.04 ${HUD_SERIF}`,
            color: HUD_INK,
            marginTop: 1.5,
            marginBottom: 0.5,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {offer.title}
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 4,
            marginBottom: "auto",
            font: `600 7px ${HUD_SANS}`,
            color: "rgba(32,30,29,.55)",
            overflow: "hidden",
            whiteSpace: "nowrap",
          }}
        >
          <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{offer.sub}</span>
          {/*
            The comp hangs the load — "3 items", "2 riders" — off the dropoff
            here, and gives the detour to the rail below. They used to be the
            same figure in both places, which spent a line saying nothing.

            **When the rail is dropped the detour takes this slot back.** A
            short phone loses the drawing, not the number: it is the one figure
            on the card that decides whether the job is worth taking, and there
            is nowhere else on that screen for it to go.
          */}
          {(showRail ? offer.meta : (offer.detour ?? offer.meta)) && (
            <>
              <span
                aria-hidden="true"
                style={{
                  width: 2,
                  height: 2,
                  borderRadius: "50%",
                  background: "rgba(32,30,29,.25)",
                  flex: "none",
                }}
              />
              <span
                style={{ flex: "none", font: `700 6.5px ${HUD_SANS}`, color: "rgba(32,30,29,.45)" }}
              >
                {showRail ? offer.meta : (offer.detour ?? offer.meta)}
              </span>
            </>
          )}
        </div>
        </>
      )}

      {showRail && (
        <div data-testid="detour-rail" style={{ margin: "5px 0 6px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 3.5, marginBottom: 3 }}>
            <span
              aria-hidden="true"
              style={{ width: 5, height: 5, borderRadius: "50%", background: HUD_INK, flex: "none" }}
            />
            <span
              aria-hidden="true"
              style={{ width: 13, height: 1.75, borderRadius: 1, background: "rgba(32,30,29,.3)" }}
            />
            <span
              aria-hidden="true"
              style={{
                flex: 1,
                height: 1.75,
                borderRadius: 1,
                background:
                  "repeating-linear-gradient(90deg,rgba(168,84,31,.85) 0 5px,transparent 5px 10px)",
                backgroundSize: "15px 2px",
                animation: "hudDetourRail .8s linear infinite",
              }}
            />
            <svg width="8" height="8" viewBox="0 0 24 24" fill="#a8541f" style={{ flex: "none" }} aria-hidden="true">
              <path d="M12 2a7 7 0 0 0-7 7c0 5.2 7 13 7 13s7-7.8 7-13a7 7 0 0 0-7-7Zm0 9.6A2.6 2.6 0 1 1 12 6.4a2.6 2.6 0 0 1 0 5.2Z" />
            </svg>
            <span
              aria-hidden="true"
              style={{ flex: 1, height: 1.75, borderRadius: 1, background: "rgba(32,30,29,.18)" }}
            />
            <span
              aria-hidden="true"
              style={{ width: 5, height: 5, borderRadius: 1.5, background: "rgba(32,30,29,.35)", flex: "none" }}
            />
          </div>
          <div style={{ display: "flex", alignItems: "center" }}>
            <span style={{ font: `800 5.25px ${HUD_SANS}`, letterSpacing: "0.75px", color: "rgba(32,30,29,.38)" }}>
              YOU
            </span>
            <span
              data-testid="detour-label"
              style={{
                margin: "0 auto",
                font: `900 6.5px ${HUD_SANS}`,
                color: "#a8541f",
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {offer.detour}
            </span>
            <span style={{ font: `800 5.25px ${HUD_SANS}`, letterSpacing: "0.75px", color: "rgba(32,30,29,.38)" }}>
              BACK ON ROUTE
            </span>
          </div>
        </div>
      )}

      <div style={{ display: "flex", gap: 5, marginTop: showRail ? 0 : 5 }}>
        <button
          type="button"
          data-testid="offer-pass"
          onClick={onPass}
          aria-label="Pass on this job"
          style={{
            width: passPx,
            flex: "none",
            height: 31,
            borderRadius: 9,
            background: "rgba(32,30,29,.06)",
            border: "1.5px solid rgba(217,97,76,.35)",
            font: `900 8.5px ${HUD_SANS}`,
            letterSpacing: "1px",
            color: "#b04a34",
            cursor: "pointer",
          }}
        >
          PASS
        </button>
        <button
          type="button"
          data-testid="offer-accept"
          onClick={onAccept}
          aria-label="Accept this job"
          style={{
            flex: 1,
            height: 31,
            borderRadius: 9,
            background: "linear-gradient(180deg,#9dbb7f,#7d9e63)",
            border: "none",
            font: `900 11.5px ${HUD_SANS}`,
            letterSpacing: "1px",
            color: "#16210f",
            cursor: "pointer",
            boxShadow:
              "0 6px 13px -6px rgba(125,158,99,.9), inset 0 1px 0 rgba(255,255,255,.34)",
          }}
        >
          ACCEPT
        </button>
      </div>
    </div>
  );
}
