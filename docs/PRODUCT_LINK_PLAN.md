# Product links → furniture you can try in Roomshift

Proposed plan, 28 October 2026. Awaiting user review before feature implementation. Research used three parallel audits: retailer access, model-generation providers, and reuse from RoomRemix.

## Preserve the current release

- Baseline: deployed public version 3, commit `e422ba5f5d655e6bf1d135a89d8290c2f47e1455`.
- Preserved on the repository's default branch, `main`, in merged PR #7: https://github.com/SujalPradhan/room-decor/pull/7 .
- Named rollback tag: `roomshift-stable-2026-10-28`. Keep the tag at this exact source commit; do not move it as features advance.
- Build subsequent work on a new feature branch. This plan does not change the live editor.
- Before merge, GitHub CI passed the build, 34 unique unit tests and all 21 browser workflows across three isolated cloud jobs: https://github.com/SujalPradhan/room-decor/actions/runs/40735052166 . Cloud functional checks use the full CSS viewport with a reduced internal rendering scale and software-rendering time budgets; native M4/full-resolution visual validation remains separately recorded.
- The merged application source and assets match the rollback snapshot; follow-up validation changes are confined to CI and test configuration.

## Recommended experience

Add a **Product link** tab inside the existing Add furniture / Try a replacement workflow. Retain the present styling, 3D workspace, measurement inputs, Before/After comparison and single-step confirmation/undo.

1. **Paste a link.** Accept supported Amazon India and Flipkart product/share links. Show a compact Reading product state; retain the submitted link on errors.
2. **Check the product.** Present one card containing the product photo, title, chosen size/color variant, source link and W × D × H in centimetres. Each dimension is sourced or marked Needs confirmation. Let the user choose another image, crop a staged image, correct the orientation, and edit dimensions. Missing fields remain blank; shipping-box and mattress sizes are not silently treated as assembled furniture dimensions.
3. **Try the size immediately.** Once dimensions are reviewed, show a category-appropriate simple model or clearly labeled size box. Display fit conflicts and compare against the existing item. This useful path remains available if detailed generation fails.
4. **Create a detailed model.** An explicit action shows the selected image(s), expected wait and any applicable credit allowance before submitting a generation. Prefer an authorized seller-supplied GLB if available. Otherwise create a textured model from suitable product imagery. Keep the room usable while processing; show compact Queued / Generating / Preparing / Ready / Could not finish states. Avoid fake percentages or a guaranteed countdown.
5. **Review, then use.** Show the generated model with rotate/front correction, confirmed dimensions and an AI-generated appearance label. Reuse Before/After and **Use this piece**. Completing a job never silently replaces the selected object, updates every layout or changes Original.
6. **Keep it for later.** Save the product and its source in a small My products collection. A returning job offers Model ready — review it. A saved simple preview is upgraded only after explicit review and one undoable confirmation.

Recovery copy should be useful: **We couldn't read this page. Paste its specifications or add a product photo to continue.** Preserve any successfully extracted information. Avoid technical provider errors, API setup instructions or retailer internals in the main flow.

## What to reuse

| Source | Decision |
|---|---|
| Roomshift replacement, history, dimensions, renderer and GLB validation | Keep. These are the integration foundation. |
| RoomRemix product link/text/photo intake | Rebuild the experience in Roomshift's design, using its concept rather than copying the component. |
| RoomRemix image-to-GLB provider adapters and job states | Reuse the separation of responsibilities, with a new persistent, owner-isolated backend. |
| RoomRemix wall-aware replacement | Adapt next: preserve the back/adjacent wall when resizing a replacement, with explicit placement preview. |
| RoomRemix suggested placements and tray | Follow-up after product import and generation are sound. A lightweight My products collection is sufficient for the first release. |
| Partial painting and room-scan pipelines | Later scope; do not bundle into the product-link release. |

Do not port the shared `my-room` backend, globally visible job feed, per-keystroke numeric updates, automatic generation on product import, or the callback that patches matching objects in every layout.

## Retailer access and product evidence

Amazon's current official integration is Creators API, with Associates eligibility and credentials; Flipkart documents an affiliate product API requiring credentials. A product URL does not imply that either API is available to this account, that a page is fetchable, or that all furniture specifications are present.

