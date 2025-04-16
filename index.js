import express from 'express';
import axios from 'axios';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { MongoClient } from 'mongodb';

const app = express();
const PORT = 3000;
const otpStorage = new Map();

// MongoDB connection URI - replace with your actual connection string
const mongoUri = 'mongodb+srv://amsakshamgupta:admin1234@cluster0.z20foql.mongodb.net/emergency_app?retryWrites=true&w=majority&appName=Cluster0';
const dbName = 'emergency_app'; // Replace with your database name
const usersCollection = 'volunteers'; // Replace with your collection name

// Configuration - REPLACE THESE WITH YOUR ACTUAL VALUES
const config = {
  emailjs: {
    serviceId: 'service_xx8x14i',
    templateId: 'template_ge84wl1',
    publicKey: 'kGWlSshHzlgHp0Nke'
  }
};

// Middleware
app.use(cors());
app.use(express.json());

const otpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: 'Too many OTP requests from this IP, please try again later'
});

// MongoDB client
let client;
let db;

async function connectToMongoDB() {
  try {
    client = new MongoClient(mongoUri);
    await client.connect();
    db = client.db(dbName);
    console.log('Connected to MongoDB');
  } catch (err) {
    console.error('MongoDB connection error:', err);
    process.exit(1);
  }
}

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

app.post('/send-otp', otpLimiter, async (req, res) => {
  try {
    const { email } = req.body;

    // Validate email format
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      console.log('Invalid email format received:', email);
      return res.status(400).json({ 
        success: false, 
        message: 'Please provide a valid email address' 
      });
    }

    cleanupExpiredOtps();

    // Check for recent OTP
    if (otpStorage.has(email)) {
      console.log('OTP already sent to:', email);
      return res.status(429).json({
        success: false,
        message: 'An OTP was recently sent. Please wait before requesting another.'
      });
    }

    const otp = generateCode();
    const expiresAt = Date.now() + 5 * 60 * 1000;

    otpStorage.set(email, {
      code: otp,
      expiresAt,
      attempts: 0
    });

    console.log('Attempting to send OTP:', { email, otp });

    // Prepare EmailJS request data
    const emailjsData = {
      service_id: config.emailjs.serviceId,
      template_id: config.emailjs.templateId,
      user_id: config.emailjs.publicKey,
      template_params: {
        to_email: email,
        user_code: otp,
      }
    };

    console.log('Sending to EmailJS with data:', emailjsData);

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

    console.log('EmailJS response:', {
      status: emailResponse.status,
      data: emailResponse.data
    });

    if (emailResponse.status === 200) {
      return res.json({ 
        success: true, 
        message: 'OTP sent successfully'
      });
    } else {
      throw new Error(`EmailJS responded with status ${emailResponse.status}`);
    }

  } catch (error) {
    console.error('Error sending OTP:', {
      message: error.message,
      stack: error.stack,
      response: error.response?.data
    });

    if (req.body.email) {
      otpStorage.delete(req.body.email);
    }

    return res.status(500).json({ 
      success: false, 
      message: 'Failed to send OTP. Please try again later.',
      error: error.message
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

    // OTP is valid - fetch user data from MongoDB
    const user = await db.collection(usersCollection).findOne({ email });
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found in database'
      });
    }

    otpStorage.delete(email);
    
    return res.json({ 
      success: true,
      message: 'OTP verified successfully',
      user: {
        email: user.email,
        name: user.name,
        profile_pic: user.profile_pic,
        phone: user.phone,
        address: user.address
        // Add other user fields as needed
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

// New endpoint to fetch user data directly
app.get('/api/users/:email', async (req, res) => {
  try {
    const { email } = req.params;
    
    const user = await db.collection(usersCollection).findOne({ email });
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }
    
    return res.json({
      success: true,
      user: {
        email: user.email,
        name: user.name,
        profile_pic: user.profile_pic,
        phone: user.phone,
        address: user.address
      }
    });
  } catch (error) {
    console.error('Error fetching user:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch user data'
    });
  }
});

app.get('/health', (req, res) => {
  const mongoStatus = client ? 'connected' : 'disconnected';
  
  res.status(200).json({ 
    status: 'healthy',
    mongo: mongoStatus,
    activeOtps: otpStorage.size,
    config: {
      emailjsConfigured: !!config.emailjs.serviceId && !!config.emailjs.templateId && !!config.emailjs.publicKey
    }
  });
});

// Connect to MongoDB when server starts
connectToMongoDB().then(() => {
  app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log('Current configuration:', {
      emailjs: {
        serviceId: config.emailjs.serviceId,
        templateId: config.emailjs.templateId,
        publicKey: config.emailjs.publicKey ? '*****' : 'MISSING'
      }
    });
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