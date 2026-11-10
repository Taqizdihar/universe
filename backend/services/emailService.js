// =============================================================
// Email Service — Nodemailer + Brevo SMTP (Port 2525)
// =============================================================
// Sends transactional email notifications using Brevo's SMTP
// relay on port 2525 (STARTTLS). This bypasses Render's firewall
// which blocks ports 465 and 587 on free-tier instances.
//
// Required environment variables:
//   SMTP_HOST      — smtp-relay.brevo.com
//   SMTP_PORT      — 2525
//   SMTP_USER      — Brevo login email
//   SMTP_PASS      — Brevo SMTP key
//   EMAIL_FROM     — Verified sender address
//   FRONTEND_URL   — Frontend dashboard URL (Cloudflare pages.dev domain)
// =============================================================

const nodemailer = require('nodemailer');
require('dotenv').config();

// Lazy-initialized transporter singleton
let transporter = null;

const getTransporter = () => {
    if (transporter) return transporter;

    const host = process.env.SMTP_HOST;
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;

    if (!host || !user || !pass) {
        console.warn('[EMAIL] ⚠ SMTP credentials not fully configured. Required: SMTP_HOST, SMTP_USER, SMTP_PASS.');
        return null;
    }

    transporter = nodemailer.createTransport({
        host,
        port: parseInt(process.env.SMTP_PORT) || 2525,
        secure: false, // Must be false for port 2525 — uses STARTTLS, not implicit SSL
        auth: { user, pass },
        family: 4, // Force IPv4 to prevent connection issues on Render
    });

    console.log(`[EMAIL] ✓ Nodemailer transporter initialized (${host}:${parseInt(process.env.SMTP_PORT) || 2525}, IPv4).`);

    return transporter;
};

/**
 * Send an inquiry notification email to the tenant admin.
 *
 * @param {string} adminEmail   - Recipient email (dynamically fetched from DB per tenant)
 * @param {Object} inquiryData  - The inquiry payload from the visitor
 * @param {string} inquiryData.senderName  - Visitor's name
 * @param {string} inquiryData.senderEmail - Visitor's email (used as replyTo)
 * @param {string} inquiryData.subject     - Inquiry subject (optional)
 * @param {string} inquiryData.message     - Inquiry message body
 * @param {string} inquiryData.siteName    - Tenant site name (for branding)
 * @param {string} inquiryData.cmsUrl      - URL to the CMS dashboard
 */
