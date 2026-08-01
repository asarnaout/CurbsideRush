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
loan at +15%, one FINAL NOTICE.

**`CAREER_CITIES` is the single knob that defines the route** — start city,
unlock order and ticket destinations all derive from it. Today:
`us-nyc → jp-tokyo → eg-cairo → uk-london`.

### `app/game/career.ts` is the pure brain

gigs.ts-style: vehicle catalog (physics / fuel / fares / allowed gig kinds),
`settleDay`, seeds, checksum codec. **Tune numbers there, nowhere else.**

`settleDay` order: recap → platform fee → ceil-per-remaining-day installment →
shortfall→loan → bankruptcy gate. The final notice clears only on a fully clean
settlement.

`tests/careerBalance.test.ts` trips if rent + fee exceeds 4 median gig nets in any
**ladder** city, or if a ticket stops being reachable in 3–20 days of driving.
It is scoped to `CAREER_CITIES` rather than every destination because rent is
only ever charged on the ladder; today the two sets coincide, so adding a
free-drive-only city puts it outside this tripwire until you promote it.

### Everything is per city, keyed by destination

`CareerSliceV2.cities` holds cash, debt, day counter, fleet and stats. **Presence
in that map *is* the unlock** — there is no second list.

`activeCity(slice)` returns the current one plus `destinationId`/`countryId` under
the names the app already used, which is why the views stay props-pure; `withCity`
is the only way to edit one. Currency needs no special handling as a result: every
price goes through `formatMoney(amount, country)` with `country` derived from the
active city, so Tokyo reads in yen throughout.

### Travel, bankruptcy and winning

- **Travel is one-way by ticket, free thereafter.** `applyTicket` debits the
  departure city and opens the next on a fresh sheet; `travelTo` moves between
  cities already reached at no cost. Nothing crosses — money and vehicles stay
  where they were earned.
- **Bankruptcy is local**: it resets that city (starting float, day 1, debts
  cleared, **fleet repossessed**) and leaves the rest of the career standing. The
  repossession is load-bearing — without it, going bust would be a strictly better
  exit from a bad loan than driving out of it. There is no terminal failure state.
- **Winning is `careerWon`**: stand in the last ladder city having bought every
  `buyoutEligible` vehicle in *every* city. `withVictoryIfEarned` stamps it on the
  two moves that can complete it (a purchase, a flight) and it is sticky. Buying
  is gated on **cash alone** — debt and the final notice do not block it, and
  there is no cap on how many you own.

### A day is a GameCanvas remount

`buildCareerDayLesson` gives each day its own lesson id + traffic seed, and the
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

| id | model | rent (US) | top speed m/s |
|---|---|---|---|
| `bicycle` | composed rig | owned, 0 | 7.5 |
| `motorbike` | composed rig | 10 | 28.4704 |
| `compact-hatch` | `compact-hatch` | 16 | 26.4704 |
| `delivery-van` | `delivery-van` | 26 | 23.4704 |
| `sport-sedan` | `sport-sedan` | 38 | 31.4704 |

**A fresh garage opens on the motorbike** (`DEFAULT_GARAGE_VEHICLE_ID`) — the
cheapest ride that actually earns. `CAREER_STARTING_CASH_BY_COUNTRY` is held above
its rent so that stands; the free bicycle is only the fallback.

