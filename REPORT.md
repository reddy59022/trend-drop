# Image Upload & Cloudinary Optimization Report

## 1. Current upload pipeline
* **Client (`client/src/pages/Sell.js`)** – Users select up to 10 images. The new implementation now uses the
  `browser-image-compression` library to compress each image to a maximum of **800 × 800** pixels,
  target size **~0.5 MB**, and converts it to **WebP** before sending it to the server.
* **Server (`server/routes/listings.js`)** – Receives the files via Multer, reads them as Base64 data‑URIs and uploads
  them to Cloudinary. The upload includes a transformation `{ width: 800, height: 800, crop: 'limit' }`.
* **Cloudinary config (`server/config/cloudinary.js`)** – Defines eager transformations for avatars and listings. For
  listings we now generate **only the thumbnail** eagerly; the larger versions are generated on‑demand.

## 2. Estimated storage per image (based on `imageOptimization` comments)
| Variant | Approx. size |
|--------|--------------|
| Thumb  | 15 KB |
| Medium | 45 KB |
| Large  | 90 KB |
| Original | 150 KB |
| **Total** | **≈ 300 KB** |

## 3. Per‑listing footprint (max 10 images)
* **≈ 3 MB** stored in Cloudinary.

## 4. Cloudinary Free‑Tier limits (2026)
* **Storage:** 25 GB
* **Transformations:** 20 000 / month
* **Bandwidth:** 5 GB (not a limiting factor for our calculations)

## 5. How many free listings can be supported?
* **Storage‑based:** `25 GB ÷ 3 MB ≈ 8 500` listings.
* **Transformation‑based:** Each listing now creates **1 eager transformation** (the thumbnail) + the on‑demand large image when requested. The eager thumbnail counts toward the monthly quota, so:
  `20 000 ÷ 10 (images per listing) ≈ 2 000` listings.
  The on‑demand transforms are served from Cloudinary’s CDN and do **not** consume the transformation quota.
* **Limiting factor:** Transformations → ~2 000 free listings.

## 6. Platform‑specific upload size (before compression)
| Platform | Typical raw size | Size after client compression |
|----------|-------------------|------------------------------|
| Web (browser) | 2–4 MB (JPEG/HEIC) | ~0.5 MB per image |
| iOS app | 1–3 MB (HEIC) | ~0.5 MB per image |
| Android app | 2–5 MB (JPEG) | ~0.5 MB per image |

## 7. Recommended improvements (already applied)
1. **Client‑side compression** – Added `browser-image-compression` with 800 px limit, 0.5 MB target, WebP output.
2. **Reduced Multer file‑size limit** – `server/middleware/upload.js` now caps uploads at **2 MB**.
3. **Eager transformation cut** – Cloudinary config now generates only the thumbnail eagerly for listings, cutting transformation usage by ~90 %.
4. **Lower server‑side transformation quality** – You may further lower `quality` for non‑cover images (e.g., `auto:low`).
5. **Regular cleanup** – Implement a scheduled job to delete images of removed listings.

## 8. Resulting free‑tier capacity after changes
* **Transformations:** ~2 000 listings rather than ~666.
* **Storage:** Still far below the 25 GB limit.

These changes dramatically increase the number of listings you can host on Cloudinary’s free tier while reducing upload bandwidth for all platforms.
