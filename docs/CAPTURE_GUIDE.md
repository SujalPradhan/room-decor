# Capture guide for this room

The existing photos are useful appearance references. The next capture should establish room topology, scale and complete furniture footprints. These positions and counts are a practical starting protocol, not a guarantee of reconstruction quality.

## Quick capture for the first editable model

Use the POCO's main rear camera at 1×, without changing lenses during a sequence. Keep original-resolution files. Use steady lighting, clean the lens, switch on room lights and reduce direct window glare. Stop the fans while capturing. Keep furniture and loose objects stationary throughout the sequence.

Take these **eight overview photos**:

1. From each of the four accessible corners, photograph diagonally toward the opposite corner at roughly chest height. Include floor–wall junctions and enough ceiling to understand the room boundary. If a corner is blocked, use the nearest accessible position.
2. From the doorway, photograph the room interior, including both sides of the entrance when possible.
3. From inside, face the doorway and capture the door, frame and nearby walls. Add an extra photo showing the open door and swing direction.
4. Face the desk wall as squarely as practical, including the chair, sockets and both ends of the desk.
5. Face the wardrobe/window/floor-bed area, including where these objects meet the floor.

Then take **two or three views per major object**: front, oblique side and another accessible side. Prioritize the bed's full outer frame, wardrobe depth, desk legs/edges, fan base, floor mattress thickness and the partly hidden chair. Photograph labels or a tape measure separately if useful. Do not move heavy furniture just to expose a rear surface; mark unseen geometry as inferred.

## Optional reconstruction sequence

For a reconstruction attempt, eight overview photos are not the whole dataset. Walk a slow loop through the accessible space and take overlapping images, then a second pass aimed slightly lower or higher where coverage is missing. Aim for roughly 60–80 images as an initial room-sized trial, adjusting for actual coverage and processing capacity. Keep approximately 70–80% visual overlap as a working target. These numbers are proposed settings to test.

Move the camera's position between shots; a stationary 360° rotation alone is insufficient for the intended multiview geometry. Try to show each relevant surface from at least three positions. Return to the starting area to connect the sequence. Do not film only blank walls; include furniture edges and textured surfaces. COLMAP specifically recommends overlapping views, camera translation, consistent illumination and multiple observations per object. [Official capture guidance](https://colmap.github.io/tutorial.html).

A slow, steady 1× video can supply candidate frames, but blurred or redundant frames must be filtered. Ordinary video does not by itself provide the calibrated poses and synchronized sensor data of an ARCore session.

## Measurements that matter

Record the unit and a photo/reference label for each measurement.

| Item | Measurements |
|---|---|
| Room | Every wall length; ceiling height; beam/soffit size and position; one diagonal to check a rectangular assumption. |
| Entrance | Clear width and height, distance from adjacent corner, hinge side and inward/outward swing. |
| Windows | Width, height, sill height and offsets from adjacent corners; curtain projection if it affects placement. |
| Bed | Maximum outer width × length × height, including protruding headboard/footboard. |
| Wardrobe | Outer width × depth × height; handle projection and door-opening space. |
| Desk | Width × depth × height; any protruding frame; chair footprint and pull-out space. |
| Floor bed | Width × length × thickness. |
| Pedestal fan | Maximum base diameter/width, head width, height and cord length if placement is constrained. |
| Fixed obstacles | Socket positions/heights, projecting fittings and other placement constraints. |

For an initial draft, start with room wall lengths, height and the major furniture footprints. For tight-fit or purchase decisions, verify the relevant room, opening and product dimensions. One known length can help anchor photographic scale, but it does not validate all reconstructed distances or wall angles.

## Future guided scan on this phone

An Android capture experiment should check ARCore availability, Depth API support and tracking status at runtime. During a scan, guide movement around accessible room edges and flag missing corners or tracking loss. Use several independently measured distances to evaluate the exported result, including a distance not used for calibration. Repeat the scan to assess consistency. Google documents imprecise depth on featureless surfaces, which is relevant to this room's plain walls. [Depth API guidance](https://developers.google.com/ar/develop/depth).
