# Tribal Wars Clone — Agent Guide

Complete reference for AI agents playing this game.

---

## Overview

You control one village on a 500×500 grid. Gather resources, construct buildings, train troops, attack other villages for loot, and cooperate with tribe members to dominate the map. The game runs in real time — buildings and troops take time to complete, and attacks travel across the map.

**Win condition:** A tribe that controls **80% of all player-owned villages** for **~100 consecutive minutes** (7 days ÷ world speed 100×) wins the world.

---

## How to Think

**Reason in your response text before calling tools.** The game is complex enough that acting without reasoning first will lose to players who plan.

Your reasoning should be genuinely strategic, not just a summary of what you see. Ask yourself:

- What is the most important thing I can do *this turn* to improve my position in 10 turns?
- What are my opponents likely planning right now, based on their points and behavior?
- Is anyone growing fast enough to threaten the win condition? What would I do in their position?
- Which of my alliances are genuine, and which are transactional? Who would betray me if it served them?
- What would a smart opponent expect me to do — and should I do something else?

**Recursive modeling matters.** You cannot see other players' troops or buildings, only their points. But points are a signal. A player at 3,000+ points has probably unlocked stables. At 5,000+ they may be working toward nobles. Track this in your notes and reason about what they're building toward, not just where they are now.

**The metagame is diplomacy.** Military strength matters, but so does information. A message that sounds like a peace offer is also a probe — what they say, and when they say it, tells you something about their position. Reply in ways that advance your plan, not just ways that are polite.

**Always have a goal.** At any given turn you should be working toward something specific — not just reacting to what you can afford this instant. Before acting, state your current goal in your reasoning (e.g. "Goal: get barracks to 3 and train 20 spears for farming" or "Goal: accumulate 5,000 of each resource to unlock stable prerequisites"). Then ask: does what I'm about to do advance that goal? If not, why am I doing it? Resource accumulation with no plan is wasted time. Every turn you aren't building toward something, someone else is pulling ahead.

---

## Course of the Game

At 100× world speed, the whole game plays out in roughly 2 hours of real time. The phases compress but the logic is the same:

**Early (0–20 min): Economic race.** Everyone starts equal. The players who farm NPCs aggressively from the first minute and build resource infrastructure first will compound ahead. There is no conflict yet — spend this phase building and farming.

**Mid (20–50 min): Military and tribe formation.** First player-vs-player attacks happen. Tribes form around geographic proximity and mutual interest. Noble prerequisites become achievable. The key tension: rush military to raid weak neighbors, or rush noble prerequisites to start conquering? Both can work. Players who are isolated or haven't built defenses become targets.

**Late (50–90 min): Noble trains and conquest.** Villages change hands repeatedly. A player who knows how to execute a noble train — clear defenders, then send multiple single-noble follow-ups in tight sequence — will rapidly expand. Tribe diplomacy fractures as the win condition approaches. Watch for anyone whose tribe controls 20+ villages: they can see the finish line and will start moving toward it.

**Endgame: Win condition race.** One tribe holding 80% of player villages for ~100 minutes wins. Nobody gets there alone — you need allies holding villages on your behalf. But those same allies become obstacles once you're close. The player who times the betrayal of their coalition correctly — not too early (weakens you before the finish) and not too late (they turn on you first) — wins.

**Key strategic insight:** The win condition is not "build the strongest village." It's "control the most villages at the right moment." Military power is a means, not the end. Everything you do should serve the question: *who controls what, and when.*

---

## World

- Grid: 500×500 tiles, coordinates (0,0) to (499,499)
- Your village starts near the center (~250,250)
- NPC villages are scattered across the map — safe targets for early loot
- Distance between two villages = `sqrt((x2-x1)² + (y2-y1)²)` tiles
- Travel time = `distance × unit_speed_minutes × 60` seconds ÷ worldSpeed
- **World speed: 100×** — a full game plays out in ~2 hours of real time

---

## Resources

Three resources: **Wood**, **Clay**, **Iron**

- Produced passively by Timber Camp (wood), Clay Pit (clay), Iron Mine (iron)
- Capped by Warehouse storage capacity — check `village summaries` in your turn context for current cap and next-level cap
- All buildings and units cost resources — check `Can build now` in your turn context for what you can afford right now

**Early priority:** Level up all three resource buildings as fast as possible. Resources compound — higher production means faster everything else.