**Per-vehicle physics are `SimulationCoreConfig` fields whose defaults equal the
old literals exactly** — the acceptance replay pins that identity, so never change
a default without meaning to change free drive. NPC-to-NPC spacings are
deliberately pinned literals (they must not re-space around the player's vehicle).

Career top speeds are set *against* free drive's, not derived from it: the
`BabylonGameSession` constructor spreads `vehiclePhysics` **after** the adapter's
config, so the adapter's 31.29 m/s (70 mph) is simply overwritten. Every motorised
career vehicle carries a +10 mph (4.4704 m/s) uplift over its original figure —
which is why `compact-hatch` reads 26.4704 rather than the core's own default of
22, and why the sports car (31.4704) is now a shade *faster* than free drive.

**The catalog splits three ways visually**: three car models, plus the bicycle and
motorbike as composed rigs (`model: null`). Both two-wheelers force third-person —
there is no cockpit to sit in — take `buildBikeErrandScript` with their own
`CutsceneBodyProfile` (`BIKE_CUTSCENE_BODY` / `MOTORBIKE_CUTSCENE_BODY`) instead of car doors,
and hide the rider on the vehicle for the scene (`cutsceneBody`, `startCutscene`).
Cars take a profile scaled from `VEHICLE_DIMENSIONS`, so a van's longer bumpers are
skirted and its doors sit on its real flanks; free drive's own car — and any vehicle
with no registered dimensions — falls through to `DEFAULT_CUTSCENE_BODY` unchanged.

## Damage, repair and towing

`damage.ts` is pure and imports nothing. Condition is per-drive app state starting
at `FULL_CONDITION_PCT` (100); it is **never persisted** — the bill is.

`damageForCollision` reads the event's own evidence: walls and cars scale with
impact speed (a 2 m/s scrape is free, a 15 m/s head-on takes ~40), pedestrians
barely mark the car (their cost is the citation), props charge a flat rate by heft.

Two ways to pay, both priced by `repairPrice` in `content.ts` (which is where the
currencies live):

- **Drive into a repair shop's bay** — the `repair` cutscene step pays and mends
  atomically, billed on the damage carried, with no session reset.
- **Hit zero** — `beginTow` fires, the session resets, and the bill is the full
  100% at `ROADSIDE_PRICE_FACTOR` plus `ROADSIDE_CALLOUT_FEE_BY_COUNTRY`.

`MIN_REPAIRABLE_DAMAGE_PCT` (5) is where no shop bothers lifting the bonnet —
five points is about a dollar's work in every currency, which is what saves
inventing a per-country minimum-bill table.

## Fuel: the two modes price it differently on purpose

**Free drive sells what the wallet covers** — `fuelPurchase` in `content.ts` caps
the litres at the money on hand, so short money buys a short fill rather than
being refused outright (the prompt reads "Top up" instead of "Refuel", and the
pump event pours exactly what was quoted).

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
- **The offer withholds itself below `MIN_REFUEL_LITRES`**, so there is never a
  choice between a loan and a thimbleful.
- `ServicePromptAction` is presentation only. Its callbacks close over
  `cutsceneRef` through `beginCutscene`, and the React Compiler treats any
  property read on an array holding one — `.length` included — as a ref access
  during render, which costs the whole component its memoization.

**Which offer was taken rides on the cutscene request's `fuelFillFraction`**, not
a second channel: the `pump` step pours and bills that fraction of the tank. Free
drive alone re-prices at `pump` time, because a citation can still land mid-scene
and its wallet, unlike career's day cash, must not go negative.

`MIN_REFUEL_LITRES` (0.5) is the floor under all of it: below that the tank is
full enough or the money short enough that the prompt says so instead of staging
a cutscene.

## The save file

`PROGRESS_STORAGE_KEY` is `sideswap:v2`. `progress.ts` owns loading, migration and
every write path.

`PlayerProgressV2` holds `walletByCountry`, `fuelByCountry`, `lifetimeEarnings`,
`completedGigCount`, last country/destination, camera preference, accessibility,
`career`, `lastCareerVehicleId` and `updatedAt`. Older keys (`sideswap:v1`,
`sideswap:progress`, `sideswap:v0`) are migrated forward and removed.

**`migrateProgress` runs on save as well as load** and rebuilds from known keys
only — a new field is stripped on the next write unless added there too.

### Career persists inside `PlayerProgressV2.career`

`writeCareer`/`clearCareer` are the **ONLY** sanctioned write paths. `saveProgress`
re-verifies the FNV-1a checksum via `migrateProgress`, so any other mutation path
comes back `{state:"corrupt"}` on the next load — and that corrupt marker is
itself persisted state.

A blob with **no `version` decodes to `null`, not corrupt** — obsolete is not
tampered with. Only *after* checksum verification, a pre-Cairo `won` slice with no
Cairo ledger reopens as active and clears `victoryDay`; active legacy London stays
reachable, but Cairo is created only by buying Tokyo's ticket.

Career money is day-local (`dayCash`/`dayLog` refs in `SideSwapApp`), integer-only,
and **never touches** `walletByCountry`/`fuelByCountry`/`lifetimeEarnings`. Saves
happen at **day boundaries only** — a mid-day quit redoes the day, with per-day
seeds from `careerDayTrafficSeed`, which folds in the city index so day 3 in Tokyo
is not day 3 in New York.

The one career field *outside* the slice is `lastCareerVehicleId` — a preference,
so it is unchecksummed — and it has no React state: `SideSwapApp` reads the garage
selection straight off `progress`, and **every** path that moves it goes through
`commitGarageVehicle`, which is what keeps the stored pick and the highlighted card
identical. Setting it any other way persists nothing.
