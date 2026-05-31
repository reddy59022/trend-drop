const multer = require('multer');
const path = require('path');

// Performance: Use disk storage for better memory handling on mobile
const storage = multer.memoryStorage();

// Updated filter to accept any image MIME type. Mobile devices (e.g., iOS) often
// upload HEIC/HEIF files, which previously caused the generic "Only JPEG, PNG, and
// WebP images are allowed" error. Since Cloudinary will handle conversion/compression
// downstream, we simply validate that the uploaded file is an image and rely on the
// size limit (2 MB) to guard against abuse.
const fileFilter = (req, file, cb) => {
  const isImage = /^image\//i.test(file.mimetype);
  if (isImage) {
    return cb(null, true);
  }
  cb(new Error('Only image files are allowed'));
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