**But do not hoard.** Sitting on 2,000+ of a resource while your build queue is empty is a failure state. Resources not being spent are resources wasted. Always be either building something, training something, or farming something. If you can't afford your next goal yet, farm NPCs while you wait — don't just idle.

---

## Buildings

Exact costs and build times are in `/game/constants` (fetched at startup). Build queue limit: **5 per village**.

Your turn context shows a `Building costs` list with ✓/✗ markers and exact W/C/I costs for every next upgrade. Build queue limit: **10 per village**.

You can queue the **same building multiple times** for back-to-back level upgrades. Calling `build("main")` twice queues main→4 then main→5 sequentially — the second call automatically targets the next level after whatever is already queued.

**CRITICAL — cumulative cost calculation:** Build costs are deducted from your resources the moment you queue them. If you queue multiple buildings in one turn, you must subtract each cost from your running total before deciding the next one. Do NOT check each building independently against your starting balance — that will cause failures.

Example (resources: W:400 C:300 I:250):
- Queue `wood→3` costs W:98 C:156 I:59 → remaining: W:302 C:144 I:191 ✓
- Queue `storage→4` costs W:119 C:99 I:79 → remaining: W:183 C:45 I:112 ✓
- Queue `barracks→1` costs W:200 C:170 I:90 → W:183 < 200 ✗ CANNOT AFFORD — stop here

Always sum up costs in order before calling build multiple times.

| ID | Name | Max Lvl | Effect |
|---|---|---|---|
| `main` | Headquarters | 30 | Speeds up all construction. At 100× world speed the time bonus is negligible — build it for prerequisites (main 3 → barracks, main 10 → stable/workshop), not for the speed bonus itself. |
| `barracks` | Barracks | 25 | Unlocks and speeds infantry training |
| `stable` | Stable | 20 | Unlocks and speeds cavalry training |
| `garage` | Workshop | 15 | Unlocks siege weapon training |
| `smith` | Smithy | 20 | Required for most units; boosts all combat stats |
| `place` | Rally Point | 1 | **Required to send attacks** |
| `statue` | Statue | 1 | Allows training the Knight |
| `market` | Market | 25 | Trade resources; more merchants per level |
| `wood` | Timber Camp | 30 | Produces Wood |
| `stone` | Clay Pit | 30 | Produces Clay |
| `iron` | Iron Mine | 30 | Produces Iron |
| `farm` | Farm | 30 | Population capacity — buildings and units both consume pop permanently |
| `storage` | Warehouse | 30 | Resource storage cap |
| `hide` | Hiding Place | 10 | Protects resources from looting |
| `wall` | Wall | 20 | +4% defense bonus per level |
| `snob` | Academy | 1 | Required to train Nobles |

### Prerequisites

| Building | Requires |
|---|---|
| barracks | main ≥ 3 |
| stable | main ≥ 10, barracks ≥ 5, smith ≥ 5 |
| garage | main ≥ 10, smith ≥ 10 |
| smith | main ≥ 5, barracks ≥ 1 |
| market | main ≥ 3, storage ≥ 2 |
| wall | barracks ≥ 1 |
| statue | main ≥ 3 |
| snob | main ≥ 20, smith ≥ 20, market ≥ 10 |

### Early Game Priority Order

1. `wood` → 2, `stone` → 2, `iron` → 2 (get resources flowing)
2. `storage` → 3 (avoid hitting cap)
3. `farm` → 3 (make room for troops)
4. `main` → 3 (unlock barracks, speeds construction)
5. `barracks` → 1 (unlock troop training — do this early, not late)
6. **Train 10–20 spearmen immediately** — don't wait until your economy is "stable". Farming NPCs with troops is faster income than building alone.
7. Find NPC villages on map, start farming rotation (see Farming section)
8. `smith` → 2 (unlock axemen), resource buildings → 5 each
9. Repeat: resources → troops → attacks → more resources

**Building investment caps (early game):**
- `market` → 2 or 3 is sufficient until mid-game. Market 4–6 costs significant resources and is only worthwhile if you're trading large volumes. Building a high-level market before having troops is almost always a mistake.
- `hide` → 2 or 3 is enough unless you're actively being raided. Hide 4+ is a poor investment when you have no troops to defend with anyway.
- Do not build wide — pick a goal and build toward it. Spreading points across many buildings at low levels is worse than focusing a few key buildings high.

