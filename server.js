// server.js
const express = require('express');
const cors = require('cors');
const nodemailer = require('nodemailer');
const bodyParser = require('body-parser');
const mongoose = require('mongoose');
const crypto = require('crypto');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors({
  origin: process.env.FRONTEND_URL || 'https://www.bibekbhattarai14.com.np',
  credentials: true
}));
app.use(bodyParser.json());

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
})
.then(() => console.log('Connected to MongoDB'))
.catch(err => console.error('MongoDB connection error:', err));

// User Schema for MongoDB
const userSchema = new mongoose.Schema({
  firstName: { type: String, required: true },
  lastName: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  phone: { type: String },
  verified: { type: Boolean, default: false },
  verificationToken: { type: String },
  tokenExpiry: { type: Date },
  createdAt: { type: Date, default: Date.now }
});

const User = mongoose.model('User', userSchema);

// Message Schema for MongoDB
const messageSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  message: { type: String, required: true },
  createdAt: { type: Date, default: Date.now }
});

const Message = mongoose.model('Message', messageSchema);

// Create email transporter
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: process.env.SMTP_PORT,
  secure: process.env.SMTP_SECURE === 'true',
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASSWORD,
  },
});

// Generate verification token
const generateVerificationToken = () => {
  return crypto.randomBytes(32).toString('hex');
};

// Send verification email
const sendVerificationEmail = async (user) => {
  const verificationUrl = `${process.env.FRONTEND_URL || 'https://www.bibekbhattarai14.com.np'}/verify-email?token=${user.verificationToken}`;
  
  const mailOptions = {
    from: `Bibek Bhattarai Portfolio <${process.env.SMTP_USER}>`,
    to: user.email,
    subject: 'Please Verify Your Email Address',
    html: `
      <h2>Email Verification</h2>
      <p>Hello ${user.firstName} ${user.lastName},</p>
      <p>Thank you for contacting me. Please verify your email address by clicking the link below:</p>
      <p><a href="${verificationUrl}">Verify Email Address</a></p>
      <p>This link will expire in 24 hours.</p>
      <p>If you did not submit a contact form on my portfolio website, please ignore this email.</p>
    `
  };

  await transporter.sendMail(mailOptions);
};

// Send notification to admin after verification
const sendAdminNotification = async (user, messageContent) => {
  const mailOptions = {
    from: `${user.firstName} ${user.lastName} via Portfolio <${process.env.SMTP_USER}>`,
    to: process.env.EMAIL_TO,
    subject: 'New Verified Contact Form Submission',
    html: `
      <h2>New Contact Form Submission</h2>
      <p><strong>Name:</strong> ${user.firstName} ${user.lastName}</p>
      <p><strong>Email:</strong> ${user.email} (Verified)</p>
      <p><strong>Phone:</strong> ${user.phone || 'Not provided'}</p>
      <p><strong>Message:</strong></p>
      <p>${messageContent}</p>
    `,
    replyTo: user.email
  };

  await transporter.sendMail(mailOptions);
};

// Email registration and verification endpoint
app.post('/api/send-email', async (req, res) => {
  const { firstName, lastName, email, phone, message } = req.body;
  
  if (!firstName || !lastName || !email || !message) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    // Check if user exists
    let user = await User.findOne({ email });
    
    if (user) {
      // If user exists but not verified
      if (!user.verified) {
        // Generate new token and update expiry
        const verificationToken = generateVerificationToken();
        const tokenExpiry = new Date();
        tokenExpiry.setHours(tokenExpiry.getHours() + 24); // 24 hour expiry
        
        user.verificationToken = verificationToken;
        user.tokenExpiry = tokenExpiry;
        user.firstName = firstName; // Update in case user changed details
        user.lastName = lastName;
        user.phone = phone;
        
        await user.save();
        await sendVerificationEmail(user);
        
        // Save the message
        const newMessage = new Message({
          userId: user._id,
          message
        });
        await newMessage.save();
        
        return res.status(200).json({ 
          success: true, 
          message: 'Please check your email to verify your address before we process your message' 
        });
      } else {
        // User is already verified, save message and notify admin
        const newMessage = new Message({
          userId: user._id,
          message
        });
        await newMessage.save();
        
        await sendAdminNotification(user, message);
        
        return res.status(200).json({ 
          success: true, 
          message: 'Your message has been sent successfully' 
        });
      }
    } else {
      // Create new user
      const verificationToken = generateVerificationToken();
      const tokenExpiry = new Date();
      tokenExpiry.setHours(tokenExpiry.getHours() + 24); // 24 hour expiry
      
      user = new User({
        firstName,
        lastName,
        email,
        phone,
        verified: false,
        verificationToken,
        tokenExpiry
      });
      
      await user.save();
      
      // Save the message
      const newMessage = new Message({
        userId: user._id,
        message
      });
      await newMessage.save();
      
      // Send verification email
      await sendVerificationEmail(user);
      
      return res.status(200).json({ 
        success: true, 
        message: 'Please check your email to verify your address before we process your message' 
      });
    }
  } catch (error) {
    console.error('Error processing contact form:', error);
    res.status(500).json({ success: false, error: 'Failed to process your message' });
  }
});

// Email verification endpoint
app.get('/api/verify-email', async (req, res) => {
  const { token } = req.query;
  
  if (!token) {
    return res.status(400).json({ error: 'Invalid verification token' });
  }
  
  try {
    // Find user by verification token
    const user = await User.findOne({ 
      verificationToken: token,
      tokenExpiry: { $gt: new Date() } // Check if token hasn't expired
    });
    
    if (!user) {
      return res.status(400).json({ 
        error: 'Invalid or expired verification token. Please submit the contact form again.' 
      });
    }
    
    // Mark user as verified
    user.verified = true;
    user.verificationToken = undefined;
    user.tokenExpiry = undefined;
    await user.save();
    
    // Find pending messages for this user
    const pendingMessages = await Message.find({ userId: user._id });
    
    // Send admin notifications for all pending messages
    for (const messageDoc of pendingMessages) {
      await sendAdminNotification(user, messageDoc.message);
    }
    
    return res.status(200).json({ 
      success: true, 
      message: 'Email verified successfully. Your message has been sent.' 
    });
  } catch (error) {
    console.error('Error verifying email:', error);
    return res.status(500).json({ error: 'Failed to verify email' });
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});