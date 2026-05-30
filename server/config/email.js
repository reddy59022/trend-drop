// Brevo (formerly Sendinblue) email configuration
const SibApiV3Sdk = require('@sendinblue/client');

const apiInstance = new SibApiV3Sdk.TransactionalEmailsApi();
apiInstance.setApiKey(SibApiV3Sdk.TransactionalEmailsApiApiKeys.apiKey, process.env.BREVO_API_KEY);

const SENDER_EMAIL = process.env.BREVO_SENDER_EMAIL || 'reddy59021@gmail.com';
const SENDER_NAME = 'TrendDrop';
// Use the FRONTEND_URL environment variable for email links. It must be set in the deployment environment.
const BASE_URL = process.env.FRONTEND_URL;

// Send email verification
const sendVerificationEmail = async (email, name, token) => {
  const verificationUrl = `${BASE_URL}/verify-email?token=${token}`;

  try {
    const sendSmtpEmail = new SibApiV3Sdk.SendSmtpEmail();
    sendSmtpEmail.subject = 'Verify your TrendDrop email address';
    sendSmtpEmail.htmlContent = `
      <!DOCTYPE html>
      <html>
      <head><meta charset="utf-8"></head>
      <body style="font-family: Arial, sans-serif; margin:0; padding:0; background:#f5f5f5;">
        <div style="max-width:600px; margin:0 auto; padding:20px;">
          <div style="background:linear-gradient(135deg, #FF4D6D, #FF8FA3); padding:30px; text-align:center; border-radius:12px 12px 0 0;">
            <h1 style="color:#fff; margin:0; font-size:24px;">Welcome to TrendDrop! 🎉</h1>
          </div>
          <div style="background:#fff; padding:30px; border-radius:0 0 12px 12px; box-shadow:0 2px 8px rgba(0,0,0,0.1);">
            <p style="font-size:16px; color:#333;">Hi <strong>${name}</strong>,</p>
            <p style="font-size:16px; color:#555; line-height:1.6;">
              Thanks for signing up! Please verify your email address to start buying and selling on TrendDrop.
            </p>
            <div style="text-align:center; margin:30px 0;">
              <a href="${verificationUrl}" 
                 style="background:linear-gradient(135deg, #FF4D6D, #FF8FA3); color:#fff; padding:14px 40px; 
                        text-decoration:none; border-radius:8px; font-size:16px; font-weight:600; display:inline-block;">
                Verify Email Address
              </a>
            </div>
            <p style="font-size:14px; color:#888;">
              Or copy this link: <br>
              <span style="color:#FF4D6D;">${verificationUrl}</span>
            </p>
            <p style="font-size:14px; color:#888; margin-top:20px;">
              This link expires in 24 hours.
            </p>
            <hr style="border:none; border-top:1px solid #eee; margin:20px 0;">
            <p style="font-size:12px; color:#aaa; text-align:center;">
              If you didn't create an account, you can safely ignore this email.
            </p>
          </div>
        </div>
      </body>
      </html>
    `;
    sendSmtpEmail.to = [{ email, name }];
    sendSmtpEmail.sender = { email: SENDER_EMAIL, name: SENDER_NAME };
    sendSmtpEmail.replyTo = { email: SENDER_EMAIL, name: 'TrendDrop Support' };

    const result = await apiInstance.sendTransacEmail(sendSmtpEmail);
    console.log('Verification email sent to:', email, 'messageId:', result.body?.messageId);
    return true;
  } catch (error) {
    console.error('Brevo send error:', error.message, error.response?.body || '');
    return false;
  }
};


// Send password reset email
const sendPasswordResetEmail = async (email, name, token) => {
  const resetUrl = `${BASE_URL}/reset-password?token=${token}`;

  try {
    const sendSmtpEmail = new SibApiV3Sdk.SendSmtpEmail();
    sendSmtpEmail.subject = 'Reset your TrendDrop password';
    sendSmtpEmail.htmlContent = `
      <!DOCTYPE html>
      <html>
      <body style="font-family: Arial, sans-serif; background:#f5f5f5; padding:20px;">
        <div style="max-width:600px; margin:0 auto; background:#fff; border-radius:12px; overflow:hidden;">
          <div style="background:linear-gradient(135deg, #FF4D6D, #FF8FA3); padding:20px; text-align:center;">
            <h1 style="color:#fff; margin:0; font-size:20px;">Password Reset</h1>
          </div>
          <div style="padding:30px;">
            <p>Hi <strong>${name}</strong>,</p>
            <p>Click the button below to reset your password. This link expires in 1 hour.</p>
            <div style="text-align:center; margin:25px 0;">
              <a href="${resetUrl}" style="background:#FF4D6D; color:#fff; padding:12px 35px; text-decoration:none; border-radius:8px; font-size:16px; display:inline-block;">
                Reset Password
              </a>
            </div>
          </div>
        </div>
      </body>
      </html>
    `;
    sendSmtpEmail.to = [{ email, name }];
    sendSmtpEmail.sender = { email: SENDER_EMAIL, name: SENDER_NAME };

    await apiInstance.sendTransacEmail(sendSmtpEmail);
    console.log('Password reset email sent to:', email);
    return true;
  } catch (error) {
    console.error('Brevo reset error:', error.message);
    return false;
  }
};

module.exports = { sendVerificationEmail, sendPasswordResetEmail };