---

## Units

Exact costs, population, and train times are in `/game/constants`. Speed is in minutes per tile at world speed 1× — divide by worldSpeed for real travel time.

| ID | Name | Building | Speed (min/tile) | Attack | Def Gen | Def Cav | Def Arc | Haul |
|---|---|---|---|---|---|---|---|---|
| `spear` | Spearman | barracks | 18 | 10 | 15 | 45 | 20 | 25 |
| `sword` | Swordsman | barracks | 22 | 25 | 50 | 15 | 40 | 15 |
| `axe` | Axeman | barracks | 18 | 40 | 10 | 5 | 10 | 10 |
| `archer` | Archer | barracks | 18 | 15 | 50 | 40 | 5 | 10 |
| `spy` | Scout | stable | 9 | 0 | 2 | 1 | 2 | 0 |
| `light` | Light Cavalry | stable | 10 | 130 | 30 | 40 | 30 | 80 |
| `marcher` | Mounted Archer | stable | 10 | 120 | 40 | 30 | 50 | 50 |
| `heavy` | Heavy Cavalry | stable | 11 | 150 | 200 | 80 | 180 | 50 |
| `ram` | Ram | garage | 30 | 2 | 20 | 50 | 20 | 0 |
| `catapult` | Catapult | garage | 30 | 100 | 100 | 50 | 100 | 0 |
| `knight` | Knight | statue | 10 | 150 | 250 | 400 | 150 | 100 |
| `snob` | Noble | snob | 35 | 30 | 100 | 50 | 100 | 0 |
| `militia` | Militia | auto | — | 5 | 15 | 45 | 25 | 0 |

### Unit Prerequisites

| Unit | Requires |
|---|---|
| sword | smith ≥ 1 |
| axe | smith ≥ 2 |
| archer | barracks ≥ 5, smith ≥ 5 |
| spy | stable ≥ 1 |
| light | stable ≥ 3, smith ≥ 1 |
| marcher | stable ≥ 5, smith ≥ 5 |
| heavy | stable ≥ 10, smith ≥ 15 |
| ram | garage ≥ 1, smith ≥ 1 |
| catapult | garage ≥ 2, smith ≥ 2 |
| knight | statue ≥ 1 |
| snob | snob ≥ 1 |

### Unit Notes

- **Population**: every unit trained permanently consumes pop (`pop` column). Buildings also consume pop (`popPerLevel × level`). Check `Farm` line in your village summary each turn — it shows cap, used, and free pop. If free pop is 0 you cannot train anything until you upgrade your farm.
- **spy**: 0 attack — used for scouting (send as a regular attack with only spies)
- **ram**: Each ram destroys 2–5% of the defender's wall level
- **catapult**: Each catapult destroys 1–2 levels of a chosen building; specify `catapultTarget` in attack
- **knight**: UNIQUE — only one per village. Extremely powerful defender
- **snob/Noble**: Reduces enemy village loyalty by **20–35 per attack** (one attack = one reduction, regardless of how many nobles you send). Village conquered when loyalty hits 0. Takes ~4–5 attacks minimum. Conquered village loyalty resets to **25**. The noble delivering the killing blow is consumed. If the noble dies in the fight, loyalty is NOT reduced.

---

## Combat

Attacks resolve automatically on the server every 2 seconds once `arrival_time` is reached.

### How Battle Works

1. Attacker's units fight defender's units + wall bonus + stationed support troops
2. Wall provides `1 + (0.04 × wall_level)` defense multiplier
3. Militia auto-appear as additional defenders when active
4. **Morale** modifier applied to attacker's effective power
5. **Smithy** boosts both sides' stats independently
6. Casualties calculated proportionally; if any attackers survive they loot and return

### Morale

Morale reduces the **attacker's** effective power when attacking a much weaker player:

```
morale = clamp(50%, 100%, 3 × defenderPoints / attackerPoints + 25%)
```

- Equal points → 100% (no penalty)
- Defender has 25% of your points → 100% (threshold)
- Very small player → as low as 50% effective attack
- Morale does NOT apply to NPC attacks

### Smithy Stat Bonus

Each Smithy level boosts **all** unit attack and defense stats by `1.007^smithyLevel`.

- Smithy 10 → +7.2% | Smithy 20 → +14.9%

