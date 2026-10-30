# Natural-language room rearrangement demo

Proposal based on the 30 October 2026 discussion. This is a plan, not an implemented feature. Finish the automatic product-link release first; then prioritize a narrated rearrangement demo using existing room assets.

## Audience experience

Type “My room feels cluttered. Give me more space around the desk.” The agent interprets the goal, chooses a valid arrangement of existing objects, and returns a playable explanation. The bed/fan/table move smoothly one step at a time while captions explain the reason. Show a highlighted target area and calculated before/after measurements. Play/pause, next/back, replay and playback speed allow the presenter to talk through the result. Applying the complete arrangement is one undoable change; Original remains available.

Pre-create three rehearsed examples regardless of live support: clearer desk access, a clearer entrance path, and a sleep/work arrangement. Prepared suggestions are labeled as such. Keep one recorded walkthrough as presentation backup. The live test must also use an unrehearsed prompt.

## Implementation

1. Snapshot the actual layout: stable item IDs, dimensions, positions, rotations, locks, room boundary, door swing and clearance rules. Use existing assets; do not generate meshes in the live prompt path.
2. Interpret the prompt with the configured Foundry model. Request structured goals/preferences and an explanation script. Treat the response as a proposal, validate its schema, IDs, allowed operations and numeric ranges, then evaluate candidate layouts with deterministic placement checks. Never accept the LLM's own numeric improvement claims as measurements.
3. Build a timeline containing each object's source/target transform, duration, camera framing, explanation and calculated metric changes. Reject conflicting moves or select a valid prepared alternative. Use captions first; browser speech synthesis is an optional narration layer, not a required paid voice service.
4. Interpolate transforms and camera smoothly in the existing Three.js renderer. Use a playback overlay rather than overwriting saved layout state at every animation frame. Pause/resume/replay remain deterministic; cancel restores the starting view/layout, and Apply commits the full arrangement once.
5. Record prompt-to-playable latency, provider/model/tokens, validation failures and fallback selection in Cost & time. Test multiple unfamiliar prompts and repeated playback/undo/reload.

## Measurements and latency

The meeting's “50% of the area cleared” is an example, not a fact to display automatically. Moving unchanged furniture usually does not change its total occupied footprint. Define a specific target zone, such as desk access, and calculate its obstruction/free-area ratio or an entrance clearance improvement from actual geometry. Label room dimensions and any sampled area calculation as estimates. Never invent a room-wide percentage or a machine-throughput gain.

Target prompt-to-playable plan: 5–15 seconds on ordinary successful runs, with a hard 60-second ceiling. These are engineering targets, not benchmark results. Plan-generation time and playback time are separate. Bound LLM calls, validate promptly, and offer a labeled prepared plan if live planning is slow or unavailable. Preload assets and keep fresh image-to-3D generation outside this time budget.

## Proposed first pass

Estimate: two focused development days, to be revised after the first measured spike.

- First deliverable: a prompt selects a valid layout and produces a structured, measured explanation using the existing scene.
- Second deliverable: smooth step playback, explanations, zone overlays, replay/cancel and one-step undo; three prepared examples.
- Demo gate: run unfamiliar prompts live, measure planning latency, verify collision/lock/boundary handling, and capture a backup recording. The live path must produce a playable script within 60 seconds on the demo machine/network.

Keep Blender for asset creation and Three.js for the interactive web demo. An Unreal migration is a separate visual-quality decision; it is not required for the planning, timing or explanation feature.

## Separate sports exploration

Test one or two full-body player assets before producing a dozen. Inspect approximate likeness, jersey/texture, separated limbs, mesh size and loading speed. Begin with rigid models gliding through one scripted play; walking/rigging is not necessary for this first engagement test. Add a timeline and explanations using the same playback concept. Only expand the batch after the sample is usable.

Official Meshy API pricing checked 30 October 2026: Meshy 7.1/6 with 2K textures is 30 credits per image-to-3D request, so twelve first attempts are 360 credits. Optional rigging adds 5 credits each, totaling 420. A second generation attempt for each player raises those totals to 720/780. API retries must not be assumed free; the advertised free retries apply to the web app. Confirm the account's paid API access, balance and checkout currency/promotion before purchase. No subscription or paid generation is authorized by this plan alone.

Meshy documents median 2K-textured image-to-3D times of two minutes for 7.1 and three minutes for 6, making pre-generated/cached assets the appropriate choice for a sub-minute live demo.

## Industrial-design direction

Treat this as later client discovery, not a claim that a room editor optimizes real machinery. Identify one machine and an engineering objective; obtain CAD/assembly data and operating constraints, establish a measured baseline, then choose a suitable CAD/simulation tool. FreeCAD can support geometry/assembly work; a defensible throughput or mechanical-performance claim needs an appropriate engineering model/solver and validation.

## Sources

- Meshy plans and regional checkout: https://www.meshy.ai/pricing
- API task credits: https://docs.meshy.ai/en/api/pricing
- Processing-time medians: https://docs.meshy.ai/en/api/task-lifecycle#processing-times
- API access requirements: https://docs.meshy.ai/en/api/image-to-3d
- Account credit balance: https://docs.meshy.ai/en/api/balance
- Optional humanoid rigging: https://docs.meshy.ai/en/api/rigging
- Three.js animation: https://threejs.org/docs/pages/AnimationMixer.html
