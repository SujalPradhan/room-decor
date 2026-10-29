# Automatic product URL to room-ready model

User clarification, 29 October 2026: the normal input is only a product link. The pipeline should extract listing images and outer dimensions, create a model, and offer it in the room. Manual input is recovery, not the main product. This supersedes the review-first interaction in PRODUCT_LINK_PLAN.md. Paid generation remains disabled under the user's existing instruction.

## Desired experience

Paste an Amazon India or Flipkart link and select Create model. Show one task with Reading listing → Preparing images → Creating model → Checking scale → Ready to try. Use real stage transitions, not invented percentages. Let the room remain usable. Offer the finished object with Before/After and one undoable confirmation; never silently replace room furniture. My products retains the output, source, selected variant, extracted evidence, and processing history.

When the selected variant and assembled dimensions are unambiguous, do not require users to retype or check every field before processing. Ask only for missing dimensions, an ambiguous variant/axis, an unreadable page, or unsuitable images. Generation with incomplete measurements can produce an explicitly unscaled draft, but cannot claim verified fit. Users may correct any extracted field or orientation.

## Implementation gap in version 4

- Existing extraction reads a bounded HTML page, JSON-LD/OG images and supported dimension fields. It is best-effort metadata extraction, not complete retailer gallery ingestion or dynamic-page coverage.
- Listing images are currently remote references, not prepared private inference inputs.
- startGeneration currently accepts uploaded images only. Merely flipping the paid switch does not enable listing-to-model.
- The provider adapter and reservations are mock-tested. Live output, texture quality, processing time and billing have not been validated.
- Normal UI currently requires all three dimensions to be confirmed before preview/generation. That is fallback-centric, rather than the desired automatic path.

## Pipeline work

1. Resolve product/share URL and variant. Retain canonical source and evidence. Use bounded accessible page extraction, retailer gallery/specification adapters and structured data. Preserve restrictions on redirect hosts and private network access. Return a recoverable result for blocks; do not claim all links are readable.
2. Collect and rank product images from that same variant. Prefer isolated views; reject room collages, swatches, thumbnails and dimension diagrams as geometry inputs. Download bounded images server-side, validate decoded type/dimensions, deduplicate, and retain source attribution and image hashes. An upload-only restriction must not be mistaken for a requirement of image-to-3D modeling.
3. Reconcile measurements across specification tables and dimension diagrams. Normalize units and width/depth/height. Keep external assembled dimensions separate from shipping and mattress dimensions. Record source, confidence and disagreements. A diagram reader, if added, needs its own verified local/provider route and metering; regex parsing alone cannot read diagram pixels.
4. Prefer a supplied matching 3D asset if present. Otherwise submit prepared reference imagery to the selected model backend. Use multiple views only when supported and from the same product/variant. Cache by source, variant, image hashes, model/version and preparation settings, scoped to the account. Prevent duplicate submissions/retries.
5. Validate the output GLB, textures, bounds and mesh size. Correct up/front axes and pivot, ground it and align to measured dimensions. Flag substantial axis-wise stretching rather than hide a wrong shape through forced scaling. Label inferred hidden geometry as approximate.
6. Store the model, provenance and task status; surface Ready to try. Record extraction, preparation, inference, conversion and transfer times and actual/estimated costs separately. Model creation does not mutate layouts.

## No-paid generation evaluation

This laptop has 16 GiB unified memory. Official TRELLIS.2 currently documents Linux, CUDA and an NVIDIA GPU with at least 24 GB memory: https://github.com/microsoft/TRELLIS.2#-installation . Do not treat it as a supported local Mac backend.

TripoSR is a candidate for a smaller local feasibility experiment, not a selected production engine. Its official README documents about 6 GB VRAM for default single-image inference, texture baking, and platform-specific PyTorch installation: https://github.com/VAST-AI-Research/TripoSR#manual-inference . Those statements do not establish M4/Metal compatibility or acceptable furniture reconstruction quality. Benchmark actual inference and GLB conversion on this Mac before integrating or promising speed/quality. No large model installation, inference benchmark, or free-hosted-service capacity has been validated in this clarification pass.

A public, always-available generator needs a reachable inference worker. A laptop-local engine requires the laptop to remain running and is not automatically a public service. Keep that deployment distinction explicit. Paid cloud inference remains off; do not assume that an open-source model implies free hosted GPU capacity.

## Acceptance criteria

- Demonstrate actual link-only runs for a desk, wardrobe and chair from accessible supported listings. Archive the extracted inputs and output for visual comparison.
- Typical successful runs require no photo upload or manual dimension entry. Missing/ambiguous data triggers a narrow recovery question and preserves completed work.
- The output resembles the linked item, loads as a textured GLB, has reviewed metric bounds and renders in the room. A stock category model does not count as generated output.
- Correct variant and geometry consistency are evaluated; a photo does not guarantee unseen geometry is correct.
- Task persistence, idempotency, account isolation, cancellations/retries and cost/time accounting are tested through the actual UI/backend.
- Stable editor behavior, Original preservation and one-step undo remain intact.

Status: the hosted automatic pipeline remains incomplete. A separate local, single-command URL-to-GLB prototype has now been demonstrated on the supplied Flipkart recliner using TripoSR on M4 Metal without an API key. See RECLINER_EXPERIMENT.md for timings, quality limitations and reproducible setup. Paid generation stays disabled.
