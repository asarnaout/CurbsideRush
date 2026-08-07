# Gigs, dispatch, career and the save file

Everything money touches. Read this before changing what work appears, what it
pays, what anything costs, or what persists. All of it is outer-ring — the
simulation core still knows nothing about money.

## Dispatch: how work reaches the driver

`dispatch.ts` is a second pure module beside `gigs.ts` (its only import is
`hashToUnit` from it) owning **when** work appears, not what it is.

Offers open, hold `OFFER_WINDOW_MS` (15 s), and are accepted, passed or lost; a
quiet spell follows (`SEARCH_MIN_MS` 2.5 s to `SEARCH_MAX_MS` 45 s), biased
short. Everything is a function of a seed and **sim-clock ms**, so it pauses with
the game and a retried career day offers the identical sequence — which is why
the seed advances per offer **opened**, never per offer accepted.

A drive opens with one already waiting. **Stacking is one deep**: accepting while
carrying queues a job, which the drop-off *promotes* rather than conjures. With
both hands full dispatch goes quiet and re-arms, so clearing the queue starts a
fresh wait instead of firing instantly.

### Surge is stateless

Rather than storing a window and ticking it down, the clock is chopped into
`SURGE_EPOCH_MS` (30 s) epochs and each is asked whether it opened one, overlaps
merging to the later end. Nothing to reset, nothing to persist, no way to drift
from the seed; the lookback is O(4).

