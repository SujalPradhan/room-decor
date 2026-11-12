# Automatic product URL to room-ready model

Updated 30 October 2026. The automatic paste-to-room interaction is implemented. The supplied recliner completed generation and automatic placement in a real localhost run; reusing its private cached model completed paste-to-room in 2.43 seconds with zero new generation jobs, followed by Undo/reload validation. The underlying laptop-worker pipeline completed the earlier real localhost run documented below. This supersedes the review-first interaction in the original [product-link proposal](PRODUCT_LINK_PLAN.md).

## Product experience

Paste a complete supported Amazon India or Flipkart product URL. After it remains stable for 650 ms, processing starts automatically: reading → analyzing → preparing → reconstructing → converting → ready → placed. No category selection, dimension checkbox, image upload, Generate click or final placement confirmation is required. The room remains usable while work runs. Platform sign-in is required once for private jobs/assets; the pasted URL and intended action resume after sign-in.

The actual generated GLB is automatically added to the intended room/layout or replaces the selected piece. Placement is one undoable change and preserves Original by creating an alternative when needed. A persisted account-scoped intent ties completion to the intended room, layout and target; cancellation and stale identity/revision checks prevent an obsolete result from replacing a different product. Completed/consumed intents must not re-add a piece after Undo or reload.

**My products** retains source, evidence, progress, model and processing history. Compatible ready output from the signed-in account's library is reused before new work is queued. Optional **Advanced** controls allow corrections, manual specifications, uploads or GLB import. Category/size edits can reuse ready geometry; source, variant and reference changes invalidate it. An unreadable listing or unusable image can still fail clearly; no universal retailer-success claim is made.

Unknown `ProductMeasurement.metres` values remain null and confirmations are never fabricated. Separate `model.placementDimensions` and `model.scaleSource` provide an estimated display scale when measurements are missing. Listing dimensions and conflicting/unconfirmed evidence may drive an approximate visual placement, marked estimated. This does not establish real-world size or purchase fit.
## Implemented pipeline

1. Validate a supported HTTPS product/share URL and read bounded retailer HTML/structured product state, retaining source and variant evidence. Flipkart gallery/specification extraction is demonstrated for the supplied recliner. Retailer access remains best-effort; blocked pages return recoverable errors.
2. Download bounded images and review them through Foundry `gemini-2.5-flash` when configured. Select a complete product photo/crop and independently transcribe printed diagram measurements. Validate the structured response locally. Separate outer dimensions from seat, part, reclined and reference measurements. Retain user sizes and flag discrepancies.
3. Prepare the foreground locally and reconstruct geometry/texture with TripoSR on the Mac's MPS device. Convert with Blender, orient/ground the mesh, scale to available evidence or a separately recorded estimated display size, and package a self-contained textured GLB. Missing product measurements remain null. Scaling does not establish geometric accuracy or verified fit.
4. Validate the GLB and register it in owner-scoped private storage. The signed-in client retrieves the actual asset into local model storage, then fulfills the pending add/replacement intent. Placement requires a ready model and matching revision; unavailable geometry is not accepted as a stock-category substitute. Identity/job checks reject stale results, while later category/size edits preserve the ready asset.
5. Record actual Foundry tokens/images and observed times alongside local reconstruction, conversion, transfer and validation in **Cost & time**. Foundry currency cost remains unknown pending account reconciliation. There is no paid external 3D-generation request; Meshy remains source-disabled.

The worker polls by outgoing requests using a shared server-only worker credential and per-job leases. Foundry credentials remain on the Mac. The public site needs only the shared worker credential for this pipeline alongside its private job/asset storage. No incoming laptop port is opened.

## Start and limits

