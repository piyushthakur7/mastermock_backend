import mongoose, { Schema } from 'mongoose';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import { env } from '../config/env.js';

const userSchema = new Schema(
  {
    full_name: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    phone_number: {
      type: String,
      unique: true,
      sparse: true,
      trim: true,
    },
    password_hash: {
      type: String,
      required: [true, 'Password is required'],
      select: false,
    },
    profile_picture: {
      type: String, // Cloudinary url
    },
    status: {
      type: String,
      enum: ['active', 'suspended', 'unverified'],
      default: 'unverified',
    },
    role: {
      type: String,
      enum: ['STUDENT', 'ADMIN', 'INSTRUCTOR'],
      default: 'STUDENT',
    },
    refresh_token: {
      type: String,
    },
    loginAttempts: {
      type: Number,
      default: 0,
    },
    lockUntil: {
      type: Date,
    },
    resetPasswordToken: {
      type: String,
    },
    resetPasswordExpire: {
      type: Date,
    },
  },
  {
    timestamps: true,
  },
);

userSchema.virtual('isLocked').get(function () {
  return !!(this.lockUntil && this.lockUntil > Date.now());
});

userSchema.pre('save', async function () {
  if (!this.isModified('password_hash')) return;
  this.password_hash = await bcrypt.hash(this.password_hash, 10);
});

userSchema.methods.isPasswordCorrect = async function (password) {
  return await bcrypt.compare(password, this.password_hash);
};

userSchema.methods.generateAccessToken = function () {
  return jwt.sign(
    {
      _id: this._id,
      email: this.email,
      full_name: this.full_name,
      role: this.role,
    },
    env.ACCESS_TOKEN_SECRET,
    {
      expiresIn: env.ACCESS_TOKEN_EXPIRY,
    },
  );
};

userSchema.methods.generateRefreshToken = function () {
  return jwt.sign(
    {
      _id: this._id,
    },
    env.REFRESH_TOKEN_SECRET,
    {
      expiresIn: env.REFRESH_TOKEN_EXPIRY,
    },
  );
};

export const User = mongoose.model('User', userSchema);