A surged gig is priced at generation (`generateGigFromPools`'s multiplier), so
`Gig.reward` *is* the figure paid and no consumer can forget to apply it. `Gig`
also carries its own `seed`, which is what lets every tip stay a pure function
instead of a number stamped on and kept in step by hand.

`careerBalance.test.ts` prices the **unsurged** fare deliberately: surge is upside
a player chases, not income the ladder is balanced against.

### Tips live here, not in `career.ts`, because free drive pays them too

- A **food order** quotes its tip up front (it shows on the offer, and pays late
  or not); a quick one *may* add a speed bonus, on a bit under half of on-time
  runs (`FOOD_SPEED_BONUS_CHANCE`).
- A **rider's** tip is hidden until they get out and falls with both the time
  taken and the rules broken while they were aboard.

Violations come from the app counting any event carrying a `ruleCode` while
carrying — `processSimulationEvents` already emits every rule trip and only the
extra `fine` is patrol-gated, so this needed no simulation change.

## Career Mode

A second mode beside free drive: a **ladder of cities**, prepaid vehicle rental,
a ~6-minute sim-clock day, 25% commission + a flat platform fee, shortfall→3-day
loan at +15%, one FINAL NOTICE, and a **customer rating** that can end a run.

**`CAREER_CITIES` is the single knob that defines the route** — start city,
unlock order and ticket destinations all derive from it. Today:
`us-nyc → jp-tokyo → eg-cairo → uk-london`.

### `app/game/career.ts` is the pure brain

gigs.ts-style: vehicle catalog (physics / fuel / fares / allowed gig kinds),
`settleDay`, seeds, checksum codec. **Tune numbers there, nowhere else.**

`settleDay` order: recap → platform fee → ceil-per-remaining-day installment →
shortfall→loan → bankruptcy gate; the final notice clears only on a clean one.

`tests/careerBalance.test.ts` trips if rent + fee exceeds 4 median gig nets in any
**ladder** city, or if a ticket stops being reachable in 3–20 days of driving. It
is scoped to `CAREER_CITIES` because rent is only ever charged on the ladder; the
two sets coincide today, so a free-drive-only city sits outside the tripwire until
you promote it. It prices at full standing, which is what an unrated driver gets.

### Everything is per city, keyed by destination

`CareerSliceV2.cities` holds cash, debt, day counter, fleet, stats and standing.
**Presence in that map *is* the unlock** — there is no second list.

`activeCity(slice)` returns the current one plus `destinationId`/`countryId` under
the names the app already used, which is why the views stay props-pure; `withCity`
is the only way to edit one. Currency needs no special handling as a result: every
price goes through `formatMoney(amount, country)` with `country` derived from the
active city, so Tokyo reads in yen throughout.

### Standing: the second way to lose a city

Career only. `gigRating` (in `dispatch.ts`, beside the tip, off the same seed and
the same two measurements) scores every gig 1–5, bar the `RATING_SILENCE_CHANCE`
who never rate. `settleRating` folds the day's in beside `settleDay` — money is
not standing — and warns once before `applySettlement` wipes the city through the
same `createCityState` bankruptcy uses. Unlike the loan's notice, any settlement
back above the threshold clears the warning.

- **The window rolls (`RATING_WINDOW`), it does not accumulate.** A lifetime
  average freezes after ~100 gigs: the penalties stop answering to how the driver
  drives and the ending becomes arithmetically unreachable.
- **`RATING_END_THRESHOLD` is 1.5, not the 1.0 issue #221 asks for** — a literal
  1.00 needs *every* gig in the window to be a flat single star. Relatedly,
  nothing floors the speed term the way `RIDE_TIP_SLOW_FLOOR` does: a floor would
  leave a delivery-only courier unable to reach the threshold at all.
- **The standing is a morning snapshot** (`CareerRun.ratingStanding`), never read
  live: work arriving faster mid-shift would say a customer had just rated you.
  **The garage alone shows it** — `GarageRating` off the pure `garageRatingModel`,
  whose copy is worded from `RATING_END_THRESHOLD` so it cannot quote a stale
  figure. A `careerFlow` test asserts both halves: present there, absent driving.

### Travel, bankruptcy and winning

- **Travel is one-way by ticket, free thereafter.** `applyTicket` debits the
  departure city and opens the next on a fresh sheet; `travelTo` moves between
  cities already reached at no cost. Nothing crosses — money and vehicles stay
  where they were earned.
- **Losing a city is local**, whether the bank calls it or the customers do: it
  resets that city (starting float, day 1, debts cleared, standing cleared,
  **fleet repossessed**) and leaves the rest of the career standing. The
  repossession is load-bearing — without it, going bust would be a strictly better
  exit from a bad loan than driving out of it. There is no terminal failure state.
- **Winning is `careerWon`**: stand in the last ladder city having bought every
  `buyoutEligible` vehicle in *every* city. `withVictoryIfEarned` stamps it on the
  two moves that can complete it (a purchase, a flight) and it is sticky. Buying
  is gated on **cash alone** — debt and the final notice do not block it, and
  there is no cap on how many you own.

### A day is a GameCanvas remount

`buildCareerDayScenario` gives each day its own scenario id + traffic seed, and the
React key carries `-d${day}-${vehicleId}`. The day clock rides
`GameHudSnapshot.simElapsedMs` (sim time — pauses with the sim; the app folds it
across tow resets).

Whistle mid-cutscene defers settlement until the scene's `done` lands — which is
also why career gig payouts are **synchronous in the cutscene handler**, not the
free-drive payout effect.

### The vehicle catalog

`CAREER_VEHICLES`, in ascending rent = ascending capability order (the walk in
`garageDefaultVehicle` depends on that ordering, not on price, because an owned
vehicle rents at 0 yet is still the better ride).

**A fresh garage opens on the motorbike** (`DEFAULT_GARAGE_VEHICLE_ID`) — the
cheapest ride that actually earns. `CAREER_STARTING_CASH_BY_COUNTRY` is held above
its rent so that stands; the free bicycle is only the fallback.

**Per-vehicle physics are `SimulationCoreConfig` fields whose defaults equal the
old literals exactly** — the acceptance replay pins that identity, so never change
a default without meaning to change free drive. NPC-to-NPC spacings are
deliberately pinned literals (they must not re-space around the player's vehicle).

Career top speeds are set *against* free drive's, not derived from it: the
`BabylonGameSession` constructor spreads `vehiclePhysics` **after** the adapter's
config, so the adapter's figure is simply overwritten. Every motorised career
vehicle carries a +10 mph uplift over its original, which is why the sports car
is now a shade *faster* than free drive.

**The catalog splits three ways visually**: three car models, plus the bicycle and
motorbike as composed rigs (`model: null`). Both two-wheelers force third-person —
there is no cockpit to sit in — take `buildBikeErrandScript` with their own
`CutsceneBodyProfile` instead of car doors, and hide the rider for the scene. Cars
take a profile scaled from `VEHICLE_DIMENSIONS`, so a van's doors sit on its real
flanks; anything with no registered dimensions falls through to
`DEFAULT_CUTSCENE_BODY` unchanged.

## Damage, repair and towing

`damage.ts` is pure and imports nothing. Condition is per-drive app state starting
at `FULL_CONDITION_PCT` (100); it is **never persisted** — the bill is.

`damageForCollision` reads the event's own evidence: walls and cars scale with
impact speed, pedestrians barely mark the car (their cost is the citation), and
props charge a flat rate by heft.

Two ways to pay, both priced by `repairPrice` in `economyTables.ts` (which is
where the currencies live):

- **Drive into a repair shop's bay** — the `repair` cutscene step pays and mends
  atomically, billed on the damage carried, with no session reset.
- **Hit zero** — `beginTow` fires, the session resets, and the bill is the full
  100% at `ROADSIDE_PRICE_FACTOR` plus `ROADSIDE_CALLOUT_FEE_BY_COUNTRY`.

`MIN_REPAIRABLE_DAMAGE_PCT` (5) is where no shop bothers lifting the bonnet: five
points is about a dollar's work in every currency, saving a per-country table.

## Fuel: the two modes price it differently on purpose

**Free drive sells what the wallet covers** — `fuelPurchase` in `economyTables.ts`
caps the litres at the money on hand, so short money buys a short fill, not a
refusal.

**Career does not come through that helper, and is never capped.** Its pump will
always sell a whole tank whatever the day cash, pushing the day into the red for
the night's settlement and its loans to absorb. Capping it would leave a driver
already in the red unable to buy fuel at all while the far dearer roadside rescue
stayed free — the same backwardness `repairPrice` avoids by never gating the shop.

What career gained instead is the **choice**, since the shortfall is not free: it
settles into a loan at `LOAN_ORIGINATION_RATE`. When the day's cash falls short,
the prompt splits in two (`splitPrompt`) — a cash-only top-up and the full fill
with the rest borrowed.

- **Enter always takes the first entry, and the cash offer is deliberately
  first.** Mashing Enter at a pump must never sign a driver up for a loan.
  Pressing it twice spends the cash and then borrows, landing exactly where the
  old single button did — by two decisions rather than none.
- **B is the borrow key**, live only while there is something to borrow.
- **The offer withholds itself below `MIN_REFUEL_LITRES`** (0.5) — below that the
  tank is full enough or the money short enough that the prompt says so instead
  of staging a cutscene, so there is never a choice between a loan and a thimbleful.

**Which offer was taken rides on the cutscene request's `fuelFillFraction`**, not
a second channel: the `pump` step pours and bills that fraction of the tank. Free
drive alone re-prices at `pump` time, because a citation can still land mid-scene
and its wallet, unlike career's day cash, must not go negative.

## The save file

`PROGRESS_STORAGE_KEY` is `sideswap:v2`. `progress.ts` owns loading,
current-schema normalization, and every write path. Older keys are ignored; the
unreleased game carries no save migration. Load and save both rebuild from the
known current fields, repairing malformed values and stripping unknown ones.

### Career persists inside `PlayerProgressV2.career`

`writeCareer`/`clearCareer` are the **ONLY** sanctioned write paths. `saveProgress`
re-verifies the FNV-1a checksum via the current-schema parser, so any other mutation path
comes back `{state:"corrupt"}` on the next load — and that corrupt marker is
itself persisted state.

Anything whose `version` is not 2 decodes to **`null`, not corrupt** — obsolete is
not tampered with. **That is why a new `CareerCityState` field must be optional
rather than a version bump**, which would silently delete every career on disk;
`stableStringify` skips undefined keys, so an older save still checksums to what
it was stamped with. (One in-codec migration rides after checksum verification —
see `parseCareerSlice` for the pre-Cairo winner.)

Career money is day-local (`dayCash`/`dayLog` refs in `SideSwapApp`), integer-only,
and **never touches** `walletByCountry`/`fuelByCountry`. Saves
happen at **day boundaries only** — a mid-day quit redoes the day, with per-day
seeds from `careerDayTrafficSeed`, which folds in the city index so day 3 in Tokyo
is not day 3 in New York.

The one career field *outside* the slice is `lastCareerVehicleId` — a preference,
so it is unchecksummed — and it has no React state: `SideSwapApp` reads the garage
selection straight off `progress`, and **every** path that moves it goes through
`commitGarageVehicle`, which is what keeps the stored pick and the highlighted card
identical. Setting it any other way persists nothing.
