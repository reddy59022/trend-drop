const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const multer = require('multer');

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Performance: Optimized Cloudinary storage with aggressive compression
const storage = new CloudinaryStorage({
  cloudinary,
  params: (req, file) => {
    // Determine folder based on file type
    const folder = req.path.includes('avatar') ? 'trend-drop/avatars' : 'trend-drop/listings';
    return {
      folder,
      allowed_formats: ['jpg', 'jpeg', 'png', 'webp'],
      // Performance: Force WebP/AVIF format (30-50% smaller than JPEG/PNG)
      format: 'webp',
      // Performance: Quality optimization
      quality: 'auto:good',
      // Performance: Responsive breakpoints for different devices
      transformation: [
        // Max 800px for listings, 200px for avatars
        req.path.includes('avatar')
          ? { width: 200, height: 200, crop: 'fill', gravity: 'face' }
          : { width: 800, height: 800, crop: 'limit' },
      ],
    };
  },
});

const upload = multer({ storage });

module.exports = { cloudinary, upload };