import express from 'express';
import axios from 'axios';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { MongoClient } from 'mongodb';

const app = express();
const PORT = 3000;
const otpStorage = new Map();

// Configuration
const config = {
  mongoUri: 'mongodb+srv://amsakshamgupta:admin1234@cluster0.z20foql.mongodb.net/emergency_app?retryWrites=true&w=majority&appName=Cluster0',
  dbName: 'emergency_app',
  usersCollection: 'volunteers',
  emailjs: {
    serviceId: 'service_xx8x14i',
    templateId: 'template_ge84wl1',
    publicKey: 'kGWlSshHzlgHp0Nke'
  },
  volunteerApiBaseUrl: 'https://rescue-api-zwxb.onrender.com'
};

// Middleware
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Rate limiting
const otpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5,
  message: 'Too many OTP requests from this IP, please try again later'
});

// MongoDB client
let client;
let db;

async function connectToMongoDB() {
  try {
    client = new MongoClient(config.mongoUri, {
      serverApi: {
        version: '1',
        strict: true,
        deprecationErrors: true
      }
    });
    await client.connect();
    db = client.db(config.dbName);
    console.log('Connected to MongoDB');
  } catch (err) {
    console.error('MongoDB connection error:', err);
    process.exit(1);
  }
}

// Utility functions
function generateCode() {
  return Math.floor(1000 + Math.random() * 9000).toString();
}

function cleanupExpiredOtps() {
  const now = Date.now();
  for (const [email, data] of otpStorage.entries()) {
    if (data.expiresAt < now) {
      otpStorage.delete(email);
    }
  }
}

setInterval(cleanupExpiredOtps, 60 * 1000);

// Routes
app.post('/send-otp', otpLimiter, async (req, res) => {
  try {
    const { email } = req.body;

    // Validate email format
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ 
        success: false, 
        message: 'Please provide a valid email address' 
      });
    }

    cleanupExpiredOtps();

    // Check for recent OTP
    if (otpStorage.has(email)) {
      return res.status(429).json({
        success: false,
        message: 'An OTP was recently sent. Please wait before requesting another.'
      });
    }

    // Check if user exists in volunteer system
    try {
      const volunteerResponse = await axios.get(
        `${config.volunteerApiBaseUrl}/api/volunteers/${email}`
      );
      
      if (!volunteerResponse.data.exists) {
        return res.status(404).json({
          success: false,
          message: 'Email not registered as a volunteer'
        });
      }
    } catch (error) {
      console.error('Error checking volunteer:', error);
      return res.status(500).json({
        success: false,
        message: 'Error verifying volunteer status'
      });
    }

    const otp = generateCode();
    const expiresAt = Date.now() + 5 * 60 * 1000; // 5 minutes

    otpStorage.set(email, {
      code: otp,
      expiresAt,
      attempts: 0
    });

    // Send OTP via EmailJS
    const emailjsData = {
      service_id: config.emailjs.serviceId,
      template_id: config.emailjs.templateId,
      user_id: config.emailjs.publicKey,
      template_params: {
        to_email: email,
        user_code: otp,
      }
    };

    const emailResponse = await axios.post(
      'https://api.emailjs.com/api/v1.0/email/send',
      emailjsData,
      {
        headers: {
          'Content-Type': 'application/json',
          'Origin': 'http://localhost'
        },
        timeout: 10000
      }
    );

    if (emailResponse.status === 200) {
      return res.json({ 
        success: true, 
        message: 'OTP sent successfully'
      });
    } else {
      throw new Error(`EmailJS responded with status ${emailResponse.status}`);
    }

  } catch (error) {
    console.error('Error sending OTP:', error);
    if (req.body.email) {
      otpStorage.delete(req.body.email);
    }

    return res.status(500).json({ 
      success: false, 
      message: 'Failed to send OTP. Please try again later.',
    });
  }
});

app.post('/verify-otp', async (req, res) => {
  try {
    const { email, code } = req.body;

    if (!email || !code) {
      return res.status(400).json({ 
        success: false, 
        message: 'Email and OTP code are required' 
      });
    }

    cleanupExpiredOtps();

    const otpData = otpStorage.get(email);
    if (!otpData) {
      return res.status(400).json({ 
        success: false, 
        message: 'OTP expired or not found. Please request a new one.' 
      });
    }

    if (Date.now() > otpData.expiresAt) {
      otpStorage.delete(email);
      return res.status(400).json({ 
        success: false, 
        message: 'OTP expired. Please request a new one.' 
      });
    }

    if (otpData.attempts >= 3) {
      otpStorage.delete(email);
      return res.status(400).json({ 
        success: false, 
        message: 'Too many attempts. OTP invalidated. Please request a new one.' 
      });
    }

    if (code !== otpData.code) {
      otpStorage.set(email, {
        code: otpData.code,
        expiresAt: otpData.expiresAt,
        attempts: otpData.attempts + 1
      });
      return res.status(400).json({ 
        success: false, 
        message: 'Invalid OTP code' 
      });
    }

    // OTP is valid - fetch volunteer data from the volunteer API
    const volunteerResponse = await axios.get(
      `${config.volunteerApiBaseUrl}/api/volunteers/${email}`
    );

    if (!volunteerResponse.data.exists) {
      return res.status(404).json({
        success: false,
        message: 'Volunteer not found'
      });
    }

    // Get full volunteer details
    const volunteerDetails = await axios.get(
      `${config.volunteerApiBaseUrl}/api/volunteers/${volunteerResponse.data._id}`
    );

    otpStorage.delete(email);
    
    return res.json({ 
      success: true,
      message: 'OTP verified successfully',
      user: {
        email: volunteerDetails.data.email,
        name: volunteerDetails.data.name,
        profile_pic: volunteerDetails.data.image,
        phone: volunteerDetails.data.phone,
        volunteer_id: volunteerDetails.data._id
      }
    });

  } catch (error) {
    console.error('OTP verification error:', error);
    return res.status(500).json({ 
      success: false, 
      message: 'Failed to verify OTP. Please try again.' 
    });
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  const mongoStatus = client ? 'connected' : 'disconnected';
  const volunteerApiStatus = 'unknown'; // Could implement actual check
  
  res.status(200).json({ 
    status: 'healthy',
    services: {
      mongo: mongoStatus,
      volunteerApi: volunteerApiStatus
    },
    activeOtps: otpStorage.size,
    config: {
      emailjsConfigured: !!config.emailjs.serviceId && !!config.emailjs.templateId && !!config.emailjs.publicKey
    }
  });
});

// Connect to MongoDB and start server
connectToMongoDB().then(() => {
  app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
  });
});

// Handle graceful shutdown
process.on('SIGINT', async () => {
  if (client) {
    await client.close();
    console.log('MongoDB connection closed');
  }
  process.exit(0);
});

process.on('unhandledRejection', (err) => {
  console.error('Unhandled rejection:', err);
  process.exit(1);
});