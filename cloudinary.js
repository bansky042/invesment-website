// cloudinary.js
const cloudinary = require('cloudinary').v2;
const multer = require('multer');
const { CloudinaryStorage } = require('multer-storage-cloudinary');


console.log("Cloudinary ENV:", {
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
  });
  
// 🔐 Config
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

// ✅ KYC storage
const kycStorage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: 'kyc_uploads',
    allowed_formats: ['jpg', 'png', 'jpeg', 'pdf'],
    public_id: (req, file) => `kyc-${req.user.id}-${Date.now()}`
  }
});

// ✅ Profile image storage
const profileStorage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: 'profile_images',
    allowed_formats: ['jpg', 'png', 'jpeg'],
    public_id: (req, file) => `profile-${req.user.id}-${Date.now()}`
  }
});

// ✅ Deposit proof storage
const depositStorage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: 'deposit_proofs',
    allowed_formats: ['jpg', 'png', 'jpeg', 'pdf'],
    public_id: (req, file) => `deposit-${req.user.id}-${Date.now()}`
  }
});

module.exports = {
  cloudinary,
  kycUpload: multer({ storage: kycStorage }),
  uploadProfile: multer({ storage: profileStorage }),
  depositUpload: multer({ storage: depositStorage }),
};
