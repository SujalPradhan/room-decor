# Foundry integration for product-link reconstruction

Updated 30 October 2026 following authenticated localhost validation on 29 October. The underlying laptop-worker pipeline is validated; the new automatic paste-to-room interaction is implemented with live generation/automatic placement and cached reuse validated locally. The research history below predates token configuration.

## Implemented role

Foundry interprets photographs and measurement evidence; local TripoSR and Blender produce the GLB. The checked Foundry documentation does not describe an image-to-GLB endpoint. An LLM token does not supply a GPU worker or establish reconstruction quality.

The server-only adapter calls Foundry's Gemini REST route with `gemini-2.5-flash`, bounded product imagery, a response schema and a project tag. It selects a complete product photograph and crop, transcribes printed diagram measurements, distinguishes upright/reclined and outer/seat/part measurements, and compares these with listing facts. Local validation checks image IDs, units, dimensions and crop bounds. User-entered dimensions are retained; disagreements remain visible instead of silently becoming verified measurements.

The adapter restricts origins, rejects redirects, bounds responses and request duration, and uses fixed public error messages. Credentials are read by the local worker/analysis process; the browser, project exports and public reports do not receive them. The site needs the shared worker credential, not the Foundry key. Paid Meshy generation remains source-disabled.

## Pipeline validation history: 29 October 2026

The supplied SNUZSPACE Flipkart recliner completed the real localhost queue → worker → Foundry → TripoSR → Blender → private model flow using the earlier manual UI. This is one measured pipeline run, not validation of the new automatic paste-to-room interaction or a latency promise:

| Stage | Observed result |
| --- | --- |
| Full pipeline | 33.8345 seconds |
| Foundry `gemini-2.5-flash` | 5.4367 seconds; 1,752 input tokens; 490 output tokens; 5 images |
| TripoSR on M4 MPS | 14.459 seconds |
| Blender conversion | 0.987 seconds |
| Textured GLB | 2,944,940 bytes; 70,000 faces |

The diagram states width **32.5 inches** (82.55 cm), while the listing states **83.56 cm**. The pipeline retains this conflict. Automatic visual placement may use the listing value as an estimate without requiring a checkbox or claiming confirmed fit; neither value is independently measured. Missing product measurements remain null, with separate model placement bounds/scale provenance supplying estimated display size. Hidden geometry, appearance and orientation remain inferred. Only this recliner has been validated with live reconstruction; other furniture categories and Amazon listings are best-effort and unbenchmarked.

## Metering and operation

**Cost & time** records the returned model, actual tokens, image count and observed elapsed time alongside local reconstruction/conversion operations. Monetary Foundry cost remains **unknown** until reconciled with account usage and pricing; direct-provider prices are not substituted. The mesh has no external 3D-generation API fee. Device, electricity and hosting/storage costs are unmetered.

Pasting a complete supported product URL starts the implemented flow after 650 ms: collection → Foundry evidence → local reconstruction/conversion → automatic add or selected replacement using the actual GLB in the intended room/layout. No category, dimensions, upload, Generate click or final confirmation is required. Platform sign-in remains necessary once; the pasted link resumes after sign-in. Optional Advanced controls permit corrections. Account-scoped compatible ready models can be reused; category/size edits preserve ready geometry while identity/reference changes invalidate it. Placement is one undoable change and preserves Original. A real localhost run created and automatically placed the recliner; a cached replay passed placement, Undo and reload checks without another generation job.

Install the [Mac background generator](AUTOMATIC_GENERATOR_SERVICE.md) once for LaunchAgent startup at login and ordinary use without a terminal. The Mac must remain awake/reachable; sleep is prevented only during active jobs. The bounded **Start Roomshift Generator.command** remains an optional manual fallback. Communication is outgoing-only, with no inbound laptop port. Private jobs/assets require sign-in. Server limits remain one active job per person, three attempts per person and six globally per UTC day, with one reconstruction globally; failed/cancelled attempts count. See [the pipeline guide](AUTOMATIC_PRODUCT_PIPELINE.md).
## Research history: earlier on 29 October 2026

The original assessment occurred before credentials were configured and before model requests were made. It recommended retaining direct retailer extraction, adding Foundry vision/structured evidence, and using TripoSR/Blender for geometry. That architecture is now implemented and locally validated. The earlier claim “no credentials used and no model/inference request made” applies only to that initial research pass.

Unauthenticated GET probes were made once each to the demo host's Markdown and Proxy endpoints for the exact recliner URL. Markdown returned HTTP 200 containing `Fetch failed: HTTP 429: Too Many Requests`; Proxy returned HTTP 429. Neither supplied usable product evidence. These probes showed that the helpers did not solve this retailer's access restriction from that server; they did not establish model access. Direct bounded retrieval remains the implemented path. Image editing and alternate retrieval routes were researched but are not required by this pilot.

## Sources checked

- [Help/provider index](https://llmfoundry.straivedemo.com/help/)
- [Gemini route](https://llmfoundry.straivedemo.com/help/gemini)
- [OpenAI route](https://llmfoundry.straivedemo.com/help/openai)
- [Structured output](https://llmfoundry.straivedemo.com/help/json)
- [Image editing](https://llmfoundry.straivedemo.com/help/draw)
- [Markdown](https://llmfoundry.straivedemo.com/help/markdown)
- [Proxy](https://llmfoundry.straivedemo.com/help/proxy)
- [Production/project tokens](https://llmfoundry.straivedemo.com/help/production)
- [Cost reporting](https://llmfoundry.straivedemo.com/help/cost)

Documentation was retrieved directly over HTTPS during research because the browsing index could not open this host. Documented model names alone were not treated as verified account access; the authenticated Gemini run above supplies the actual validation.
