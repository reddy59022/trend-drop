const cloudinary = require('cloudinary').v2;

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Image compression configuration for minimum storage
// Generates multiple sizes for responsive delivery
const imageOptimization = {
  // Avatar sizes (profile pictures)
  avatar: {
    thumb: { width: 50, height: 50, crop: 'fill', gravity: 'face', format: 'webp', quality: 'auto:low' },
    medium: { width: 150, height: 150, crop: 'fill', gravity: 'face', format: 'webp', quality: 'auto:good' },
    large: { width: 300, height: 300, crop: 'fill', gravity: 'face', format: 'webp', quality: 'auto:best' },
  },
  // Listing image sizes (product photos)
  listing: {
    thumb: { width: 200, height: 200, crop: 'limit', format: 'webp', quality: 'auto:low' },     // ~10-20KB
    medium: { width: 400, height: 400, crop: 'limit', format: 'webp', quality: 'auto:good' },    // ~30-60KB
    large: { width: 800, height: 800, crop: 'limit', format: 'webp', quality: 'auto:best' },     // ~60-120KB
    original: { width: 1200, height: 1200, crop: 'limit', format: 'webp', quality: 'auto:best' }, // ~100-200KB
  },
  // Banner/header images
  banner: {
    wide: { width: 1200, height: 400, crop: 'fill', format: 'webp', quality: 'auto:good' },
  },
};

// Uploads go through middleware/upload.js (multer memory storage) and the
// data-URI helpers in routes/ — the multer-storage-cloudinary adapter that
// used to live here was dead code and pinned cloudinary 1.x (HIGH advisory),
// so it is gone. `imageOptimization` remains as the shared preset source.
module.exports = { cloudinary, imageOptimization };