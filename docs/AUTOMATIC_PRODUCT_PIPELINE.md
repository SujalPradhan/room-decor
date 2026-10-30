# Automatic product URL to room-ready model

Updated 30 October 2026. The laptop-worker pilot is implemented and completed a real localhost end-to-end run on 29 October. This release connects the public studio to that configured laptop worker. This supersedes the review-first interaction in the original [product-link proposal](PRODUCT_LINK_PLAN.md).

## Product experience

Paste an Amazon India or Flipkart link and select **Create model**. Sign-in is required for a private model job. The app reads photos and dimensions, queues one task, and shows real stages: reading → analyzing → preparing → reconstructing → converting → ready. The room remains usable. Manual dimension confirmation or image upload is not required before generation when usable evidence is available.

**My products** retains the draft, source, evidence, progress and model. Review the inferred model and assembled dimensions before **Try in room**. Before/After and explicit confirmation make one undoable layout change; generation never silently inserts or replaces furniture. Missing dimensions, unreadable listings or unsuitable imagery can require manual recovery. This pilot requires width, depth and height for metric conversion; it does not complete a supposedly measured model when these are missing.

## Implemented pipeline

1. Validate a supported HTTPS product/share URL and read bounded retailer HTML/structured product state, retaining source and variant evidence. Flipkart gallery/specification extraction is demonstrated for the supplied recliner. Retailer access remains best-effort; blocked pages return recoverable errors.
2. Download bounded images and review them through Foundry `gemini-2.5-flash` when configured. Select a complete product photo/crop and independently transcribe printed diagram measurements. Validate the structured response locally. Separate outer dimensions from seat, part, reclined and reference measurements. Retain user sizes and flag discrepancies.
3. Prepare the foreground locally and reconstruct geometry/texture with TripoSR on the Mac's MPS device. Convert with Blender, orient/ground the mesh, scale to listing/review dimensions and package a self-contained textured GLB. Scaling does not establish geometric accuracy; inferred shape and distortion require visual review.
4. Validate the GLB and register it in owner-scoped private storage. The signed-in client retrieves it into local model storage for review. Product revision/job checks discard stale results after material product edits.
5. Record actual Foundry tokens/images and observed times alongside local reconstruction, conversion, transfer and validation in **Cost & time**. Foundry currency cost remains unknown pending account reconciliation. There is no paid external 3D-generation request; Meshy remains source-disabled.

The worker polls by outgoing requests using a shared server-only worker credential and per-job leases. Foundry credentials remain on the Mac. The public site needs only the shared worker credential for this pipeline alongside its private job/asset storage. No incoming laptop port is opened.

## Start and limits

Double-click **Start Roomshift Generator.command** in the configured checkout. It opens [the public studio](https://roomshift-studio.dearmacaw4.chatgpt.site) and runs:

```sh
node --env-file=../.env scripts/local-pipeline-worker.mjs --max-jobs 3 --idle-seconds 3600
```

Keep the Mac awake and its terminal open. The worker stops after three claimed jobs or one idle hour; Ctrl+C stops it earlier. Creation is unavailable when its heartbeat is offline. This is a laptop-backed pilot, not an always-on hosted GPU service. Local dependencies and Blender must already be installed; see [local setup](RECLINER_EXPERIMENT.md).

Server limits allow one active job per signed-in person, three attempts per person and six globally per UTC day, with one running reconstruction globally. Failed and cancelled attempts count. Idempotency prevents repeat submission of the same request; failed/expired jobs are not automatically regenerated. Owners can cancel their queued/running jobs. Lease, cancellation and revision checks reject stale completion; completed usage is retained where available. The public editor remains usable for device-local editing without sign-in.

## Actual validation: 29 October 2026

The supplied SNUZSPACE Flipkart recliner completed the localhost queue, worker, live Foundry review, local reconstruction, conversion and private result flow:

| Measurement | Observed value |
| --- | --- |
| Full pipeline | 33.8345 seconds |
| Foundry review | 5.4367 seconds; `gemini-2.5-flash`; 1,752 input / 490 output tokens; 5 images |
| TripoSR MPS | 14.459 seconds |
| Blender conversion | 0.987 seconds |
| GLB output | 2,944,940 bytes; 70,000 faces |

The diagram width **32.5 in / 82.55 cm** conflicts with the listing's **83.56 cm**. Review flags are retained. These timings describe one run, not a service-level promise or independently measured fit. Only the recliner is live-validated; Amazon and other categories are best-effort and unbenchmarked. Hidden surfaces, upholstery, orientation and shape may differ from the product. Use manufacturer dimensions and visual inspection before purchasing.

## Remaining validation and future work

- Benchmark link-only output for desks, wardrobes and other chairs, including accessible Amazon listings and variants. Compare evidence and output visually.
- Assess shape, texture and orientation beyond this recliner, especially large/flat furniture and incomplete imagery.
- Reconcile monetary Foundry usage; keep unknown amounts explicit until pricing/account evidence is available.
- Evaluate an always-on worker separately for continuous public availability. Open-source weights do not supply free hosted GPU capacity.

## Research history: earlier on 29 October 2026

Version 4 did not connect listing images to public background inference: it had metadata extraction, manual review and a mock-tested paid provider adapter. The early plan identified this gap and proposed image preparation, diagram interpretation, durable jobs and metering. Those pilot connections are now implemented. Earlier claims that no model installation or inference benchmark had been validated applied only to that research pass.

Engine research rejected TRELLIS.2 as a supported backend for this Mac: its official [installation requirements](https://github.com/microsoft/TRELLIS.2#-installation) describe Linux, CUDA and an NVIDIA GPU with at least 24 GB memory. TripoSR was initially a feasibility candidate; actual M4/MPS inference and textured GLB conversion have since been demonstrated. The [TripoSR documentation](https://github.com/VAST-AI-Research/TripoSR#manual-inference) supplies dependency/setup context; this project's measured reports establish the specific Mac result. The initial no-key experiment is retained in [RECLINER_EXPERIMENT.md](RECLINER_EXPERIMENT.md); Foundry evidence review was added afterward with the user's configured credentials.
