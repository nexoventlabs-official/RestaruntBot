const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const deliveryBoySchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  phone: { type: String, required: true },
  password: { type: String, required: true },
  photo: { type: String, default: '' },
  photoPublicId: { type: String, default: null },
  dob: { type: Date, required: true },
  age: { type: Number },
  isActive: { type: Boolean, default: true },
  isOnline: { type: Boolean, default: false },
  lastLogin: { type: Date },
  passwordChangedAt: { type: Date },
  // Token version - increment to invalidate all tokens
  tokenVersion: { type: Number, default: 0 },
  // Push notification token for Expo
  pushToken: { type: String, default: null },
  // Ratings from customers
  ratings: [{
    orderId: { type: String, required: true },
    phone: { type: String, required: true },
    rating: { type: Number, min: 1, max: 5, required: true },
    createdAt: { type: Date, default: Date.now }
  }],
  avgRating: { type: Number, default: 0 },
  totalRatings: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now }
});

// Calculate age from DOB before saving
deliveryBoySchema.pre('save', async function(next) {
  // Calculate age
  if (this.dob) {
    const today = new Date();
    const birthDate = new Date(this.dob);
    let age = today.getFullYear() - birthDate.getFullYear();
    const monthDiff = today.getMonth() - birthDate.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
      age--;
    }
    this.age = age;
  }
  
  // Hash password if modified
  if (this.isModified('password')) {
    this.password = await bcrypt.hash(this.password, 10);
  }
  next();
});

deliveryBoySchema.methods.comparePassword = function(password) {
  return bcrypt.compare(password, this.password);
};

module.exports = mongoose.model('DeliveryBoy', deliveryBoySchema);