const sendInquiryNotification = async (adminEmail, inquiryData) => {
    const mailer = getTransporter();

    if (!mailer) {
        console.log('[EMAIL] Skipping notification — SMTP not configured.');
        return { success: false, reason: 'SMTP not configured' };
    }

    const { senderName, senderEmail, subject, message, siteName, cmsUrl } = inquiryData;
    const fromAddress = process.env.EMAIL_FROM;

    if (!fromAddress) {
        console.warn('[EMAIL] ⚠ EMAIL_FROM not set. Cannot send notification.');
        return { success: false, reason: 'EMAIL_FROM not configured' };
    }

    const mailOptions = {
        from: `"UNI-VERSE CMS" <${fromAddress}>`,
        to: adminEmail,
        replyTo: senderEmail, // Admin can reply directly to the visitor from Gmail
        subject: `[UNI-VERSE] Pesan Baru dari ${senderName}`,
        html: `
            <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #fafafa; border-radius: 12px; overflow: hidden; border: 1px solid #e4e4e7;">
                <div style="background: #18181b; padding: 24px 32px;">
                    <h1 style="color: #fbbf24; font-size: 18px; margin: 0; letter-spacing: 0.05em;">UNI-VERSE CMS</h1>
                    <p style="color: #a1a1aa; font-size: 12px; margin: 4px 0 0 0; text-transform: uppercase; letter-spacing: 0.1em;">Notifikasi Pesan Masuk</p>
                </div>
                <div style="padding: 32px;">
                    <p style="color: #3f3f46; font-size: 14px; line-height: 1.6; margin: 0 0 24px 0;">
                        Hai Admin <strong>${siteName || 'Website'}</strong>,<br/>
                        Anda menerima pesan baru dari form kontak website Anda.
                    </p>
                    
                    <div style="background: white; border: 1px solid #e4e4e7; border-radius: 8px; padding: 20px; margin-bottom: 24px;">
                        <table style="width: 100%; border-collapse: collapse;">
                            <tr>
                                <td style="color: #a1a1aa; font-size: 11px; text-transform: uppercase; letter-spacing: 0.1em; padding: 6px 0; font-weight: 700;">Nama</td>
                                <td style="color: #18181b; font-size: 14px; padding: 6px 0; font-weight: 600;">${senderName}</td>
                            </tr>
                            <tr>
                                <td style="color: #a1a1aa; font-size: 11px; text-transform: uppercase; letter-spacing: 0.1em; padding: 6px 0; font-weight: 700;">Email</td>
                                <td style="color: #18181b; font-size: 14px; padding: 6px 0;">${senderEmail}</td>
                            </tr>
                            ${subject ? `
                            <tr>
                                <td style="color: #a1a1aa; font-size: 11px; text-transform: uppercase; letter-spacing: 0.1em; padding: 6px 0; font-weight: 700;">Subjek</td>
                                <td style="color: #18181b; font-size: 14px; padding: 6px 0;">${subject}</td>
                            </tr>
                            ` : ''}
                        </table>
                    </div>

                    <div style="background: #fffbeb; border-left: 4px solid #fbbf24; border-radius: 4px; padding: 16px; margin-bottom: 24px;">
                        <p style="color: #92400e; font-size: 11px; text-transform: uppercase; letter-spacing: 0.1em; font-weight: 700; margin: 0 0 8px 0;">Pesan</p>
                        <p style="color: #3f3f46; font-size: 14px; line-height: 1.6; margin: 0; white-space: pre-wrap;">${message.length > 300 ? message.substring(0, 300) + '...' : message}</p>
                    </div>

                    <a href="${process.env.FRONTEND_URL || 'https://uni-verse-headless-cms.pages.dev'}/inquiries" 
                       style="display: inline-block; background: #18181b; color: #fbbf24; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-size: 13px; font-weight: 700; letter-spacing: 0.05em;">
                        Buka Dashboard CMS →
                    </a>
                </div>
                <div style="background: #f4f4f5; padding: 16px 32px; border-top: 1px solid #e4e4e7;">
                    <p style="color: #a1a1aa; font-size: 11px; margin: 0; text-align: center;">
                        Email ini dikirim otomatis oleh UNI-VERSE CMS. Balas email ini untuk merespon langsung ke pengirim.
                    </p>
                </div>
            </div>
        `
    };

    try {
        const info = await mailer.sendMail(mailOptions);
        console.log(`[EMAIL] ✓ Sent via SMTP to: ${adminEmail} (ID: ${info.messageId})`);
        return { success: true, messageId: info.messageId };
    } catch (err) {
        console.error(`[EMAIL] ✗ Failed to send via SMTP to ${adminEmail}:`, err.message);
        return { success: false, reason: err.message };
    }
};

const sendSuperAdminVerificationCode = async (adminEmail, code, purpose) => {
    const mailer = getTransporter();
    const fromAddress = process.env.EMAIL_FROM;
    if (!mailer || !fromAddress) return false;

    try {
        await mailer.sendMail({
            from: `"UNI-VERSE CMS" <${fromAddress}>`,
            to: adminEmail,
            subject: purpose === 'bootstrap' ? '[UNI-VERSE] Verifikasi akun Super Admin' : '[UNI-VERSE] Pemulihan akun Super Admin',
            text: `Kode verifikasi Anda: ${code}\n\nKode berlaku selama 10 menit. Jika Anda tidak meminta kode ini, abaikan email ini.`,
        });
        return true;
    } catch (error) {
        console.error('[EMAIL] Failed to send super admin verification code:', error.message);
        return false;
    }
};

module.exports = { sendInquiryNotification, sendSuperAdminVerificationCode };
