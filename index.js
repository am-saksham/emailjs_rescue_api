import express from 'express';
import axios from 'axios';

const app = express();
const PORT = 3000; // Replace with actual port if needed

// Hardcoded values (replace with your actual values)
const EMAILJS_SERVICE_ID = 'service_xx8x14i';
const EMAILJS_TEMPLATE_ID = 'template_ge84wl1';
const EMAILJS_PUBLIC_KEY = 'kGWlSshHzlgHp0Nke';

app.use(express.json());

function generateCode() {
  return Math.floor(1000 + Math.random() * 9000).toString();
}

app.post('/send-code', async (req, res) => {
  const { email } = req.body;

  if (!email) return res.status(400).json({ message: 'Email is required' });

  const verificationCode = generateCode();

  try {
    const response = await axios.post('https://api.emailjs.com/api/v1.0/email/send', {
      service_id: EMAILJS_SERVICE_ID,
      template_id: EMAILJS_TEMPLATE_ID,
      user_id: EMAILJS_PUBLIC_KEY,
      template_params: {
        to_email: email,
        user_code: verificationCode,
      },
    }, {
      headers: {
        'origin': 'http://localhost',
        'Content-Type': 'application/json',
      },
    });

    if (response.status === 200) {
      return res.json({ success: true, code: verificationCode });
    } else {
      return res.status(500).json({ success: false, message: 'EmailJS failed' });
    }
  } catch (error) {
    console.error(error.response?.data || error.message);
    res.status(500).json({ success: false, message: 'Error sending email' });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
});