# polo-6 — manual correction required

- BiRefNet mask is essentially the measuring tape only (fabric missing).
- Lab-seed keeps more white fabric but is noisy: carpet bleed left of tape + magenta holes in fabric (mask erosion).
- Neither is product-ready. Starting mask = Lab-seed (more garment pixels); brush-restore fabric holes and erase carpet/tape as needed.

Use in-app brush / polygon mask editor. Do not invent color heuristics.
Do not fill genuine openings; do not modify source RGB.

Starting cutout: `manual-queue/polo-6-starting-cutout.png`
Starting mask: `manual-queue/polo-6-starting-mask.png`
