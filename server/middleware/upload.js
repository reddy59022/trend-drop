const multer = require('multer');
const path = require('path');

// Performance: Use disk storage for better memory handling on mobile
const storage = multer.memoryStorage();

const fileFilter = (req, file, cb) => {
  const allowedTypes = /jpeg|jpg|png|webp/; // Removed gif for performance
  const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
  const mimetype = allowedTypes.test(file.mimetype);

  if (mimetype && extname) {
    return cb(null, true);
  }
  cb(new Error('Only JPEG, PNG, and WebP images are allowed'));
};

// Performance: Smaller file limit (2MB) since Cloudinary compresses further
const upload = multer({
  storage,
  limits: {
    fileSize: 2 * 1024 * 1024, // 2MB max
    files: 10, // max 10 files
  },
  fileFilter,
});

module.exports = upload;