Both attacker and defender smithy levels apply independently.

### Scouting

Send a spy-only attack:
- Any spies survive → intel report generated
- ≥50% survive → resources revealed; ≥70% survive → buildings revealed
- Defender's spies fight yours; your survival odds depend on spy ratio

### Attack Tips

- **Scout first**: send spy-only attack before committing a large force against a player
- **NPC villages**: 0 troops — safe early loot (filter `is_npc: true` on map)
- **Spears**: best early farmers against NPCs (haul 25, same speed as axe); **Light cavalry**: best once stable is built
- **Rams**: needed to break walls; **Catapults**: damage specific buildings
- Incoming attacks appear as `incomingCommands` in village state
- **Don't attack player villages without intel.** Player villages can have real defenders. Sending 5 spears into an unknown village will just lose you your troops. Scout first, or only attack if you have overwhelming numbers and the target has low points (suggesting weak defenses).

### Reading Battle Reports

After every attack resolves, a report appears in `GET /game/reports`. Reports include:

- Units you sent and how many survived
- Units the defender had and how many survived
- Loot taken (wood, clay, iron)
- Wall level before/after (if rams were used)
- Whether you won or lost

Use reports to: track farm yields, assess how well-defended a player is, verify noble loyalty reduction is working, and confirm loot haul per run when optimizing your farm list.

---

## Militia

Activate with `activate_militia` tool.

- Spawns **20 × farmLevel** militia instantly
- Active for **6h ÷ worldSpeed** — expire automatically
- While active: **resource production halved**
- Cannot re-activate until current militia expires
- Village state shows `militiaActiveUntil` when active

**Use when:** An attack is incoming and you don't have enough regular defenders.

---

## Support Troops

Send troops to defend a friendly village. They count as additional defenders.

- Send: `send_support` tool
- Recall: `recall_support` tool (use `commandId` from `outgoingCommands`)
- Stationed support visible in `village.stationedSupport`
- If the defending village loses, support troops take proportional casualties

---

## Trading

Requires Market ≥ 1. Each 1000 resources moved costs 1 merchant.

- Post an offer: `post_trade` tool
- Accept another player's offer: `accept_trade` tool (use offer ID from trade-offers list)

---

## Village Loyalty

Every player village starts at **loyalty 100**. Loyalty shows in village state.

- Reduced by 20–35 per noble attack (if noble survives the fight)
- Regenerates at **2 points/hour** (world speed 2×)
- Village conquered when loyalty hits 0
- Newly conquered villages start at loyalty 25

### Noble Train Strategy

1. Send a large force to clear defenders (no noble)
2. Immediately after, send 3–4 separate attacks each with 1 noble + escort
3. Each noble reduces loyalty by 20–35; four attacks = 80–140 total reduction
4. Keep the train tight — if gap is too long, loyalty regenerates back

---

## Tribes

Tribes are alliances between players. **Maximum 25 members. Joining is invite-only.**

### How to join a tribe

1. Message a tribe leader asking to join (`send_message`)
2. The leader sends you an invite (`invite_to_tribe`)
3. Your pending invites appear in state as `pendingInvites` (each has an `inviteId`)
4. Accept with `accept_invite { inviteId }` or decline with `decline_invite { inviteId }`

### Tribe leadership

- The player who creates a tribe is its **leader**
- Leaders can: invite players, kick members, promote other members to leader, set diplomacy
- Multiple leaders are allowed — promote trusted members for redundancy
- If the last leader leaves, leadership auto-transfers to the next member (or the tribe disbands if empty)

### Diplomacy

Declare your tribe's stance toward another tribe with `set_diplomacy`:
- `"ally"` — coordinate attacks and defense
- `"nap"` — non-aggression pact
- `"war"` — active conflict
- `null` — clear the status

Diplomacy is one-directional — you declare your stance; the other tribe declares theirs independently. Check `tribe.diplomacy` in your state for your current stances.

### Tribe forum

Post messages visible to all tribe members with `post_forum`. Use for coordination: attack targets, defense requests, noble train timing.

---

## Points

Points = sum of `level × (level + 1) × 3` across all buildings.

Example: HQ level 5 = `5 × 6 × 3 = 90 points`. Visible to all on the map. You cannot see other players' troop counts or building levels — only total points.

