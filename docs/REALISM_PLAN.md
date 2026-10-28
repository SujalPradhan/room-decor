# Laptop realism iteration

28 October 2026. Work continues on `realism-laptop`, preserving the tested first release. New work is local to the laptop; no new hosted deployment is required for this iteration.

The primary workflow is selecting an existing piece, trying a replacement at the same position, comparing the result, checking dimensions, and committing or cancelling. Walking is secondary. Phone photographs remain appearance/capture input.

## Research decision

Blender can produce photorealistic geometry and shading; the first release intentionally used simple shapes, flat materials and an elevated camera. Improve those first. Use richer photo-informed furniture, UV-mapped materials, normal/roughness detail, HDR lighting and more natural camera framing. [Blender rendering](https://www.blender.org/features/rendering/).

The laptop is an Apple M4 MacBook Air with 16 GB unified memory. Official SAM3D requires Linux/NVIDIA 32 GB; TRELLIS.2 requires Linux/NVIDIA 24 GB. Hunyuan 2.1 documents 21 GB texture and 29 GB combined requirements. They are not dependable local textured-generation dependencies here. The Hunyuan Swift/MLX port reports a smaller shape-only path; Stable Fast 3D has CPU support but gated weights. None has been run on this room. [SAM setup](https://github.com/facebookresearch/sam-3d-objects/blob/main/doc/setup.md), [TRELLIS](https://github.com/microsoft/TRELLIS.2), [Hunyuan](https://github.com/Tencent-Hunyuan/Hunyuan3D-2.1), [Mac port](https://github.com/ZimengXiong/Hunyuan3D-Swift), [SF3D](https://github.com/Stability-AI/stable-fast-3d).

Deliver now: substantially richer authored assets and rendering, explicit replacement previews, local GLB intake for models created by other tools, and a photo reference workflow. This preserves a path to future reconstruction without presenting an upload as an automatic measured scan. Keep room measurements visibly estimated.

## Validation

Compare the old and new render at matched viewpoints. Check furniture silhouettes against the supplied photographs, portable textures and material response, grounded placement and independent object editing. Test replacement anchor/yaw preservation, cancel without saving, one-step confirm/undo, estimated-fit wording, imported-model validation, reload and missing local assets. Measure laptop performance during interaction. Keep private photos and video out of GitHub.
