const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const multer = require('multer');

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

// Performance: Optimized Cloudinary storage with aggressive compression
const storage = new CloudinaryStorage({
  cloudinary,
  params: (req, file) => {
    const folder = req.path.includes('avatar') ? 'trend-drop/avatars' : 'trend-drop/listings';
    return {
      folder,
      allowed_formats: ['jpg', 'jpeg', 'png', 'webp', 'avif'],
      format: 'webp',           // WebP = 30-50% smaller than JPEG
      quality: 'auto:good',     // Auto quality based on content
      eager_async: true,        // Generate responsive sizes in background
      // Responsive breakpoints for mobile/web/ios/android
      // Generate only the thumbnail eagerly for listings to cut transformation usage.
      // The cover image (first upload) will still be transformed on demand via the "large" preset.
      eager: req.path.includes('avatar')
        ? [
            imageOptimization.avatar.thumb,
            imageOptimization.avatar.medium,
          ]
        : [
            imageOptimization.listing.thumb,
          ],
      transformation: [
        req.path.includes('avatar')
          ? imageOptimization.avatar.medium
          : imageOptimization.listing.large,
      ],
    };
  },
});

const upload = multer({
  storage,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB max
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'), false);
    }
  },
});

module.exports = { cloudinary, upload, imageOptimization };