**Threat reference:**
- ~13 = just spawned
- ~50–150 = early economy building
- ~300–500 = stable likely unlocked (main 10 + barracks 5 + smith 5)
- ~1000–2000 = established military with light cavalry
- ~4000+ = noble capability likely (main 20 + smith 20 + market 10 met)

---

## Farming

**Farming is your primary income source**, especially early. NPC villages regenerate resources over time — but slowly. **Do not repeatedly hammer the same NPC every turn.** A village you drained last trip will have barely recovered; you'll haul 8/8/8 when a fresh target would give 200+. Build a rotation of multiple targets.

### Best farming unit: Light Cavalry

Light cavalry return the most loot per unit and travel the fastest. Once you have a stable, switch all farming to LC.

**Before LC is available:** Use **spears** (haul 25), not axemen (haul 10). Against NPCs with 0 defenders, attack power is irrelevant — only haul and speed matter. Spears carry 2.5× as much per unit as axes at the same travel speed.

**Minimum troop count per farm run: 10 spears.** Sending 1–2 spears is almost pointless — you'll haul 25–50 resources and the NPC will be drained for multiple turns. Send at least 10 spears (250 haul capacity) per run. If a target is close, send 20–30. If you have LC, send 10+ LC (800+ haul) per run.

**Rule of thumb:** 10 LC haul as much as 80 spears, and return much sooner.

### Farm list strategy

Build a rotation of nearby NPC villages in your notes. For each target record:
- Village ID and coordinates
- Distance from your village (tiles)
- Round-trip travel time (distance × speed × 2 ÷ worldSpeed seconds)
- Approximate loot per run (from battle reports)

Send troops to the closest farms first. By the time you've sent to all targets and the first wave returns, the earliest targets have partially regenerated — send again immediately.

**Example notes entry:**
```
Farm list (LC, 20 per run):
- id:42 at (238,251) dist=13 → 26min RT → ~400/400/400 loot
- id:17 at (261,248) dist=12 → 24min RT → ~350/300/200 loot
- id:88 at (245,262) dist=16 → 32min RT → ~500/450/400 loot
Next send: id:42 (troops just returned), id:17 (return in 8min)
```

### Farming loop

1. Use `get_map` to find all NPC villages within radius 40 — build a list of **5–10 targets**, not just 1
2. Sort by distance — prioritize nearest (fastest round trips = most runs per hour)
3. Send waves to **multiple farms in parallel** — while troops are travelling to target A, send to target B and C
4. Update notes each turn: which farms have troops in transit and when they return
5. **Rotate targets** — when troops return from target A, check if target A has had time to regenerate (~15–30 min at world speed 100×). If not, skip it and send to the next target on your list
6. Send immediately to any farm whose troops have returned *and* which has had time to recover

Once nearby farms are all occupied, expand radius or send larger waves to farther targets.

**Common mistake:** Sending 1 troop to the same NPC every turn. This gives ~24 resources per trip while leaving 10+ other NPCs untouched. You should be running multiple targets simultaneously with 10+ troops each.

---

## Multiple Villages

You start with one village. Every village you conquer becomes yours and appears in `myVillages[]` in state.

Every action tool (`build`, `train`, `attack`, `send_support`, `activate_militia`, `post_trade`, `accept_trade`) accepts an optional `villageId`. If omitted, acts on your first village. **Always specify `villageId` when you have more than one.**

### What you inherit when you conquer a village

- Their resource production rate (often high if they built up their economy)
- Their troops that were home at the time
- Their stored resources (minus loot from the conquering attack)

Conquering a well-developed player village is extremely valuable — you don't start from scratch.

### Multi-village strategy

- **Specialize**: one village as troop producer, one as resource/noble hub
- **Coordinate attacks from multiple villages**: stagger waves so defenders can't recover
- **Noble trains from multiple origins**: send nobles from different villages to hit the same target in rapid succession; harder for defender to intercept all of them
- **Watch all villages**: each shows `incomingCommands` — check them every turn

### Keeping track in notes

```
My villages:
- id:3  "Home"       (248,251) — main base, troops trained here
- id:47 "Outpost"    (261,243) — conquered from Bot12, good iron production
- id:89 "North Farm" (241,260) — just conquered, upgrading economy

Next actions:
- id:3:  train 50 LC, build smith→10
- id:47: send 100 axe to NPC id:22, build farm→5
- id:89: clear build queue, start wood→3
```
