# Flipkart recliner: local link-to-model experiment

Source: https://www.flipkart.com/snuzspace-fabric-manual-recliner/p/itmcbf4f034af5ba?pid=RECHK8KJZEVZWK37

The experiment uses accessible listing data and public local model weights. It does not enable Meshy, submit a paid job, or modify a user's room layout. It is a local feasibility experiment, not a publicly hosted generation backend.

## Extracted evidence

The page identifies SNUZSPACE Fabric Manual Recliner, Brown, model ReclinerM-Pinnacle-B, product RECHK8KJZEVZWK37. Its Dimensions section lists width 83.56 cm, depth 82.55 cm and height 109 cm. Five distinct original gallery images are available; the OG thumbnail repeats the first image. The gallery includes lifestyle, diagram, collage and detail imagery, not five aligned views suitable for photogrammetry.

The dimension graphic shows a 32.5-inch front width (82.55 cm), which differs from the table's 83.56 cm. Do not present table scaling as independently verified dimensions. The listing's seated footprint also does not establish fully reclined clearance. This discrepancy was observed visually; the current parser does not perform automatic diagram OCR/reconciliation.

Parser repairs raise the bounded page cap from 1.5 to 3 MB; distinguish real challenges from script configuration such as isReCaptchaEnabled; read the selected product's specification state without evaluating JavaScript; keep only exact outer Width/Depth/Height fields from Dimensions; identify recliners as the chair placement category; and deduplicate gallery/thumbnail references. Unknown or ambiguous dimensions remain reviewable.

## Isolated setup

Use Node 24, uv, and an installed Blender. Python 3.11 with lzma support is required. Dependencies and cloned model source stay ignored in .local-3d; no changes to system Python are necessary.

```sh
uv python install 3.11
uv venv --managed-python --python 3.11 .local-3d/runtime
uv pip install --python .local-3d/runtime/bin/python -r scripts/experiments/requirements-triposr-lock.txt
git clone https://github.com/VAST-AI-Research/TripoSR.git .local-3d/TripoSR
git -C .local-3d/TripoSR checkout 107cefdc244c39106fa830359024f6a2f1c78871
```

The exact source commit used by each run is recorded in generation-report.json. The public weights download is about 1.68 GB, plus small configuration and segmentation resources. First-run downloads are separate from warm inference performance. The runner disables implicit Hugging Face credentials; a previously cached expired token initially caused a 401, and anonymous retrieval resolved it. No new token was needed.

```sh
node scripts/experiments/product-to-model.mjs \
  'https://www.flipkart.com/snuzspace-fabric-manual-recliner/p/itmcbf4f034af5ba?pid=RECHK8KJZEVZWK37' \
  experiments/snuzspace-recliner/output
```

The orchestration script launches the TypeScript extraction subprocess with Node's experimental type transformer. The first gallery image is selected for this experiment; robust automatic image ranking across arbitrary retailers is not implemented. U2NetP isolates its foreground, TripoSR infers a colored mesh, and CPU scikit-image marching cubes replaces the CUDA-specific extraction extension. The target backend is M4 Metal (PyTorch MPS), with CPU available as an explicit fallback.

Blender converts the inferred vertex colors to an embedded 1024px texture, estimates chair orientation from back/seat geometry, grounds the asset and applies listing dimensions. The output geometry comes from reconstruction, not a hand-authored catalog replacement. Inspect orientation, texture and proportions before using it. Hidden surfaces are inferred; a mesh passing validation is not a guarantee of visual or dimensional accuracy.

Intermediate images, meshes and reports are kept in the output directory. Source-page HTML and downloaded photos are local-only, ignored artifacts. Stage reports distinguish extraction, preparation, inference, mesh extraction and conversion. Local generation has no provider inference charge; laptop resource costs are not metered.

## Verification

Unit regressions cover this reduced real listing fixture, normal reCAPTCHA flags, body limits, product identity, exact outer axes, seat/shipping rejection and malformed script safety. Build and browser checks are recorded with the result after the run completes.

The generated GLB can be checked in the actual editor with:

```sh
ROOMSHIFT_BASE_URL=http://127.0.0.1:5176 \
  node scripts/experiments/verify-recliner-ui.mjs \
  experiments/snuzspace-recliner/output/snuzspace-recliner-experimental.glb
```

Status: a single-command real URL → five images + dimensions → foreground isolation → TripoSR mesh → textured metric GLB completed on this Mac with no API key. Cached runs took approximately 21–23 seconds including the preview render. The final run took 23.13 seconds; inference itself was 2.43 seconds and mesh extraction 7.58 seconds. The first 1.68 GB weights download took about eight minutes. Final export is approximately 2.94 MB, 70,000 faces and one embedded 1024px texture. Structural GLB validation and actual editor import/confirm/undo pass.

Quality is recognisable but visibly softer than the source, with imperfect cup holders, seams, underside/mechanism and hidden surfaces. Axis-wise scaling changes proportions substantially (roughly 1.47 ratio between the largest and smallest scaling factors); this warning is recorded, rather than treating dimensional bounds as exact reconstruction. This proves local feasibility for this product, not broad retailer/model quality. The public site gets extraction and metering-contract fixes; local reconstruction is not exposed as a hosted generation service. No paid generation enabled.

See `experiments/snuzspace-recliner/result.json` for measured stages and validation. The generated model and preview are local artifacts under `experiments/snuzspace-recliner/final/output/`. A future Meshy/other paid-provider comparison would require that provider's key and separate authorization; it is not necessary for this demonstrated local path.

The browser exercise also exposed and fixed an API/client contract mismatch: local processing events carried a currencyless zero that the client rejected. New events omit the monetary amount, and existing local/no-charge records are normalized without fabricating a currency. A regression checks the actual server response against client validators. Preview-card contrast was corrected after checking the generated model in the dark editor.
