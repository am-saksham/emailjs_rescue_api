import express from 'express';
import axios from 'axios';
import cors from 'cors';
import rateLimit from 'express-rate-limit';

// Initialize Express
const app = express();
const PORT = 3000;

// In-memory storage for OTP codes
const otpStorage = new Map();

// Hardcoded configuration (replace with your actual values)
const config = {
  emailjs: {
    serviceId: 'service_xx8x14i',
    templateId: 'template_ge84wl1',
    publicKey: 'kGWlSshHzlgHp0Nke'
  }
};

// Middleware - Simplified CORS
app.use(cors()); // Allow all origins (for development)
app.use(express.json());

// Rate limiting
const otpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // limit each IP to 5 requests per windowMs
  message: 'Too many OTP requests from this IP, please try again later'
});

// Generate random 4-digit code
function generateCode() {
  return Math.floor(1000 + Math.random() * 9000).toString();
}

// Cleanup expired OTPs
function cleanupExpiredOtps() {
  const now = Date.now();
  for (const [email, data] of otpStorage.entries()) {
    if (data.expiresAt < now) {
      otpStorage.delete(email);
    }
  }
}

// Schedule regular cleanup
setInterval(cleanupExpiredOtps, 60 * 1000); // Run every minute

// POST /send-otp
app.post('/send-otp', otpLimiter, async (req, res) => {
  try {
    const { email } = req.body;

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ success: false, message: 'Please provide a valid email address' });
    }

    // Cleanup before checking for recent OTPs
    cleanupExpiredOtps();

    if (otpStorage.has(email)) {
      return res.status(429).json({
        success: false,
        message: 'An OTP was recently sent. Please wait before requesting another.'
      });
    }

    const otp = generateCode();
    const expiresAt = Date.now() + 5 * 60 * 1000; // 5 minutes expiration

    otpStorage.set(email, {
      code: otp,
      expiresAt,
      attempts: 0
    });

    const emailResponse = await axios.post(
      'https://api.emailjs.com/api/v1.0/email/send',
      {
        service_id: config.emailjs.serviceId,
        template_id: config.emailjs.templateId,
        user_id: config.emailjs.publicKey,
        template_params: {
          to_email: email,
          user_code: otp,
        },
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'Origin': 'http://localhost' // Required by EmailJS
        },
      }
    );

    if (emailResponse.status === 200) {
      return res.json({ success: true, message: 'OTP sent successfully' });
    } else {
      otpStorage.delete(email);
      throw new Error('Email service failed');
    }
  } catch (error) {
    console.error('OTP send error:', error);
    return res.status(500).json({ success: false, message: 'Failed to send OTP. Please try again later.' });
  }
});

// POST /verify-otp
app.post('/verify-otp', async (req, res) => {
  try {
    const { email, code } = req.body;

    if (!email || !code) {
      return res.status(400).json({ success: false, message: 'Email and OTP code are required' });
    }

    cleanupExpiredOtps();

    const otpData = otpStorage.get(email);
    if (!otpData) {
      return res.status(400).json({ success: false, message: 'OTP expired or not found. Please request a new one.' });
    }

    if (Date.now() > otpData.expiresAt) {
      otpStorage.delete(email);
      return res.status(400).json({ success: false, message: 'OTP expired. Please request a new one.' });
    }

    if (otpData.attempts >= 3) {
      otpStorage.delete(email);
      return res.status(400).json({ success: false, message: 'Too many attempts. OTP invalidated. Please request a new one.' });
    }

    if (code !== otpData.code) {
      otpStorage.set(email, {
        code: otpData.code,
        expiresAt: otpData.expiresAt,
        attempts: otpData.attempts + 1
      });
      return res.status(400).json({ success: false, message: 'Invalid OTP code' });
    }

    otpStorage.delete(email);
    return res.json({ success: true, message: 'OTP verified successfully' });

  } catch (error) {
    console.error('OTP verification error:', error);
    return res.status(500).json({ success: false, message: 'Failed to verify OTP. Please try again.' });
  }
});

// Health check
app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'healthy',
    activeOtps: otpStorage.size
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 OTP Service running on port ${PORT}`);
  console.log(`Using in-memory OTP storage (not Redis)`);
});