- Implement separate retailer adapters and tested canonical/share-link handling, preserving the selected variant.
- Use configured, permitted access where available. Bounded parsing of accessible structured metadata is a separate, best-effort path; do not bypass retailer blocks.
- Always retain a manual specifications + suitable photo path. Link-only automation is conditional, not a universal promise.
- Track dimension evidence per axis and distinguish listing values, user edits and unknown values. Require assembled external dimensions for dependable fit checks. Do not convert an LLM guess into a verified product fact.
- Amazon and Flipkart affiliate content licenses restrict modification and reuse. API credentials alone do not establish authorization for image-to-3D derivatives. Resolve the image source used for generation: brand-authorized content, user-owned photos, or separately licensed imagery. Do not treat a generic upload checkbox as permission to disregard a source license.

Sources: [Amazon Creators API](https://affiliate-program.amazon.in/creatorsapi/docs/en-us/introduction), [Amazon PA-API deprecation](https://affiliate-program.amazon.in/creatorsapi/docs/en-us/paapiv5-deprecation), [Amazon content agreement](https://affiliate-program.amazon.in/help/operating/agreement), [Flipkart product APIs](https://affiliate.flipkart.com/api-docs/af_prod_ref.html), [Flipkart terms](https://affiliate.flipkart.com/terms-and-conditions).

## Model generation recommendation

Use **Meshy as the first production API candidate**, behind a provider-neutral adapter. Compare its furniture output with **Tripo v3** in a small authorized-image evaluation before committing to a provider. This is an integration recommendation, not a measured model-quality ranking. Pin supported provider/model versions.

A free shared TRELLIS demo may be useful for experiments, but quotas and availability make it unsuitable as the sole generation route for a public service. Upstream TRELLIS.2 requires Linux/CUDA and at least 24 GB NVIDIA GPU memory, so it is not the supported inference path for this 16 GB M4 laptop.

Generation must preserve the selected product as closely as possible. Default preprocessing is crop/background removal, not inventing a new camera view or changing upholstery, handles and unseen surfaces. A single image cannot establish exact hidden geometry. Fit uses reviewed dimensions, independently of the generated surface detail.

Meshy is asynchronous and returns textured GLB. Its output links expire, so download and retain validated results in our own asset storage. Do not promise that closing the preview cancels an already-running provider task or reverses its charge. Provider credentials and a generation budget/allowance must be settled before paid public generation is enabled; none are created or spent during planning.

Sources: [Meshy image-to-3D](https://docs.meshy.ai/en/api/image-to-3d), [task lifecycle](https://docs.meshy.ai/en/api/task-lifecycle), [asset retention](https://docs.meshy.ai/en/api/asset-retention), [Tripo v3](https://developers.tripo3d.ai/en/docs/generation-image-to-model/standard), [TRELLIS.2 requirements](https://github.com/microsoft/TRELLIS.2), [HF shared GPU limits](https://huggingface.co/docs/hub/spaces-zerogpu).

## Implementation shape

Keep the editor public and usable without generation. Add same-origin server routes through a small Worker-compatible backend; preserve the existing Vite editor rather than rewriting the frontend. Use structured storage for products/jobs and object storage for source images and validated GLBs. The hosted HTTP backend orchestrates an external provider; it does not run Blender or CUDA inside a request.

- `ProductDraft`: source URL/retailer/product ID, selected variant, image references, category, reviewed dimensions with per-axis evidence, revision and model status.
- Retailer adapter: normalize link → retrieve permitted evidence → validate fields → return draft or recoverable incomplete result.
- Generation adapter: create job → retrieve status → download/validate result; model/provider-specific cancellation capability.
- Jobs bind owner, draft ID/revision, image and reviewed specifications. Reject stale results. Keep credentials server-side and limit concurrency, retries and spending. Prevent duplicate charged tasks when a request is retried.
- Keep generation and product assets isolated per signed-in user; ordinary public room editing stays available anonymously. No upload of the user's whole room is needed to generate one product model.
- Validate source/redirect hosts, timeouts and byte limits; do not build an arbitrary URL proxy. Validate GLB structure, embedded resources, geometry/texture budgets, finite bounds and floor pivot through the existing import pipeline. Target the current 30 MB asset limit.
- Store model binaries durably and cache them through the existing browser-local asset mechanism. Add backward-compatible product metadata validation; keep existing project JSON imports working. Preserve assets needed by undo.

The exact Worker/structured/object-storage bindings and sign-in flow should be verified in the implementation spike before committing the backend architecture. The Sites runtime supports server-side identity, D1-style structured storage and R2-style file storage; secret values never enter client bundles.

## Delivery sequence and review points

0. **Metering first:** establish the durable operation/attempt ledger, pricing provenance, timing capture, usage limits and Cost & time tab before the first paid extraction, image edit or generation pilot. Local UI work can proceed alongside this; no paid job starts without accounting instrumentation.
1. **UX and product draft:** product tab, review card, manual recovery, validated dimensions/provenance, immediate size preview, existing replacement flow. Demonstrate without paid generation.
2. **Retailer adapters:** tested Amazon/Flipkart URL and variant handling; configured access; real example links; graceful blocked/missing-data behavior.
3. **Generation proof:** compare a small set of permitted product photos across desks, wardrobes, chairs and beds; inspect resemblance, orientation, thin legs, hidden surfaces, texture quality, file size and fit scaling. Pick the adapter based on results and cost.
4. **Public generation:** persistent owner-isolated jobs, bounded usage, resumable progress, retained assets and explicit review before placement. Exercise a real successful job and failures before calling the detailed-model feature complete.
5. **Release validation:** retain the current editor regressions and add end-to-end tests below. Deliver on a separate branch/PR; stable tag remains unchanged.

Do not call the whole link-to-detailed-model feature complete after shipping only the simple size preview. Phases 1–2 are useful intermediate milestones; phases 3–4 complete the requested generation workflow.

## Acceptance checks

- Amazon and Flipkart canonical/share links, selected size/color variants, unavailable products, malformed links, blocked pages and missing credentials/quota.
- Mixed cm/inches/feet, missing or conflicting measurements, package-vs-assembled dimensions, and `150.25` entered sequentially without rounding or extra undo steps.
- Product photo/spec review, fallback completion, immediate preview, collision warnings, no saved change before confirmation, Original preserved, one-step confirm/undo.
- Successful generated GLB, malformed/oversized output, provider failure, slow/expired jobs, reload/reconnect, duplicate submissions and stale image/variant revisions.
- Result arrives after selecting/deleting/replacing another item; it stays in the collection until reviewed, and never mutates other layouts.
- Two users cannot read or replace each other's products, jobs or private assets. Provider keys remain server-side; public generation is bounded by the chosen usage allowance.
- Laptop keyboard/accessibility and smaller-screen panels; room editing remains responsive during generation/download. No regressions in existing projects/import/export/deletion/history.

## Remaining decisions before a generation pilot

Actual retailer API eligibility/access; allowed image sources; the selected provider's credentials and capped pilot budget. These affect automation and paid generation, not the usefulness of the editable product-review/size-preview path. No new implementation or paid generation is authorized by this document alone; await the user's review of the plan.


## Cost & time tab (proposed)

This is part of the planned release, with instrumentation required before the first paid pilot. Add **Cost & time** as a room-level tab in the existing visual style. Keep the main editing workspace focused on arranging furniture; show a compact allowance/estimate beside a paid action and link its completed result to the matching activity record. The tab answers what ran, which models were used, how long each stage took, and what is known about its charge. It reports processing/provider costs and usage; it does not add customer payments, a billing checkout, or a subscription purchase flow.

### Friendly overview and drilldowns

| View | Content |
|---|---|
| Overview / Rooms | Selected room, date range, recorded charges and estimated charges shown separately, credits reserved/consumed, running operations, processing-time summary and a coverage note for missing records. Compare rooms only within the signed-in user's scope. |
| Images | Uploaded or generated image thumbnails, role (room evidence/product input/cleanup/output), operations that used or produced each image, model/provider, image settings, timing and attributed cost. A reused image links to its existing processing history. |
| Components | Each piece's source product, reviewed dimensions, current 3D asset, generation attempts and subsequent processing. Expand a piece to see its input images and model versions. A component that used a shared room-analysis result links to that one shared operation. |
| Activity | A chronological, filterable operation list: product reading, room analysis, crop/background removal, image editing, 3D generation, texturing/conversion, upload/download, local import and rendering when measured. Expand to see stages, attempts, provider task ID, outcome, usage, charge basis and reconciliation. |

Distinguish **AI model** (the inference engine and version) from **3D asset** (the resulting furniture geometry). Show readable task names first, with technical identifiers in expanded details. Include queued, running, succeeded, failed, cancelled, timed-out and billing-unknown states. A failed generation still appears in history and can retain a charge or refund record.

### What a cost number means

- **Estimated:** calculated from a saved rate snapshot and known/requested settings or reported usage. An estimate is never labeled the final bill.
- **Provider-reported:** a task or usage response reports tokens, credits or a charge. Reported token consumption alone does not establish a final currency charge.
- **Reconciled:** matched to an authoritative provider usage/billing record or statement, with reconciliation time and evidence. If the account cannot expose such records, retain the estimated/reported label and show the limitation.
- **Not recorded / Unknown:** historical operations or timed-out requests lack enough evidence. These are not zero-cost rows and must not disappear from coverage summaries.
- **Local work — no external inference charge:** authored assets, client-side manipulation, import, local rendering and local reconstruction have this classification where applicable. This does not claim that electricity, hosting, storage, prior development or the user's time are free. Meter hosting/storage separately only when attributable data exists.

Keep the provider's original currency and credit units. Show API credits, token usage and currency in separate columns; provider credits are not interchangeable and are not automatically the user's app allowance. An optional INR equivalent must show the exchange-rate source, rate timestamp and conversion basis as an estimate. Preserve the original currency charge and do not imply the conversion equals an invoice, taxes or payment-card settlement.

### Provider, model and rate provenance

Every external attempt records the selected provider route, requested model, returned model/version where available, task/request ID and relevant settings such as image dimensions/quality, texture options and processing tier. List configured candidate models separately from historically verified runs: a model named in code or a fallback configuration is not evidence that it ran for a particular image, component or room. Save the pricing source URL or account contract reference, rate-version/effective date and when it was checked. A later price change must not silently reprice old runs. If requests pass through a reseller such as the other prototype's Foundry/AIPipe route, do not assume direct OpenAI list rates are that account's actual charges.

Official OpenAI documentation explains token-based pricing, and the image guide directs developers to response usage for measured consumption. Responses-based image workflows may include both a mainline model and image generation. Capture both while avoiding duplicate totals; usage does not prove every applicable cache discount. Rates depend on the selected model/settings, so no universal price per room or image is promised. [OpenAI API pricing](https://developers.openai.com/api/docs/pricing), [OpenAI image generation: cost and latency](https://developers.openai.com/api/docs/guides/image-generation#cost-and-latency).

Meshy prices API work in credits and offers a usage endpoint for finished tasks. Its current usage endpoint requires a Studio/Enterprise team key and omits several categories, including running and cancelled tasks; do not infer a complete bill from an empty/incomplete response. Its consumed-credit usage field includes refunds, so a reconciled net amount must not have the same refund deducted again. [Meshy pricing](https://docs.meshy.ai/en/api/pricing), [Meshy usage records and limits](https://docs.meshy.ai/en/api/usage).

Tripo documents reserved credits at creation, consumed credits on success and released credits for failed/cancelled tasks, plus per-task usage history. Keep reservation, consumption and release distinct; closing our preview does not prove the provider cancelled the task. Reconcile against the actual task/account result. [Tripo billing](https://developers.tripo3d.ai/en/docs/billing), [Tripo account usage](https://developers.tripo3d.ai/en/docs/account), [Tripo task lifecycle](https://developers.tripo3d.ai/en/docs/task-lifecycle).

These sources were checked during planning on 28 October 2026. Confirm the selected account's access and applicable rates during the implementation spike; no charges or timing samples are invented here.

### Engines covered by the meter

Current Roomshift editing uses authored furniture assets, browser rendering and local model import, with no hosted inference call in that workflow. The other prototype configures Gemini 2.5 Pro/Flash for room analysis, GPT-5.4-mini for product specifications, GPT Image variants for cleanup/repaint, TRELLIS variants for meshes, and Blender/COLMAP/Brush for local work. Those configured names are not evidence that all ran historically, and importing a feature does not enable every engine automatically. The new generation pilot adds the selected Meshy or Tripo adapter to the same registry. Record the actual selected/returned model and provider route per request, with Unknown where the provider does not disclose it.

For a future Gemini adapter, preserve provider-returned usage rather than estimating tokens solely from the number of images. Normalize the usage shape for the actual endpoint/model, retain a dated pricing source, and distinguish direct Google pricing from a reseller's rates. [Gemini token accounting](https://ai.google.dev/gemini-api/docs/tokens), [Gemini pricing](https://ai.google.dev/gemini-api/docs/pricing).

### Metering and timing design

Use an owner-scoped, durable operation ledger. Record an operation before making an external call; store one child attempt per real request, including provider fallbacks, retries and failures after a provider has already processed the input. Instrument the HTTP/provider boundary before the current helper discards response metadata, then instrument generation adapters and local process/import stages. A job references ledger records rather than serving as the accounting database.

Each record includes operation/parent/attempt IDs; owner/project/room/component IDs; input/output asset references; operation/status; provider/model/settings; idempotency key and provider request/task ID; queued/started/completed timestamps; usage with its evidence source; estimated/reported/reconciled cost, currency/credits and rate snapshot; adjustment/reconciliation references; cache/reuse references; and sanitized failure details. Use decimal-safe money storage. Do not expose provider keys, authentication headers, raw prompts/images, private account balances or unredacted provider errors.

Show **queue wait**, **processing**, **transfer/preparation** and **end-to-end elapsed** separately. A provider's start time and our first observation of running are different; label observed or unavailable values honestly. Use a monotonic clock for durations where possible and UTC timestamps for cross-service events. Parallel stages may overlap: the visible run elapsed time is not the sum of child-stage durations. Aggregate processing can be shown as a separately labeled sum, never as a fictitious room-wide wall-clock duration. Do not count idle editing time as processing.

The operation ledger is independent of layout undo: reverting or deleting furniture does not erase a completed processing operation or imply a provider refund.

Account exactly once for each underlying attempt. Parent operations roll up children without charging both rows again. Multi-image room analysis is one shared room operation linked to its input images/components; do not replicate its charge for every component. Cache reuse points to the original asset/run and records any genuinely new retrieval/processing separately. Duplicate webhook delivery, polling, retrying a client submission and re-opening a result must not create duplicate cost rows or provider tasks. A real retry that starts another charged request is a new attempt. Preserve charge/refund adjustments and their evidence; never assume every failure or UI cancellation is free.

Before paid submission, display the available app allowance and a configuration-based estimate or range, enforce the selected caps server-side, and reserve allowance atomically. Unknown billing outcomes remain pending reconciliation rather than automatically re-enabling unlimited retries. Account-wide provider balances stay owner-only; ordinary users see only their own room usage and app allowance, never the shared provider account balance.

### Historical coverage, privacy and export

The present RoomRemix helpers discard usage, its job history is in memory, and generated files contain only partial metadata. Existing bake timestamps, model filenames, a video's length and browser/test benchmark durations cannot establish historical processing cost or runtime. Preserve any trustworthy existing provenance with its evidence, and mark missing time/cost **Not recorded**. The current Roomshift editor makes no hosted inference calls during ordinary editing; previous development and authoring costs are outside that statement.

Require owner-scoped reads, writes, exports and private asset links. A public editor must not expose another visitor's room names, images, components, job descriptions, allowance or provider accounting metadata. Let users export filtered CSV/JSON with units, source/status labels, rate timestamps, timing basis and coverage warnings. Publish retention/export limits and explain which provider windows/account tiers constrain reconciliation. This tab reports our instrumented workflow; it cannot claim to reproduce charges from unrelated tools or another provider account without authorized records.

### Acceptance and delivery sequence

- [ ] Before any paid pilot, durable operations/attempts, usage capture, rate snapshots, owner isolation and server-side limits are in place; provider calls are disabled when accounting initialization fails.
- [ ] Overview, Images, Components and Activity drilldowns identify each input/output, actual model/provider route where available, status and charge basis without exposing secrets.
- [ ] Estimated, reported, reconciled, pending/unknown and missing-history records remain distinct in views and exports; unknown is never silently zero.
- [ ] A successful request, provider failure, malformed output, timeout, retry/fallback, refund/release, cached asset and duplicate completion notification reconcile without double counting.
- [ ] Shared room analysis appears once in room totals while linking to every relevant image/component; parent/child and repeated layout references do not multiply charges.
- [ ] Parallel stages show correct elapsed-versus-processing timing, queue delay is separate, missing provider start times are labeled, and local work is classified accurately.
- [ ] Credits and currencies stay distinct; optional INR conversion includes its source/time and remains an estimate. A pricing update does not rewrite historical rate snapshots.
- [ ] Two signed-in users cannot access each other's ledger rows or private exports; anonymous ordinary editing remains usable without paid generation.
- [ ] Refresh/reconnect/restart restores processing and accounting status; unavailable reconciliation APIs show a clear limitation rather than a fabricated final bill.

Delivery order is **ledger and limits → Cost & time UI with local/test records → instrumented provider pilot → reconciliation/export checks → public generation release**. Build product-review/size-preview UX alongside the first steps, but do not run the generation proof or enable paid public operations before metering is active. This section remains a proposed plan, not implemented functionality or authorization to spend.