Install the Mac background generator once using [AUTOMATIC_GENERATOR_SERVICE.md](AUTOMATIC_GENERATOR_SERVICE.md). The LaunchAgent runs the outgoing-only worker at login, so ordinary use does not require a terminal or manual worker start. The configured Mac must remain awake/reachable; active jobs prevent sleep, but idle time does not. Local inference dependencies and Blender must already be installed; see [local setup](RECLINER_EXPERIMENT.md). This remains a laptop-backed pilot, not an always-on hosted GPU service.

**Start Roomshift Generator.command** remains an optional manual fallback. It opens [the public studio](https://roomshift-studio.dearmacaw4.chatgpt.site) and runs a bounded worker:

```sh
node --env-file=../.env scripts/local-pipeline-worker.mjs --max-jobs 3 --idle-seconds 3600
```

That manual launch stops after three claimed jobs or one idle hour; Ctrl+C stops it earlier. Creation is unavailable when no worker is online.
Server limits allow one active job per signed-in person, three attempts per person and six globally per UTC day, with one running reconstruction globally. Failed and cancelled attempts count. Idempotency prevents repeat submission of the same request; failed/expired jobs are not automatically regenerated. Owners can cancel their queued/running jobs. Lease, cancellation and revision checks reject stale completion; completed usage is retained where available. The public editor remains usable for device-local editing without sign-in.

## Pipeline validation history: 29 October 2026

The supplied SNUZSPACE Flipkart recliner completed the localhost queue, worker, live Foundry review, local reconstruction, conversion and private result flow using the earlier manual UI. This validates the underlying pipeline, not the new automatic paste-to-room interaction; a real end-to-end run of that interaction is pending:

| Measurement | Observed value |
| --- | --- |
| Full pipeline | 33.8345 seconds |
| Foundry review | 5.4367 seconds; `gemini-2.5-flash`; 1,752 input / 490 output tokens; 5 images |
| TripoSR MPS | 14.459 seconds |
| Blender conversion | 0.987 seconds |
| GLB output | 2,944,940 bytes; 70,000 faces |

The diagram width **32.5 in / 82.55 cm** conflicts with the listing's **83.56 cm**. Review flags are retained. These timings describe one run, not a service-level promise or independently measured fit. Only the recliner is live-validated; Amazon and other categories are best-effort and unbenchmarked. Hidden surfaces, upholstery, orientation and shape may differ from the product. Use manufacturer dimensions and visual inspection before purchasing.

## Remaining validation and future work

- Complete real paste-to-room validation, including automatic sign-in resume, placement/Undo, cached reuse and stale-target protection.
- Benchmark link-only output for desks, wardrobes and other chairs, including accessible Amazon listings and variants. Compare evidence and output visually.
- Assess shape, texture and orientation beyond this recliner, especially large/flat furniture and incomplete imagery.
- Reconcile monetary Foundry usage; keep unknown amounts explicit until pricing/account evidence is available.
- Evaluate an always-on worker separately for continuous public availability. Open-source weights do not supply free hosted GPU capacity.

## Research history: earlier on 29 October 2026

Version 4 did not connect listing images to public background inference: it had metadata extraction, manual review and a mock-tested paid provider adapter. The early plan identified this gap and proposed image preparation, diagram interpretation, durable jobs and metering. Those pilot connections are now implemented. Earlier claims that no model installation or inference benchmark had been validated applied only to that research pass.

Engine research rejected TRELLIS.2 as a supported backend for this Mac: its official [installation requirements](https://github.com/microsoft/TRELLIS.2#-installation) describe Linux, CUDA and an NVIDIA GPU with at least 24 GB memory. TripoSR was initially a feasibility candidate; actual M4/MPS inference and textured GLB conversion have since been demonstrated. The [TripoSR documentation](https://github.com/VAST-AI-Research/TripoSR#manual-inference) supplies dependency/setup context; this project's measured reports establish the specific Mac result. The initial no-key experiment is retained in [RECLINER_EXPERIMENT.md](RECLINER_EXPERIMENT.md); Foundry evidence review was added afterward with the user's configured credentials.
