# Foundry assessment for product-link reconstruction

29 October 2026. Research only: no credentials used and no model/inference request made. Existing paid-generation controls remain disabled.

## Conclusion

A Foundry token can power the interpretation stages of the existing URL-to-model pipeline. Keep the working retailer extractor, add vision-assisted evidence extraction/image selection, and keep TripoSR/Blender for actual geometry. Foundry's checked documentation does not describe an image-to-GLB endpoint. A token alone does not supply a public GPU/3D inference worker or establish model quality.

## Documented capabilities and proposed roles

- Gemini/OpenAI routing: use an available vision-capable model to rank the actual gallery photos, identify the selected product/variant, read dimension diagrams, distinguish upright/reclined states and separate outer/seat/package measurements. This is a proposed integration; account model availability and output quality need authenticated validation.
- JSON Schema: request dimensions with units, image IDs, bounding boxes, source evidence and uncertainties in a strict schema. Validate all fields locally, retain conflicts and missing values, and do not treat structured output as proof of accuracy.
- Image editing: optional preparation if deterministic local segmentation is insufficient. Preserve product identity. Edited/generated views are inferred material, not additional measured evidence.
- Markdown/Proxy: optional retrieval aids, not guaranteed retailer access. Keep our successful direct retrieval as the first path.
- Usage reporting and project tags: identify this project in Foundry. Record the returned model, actual token usage, image count, latency and retry attempts in the existing ledger. Monetary rates must come from the account/provider route; mark estimates and reconcile against Foundry usage rather than assume direct-provider prices.

## Actual retrieval probe

Unauthenticated GET requests were made once each to the supplied demo host's Markdown and Proxy endpoints for the exact SNUZSPACE recliner URL. Markdown returned HTTP 200 containing `Fetch failed: HTTP 429: Too Many Requests`; Proxy returned HTTP 429. Neither produced usable product evidence. This does not mean model access will fail; it demonstrates that the webpage helpers do not solve this retailer's access restrictions from that server. Detect errors inside converter responses and retain the original working extractor.

## Intended architecture

URL → bounded direct extraction → Foundry vision/structured evidence → local foreground preparation → TripoSR mesh → Blender texture/orientation/scale validation → explicit room confirmation.

The public website needs a durable job and a reachable inference worker. A laptop worker can run our proven local engine while the Mac remains available; an always-on hosted worker is a separate deployment choice. A dedicated image-to-3D API is another option requiring its own credentials/authorization unless the account has a separately documented route. Foundry LLM/image access is not itself evidence of Meshy/Tripo access.

## Implementation sequence after token configuration

1. Check the token's own tenant, allowed models and authentication. Documentation examples use `llmfoundry.straive.com`, while the supplied help and our unauthenticated probes use `llmfoundry.straivedemo.com`. Keep the base URL explicit and validate the appropriate host before using the token; do not assume model names in older examples are current.
2. Add a server-only Foundry adapter. The comparison repo already contains Gemini JSON, chat JSON and image-edit wrappers; reuse the pattern, not its unverified model defaults or token fallback/billing assumptions. Use a project token for public deployment as recommended by Foundry's production guide. Never expose the token in browser assets or project exports.
3. Benchmark the existing recliner: choose the hero image, read both table and diagram dimensions and report the width discrepancy. No manual photo/specification input should be required when evidence is complete; only genuine ambiguity should prompt review.
4. Log LLM work alongside reconstruction stage reports, with usage caps before submission. Existing instruction to keep paid generation disabled is not changed by this assessment; configuring a key is separate from approving billable tests.
5. Connect the verified local pipeline to owner-scoped queued jobs. Preserve explicit preview/confirmation, one-step undo, account isolation, caching and stale-result protection. An LLM key alone does not implement this connection.

## Sources checked

- Help/provider index: https://llmfoundry.straivedemo.com/help/
- Gemini route: https://llmfoundry.straivedemo.com/help/gemini
- OpenAI route: https://llmfoundry.straivedemo.com/help/openai
- Structured output: https://llmfoundry.straivedemo.com/help/json
- Image editing: https://llmfoundry.straivedemo.com/help/draw
- Markdown: https://llmfoundry.straivedemo.com/help/markdown
- Proxy: https://llmfoundry.straivedemo.com/help/proxy
- Production/project tokens: https://llmfoundry.straivedemo.com/help/production
- Cost reporting: https://llmfoundry.straivedemo.com/help/cost

Pages were retrieved directly over HTTPS because the browsing index could not open this host. Generic provider/model claims in documentation have not been treated as verified access for this user's token.
