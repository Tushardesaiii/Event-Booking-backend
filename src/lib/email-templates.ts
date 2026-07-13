import { renderTemplate, getNestedValue } from './email/template-engine.js';
import { env } from '../config/env.js';

export interface TenantBranding {
  name?: string | null;
  logoUrl?: string | null;
  primaryColor?: string | null;
  website?: string | null;
}

export interface RenderedEmail {
  subject: string;
  htmlContent: string;
  textContent: string;
}

export interface TemplateDefinition {
  subject: string;
  html: string;
  text: string;
  requiredFields: string[];
}

export const BASE_HTML_LAYOUT = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="color-scheme" content="light">
  <meta name="supported-color-schemes" content="light">
  <title>{{subject}}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; margin: 0; padding: 0; background-color: #eef1f5; -webkit-font-smoothing: antialiased; }
    .wrapper { padding: 28px 12px; }
    .card { max-width: 600px; margin: 0 auto; background: #ffffff; border: 1px solid #e3e7ee; border-radius: 14px; overflow: hidden; }
    .header { padding: 22px 28px; background-color: #141026; }
    .header .brand { color: #ffffff; font-size: 18px; font-weight: 700; letter-spacing: 3px; text-transform: uppercase; }
    .header img { max-height: 30px; vertical-align: middle; }
    .content { padding: 32px 28px; color: #1f2937; font-size: 15px; line-height: 1.65; }
    .content h2 { margin: 0 0 12px; color: #0f172a; font-size: 20px; font-weight: 700; line-height: 1.3; }
    .content p { margin: 0 0 14px; color: #374151; }
    .content strong { color: #0f172a; }
    .muted { color: #64748b; font-size: 13px; }
    .footer { padding: 22px 28px; background-color: #f7f9fc; border-top: 1px solid #e8edf3; font-size: 12px; color: #94a3b8; line-height: 1.6; }
    .footer a { color: #6b7280; text-decoration: underline; }
    .btn { display: inline-block; padding: 13px 30px; margin: 10px 0; background-color: {{primaryColor}}; color: #ffffff !important; text-decoration: none; border-radius: 8px; font-weight: 700; font-size: 15px; text-align: center; }
    .code { display: inline-block; font-size: 30px; font-weight: 700; letter-spacing: 8px; color: #0f172a; background: #f4f1fd; border: 1px solid #e5dffb; border-radius: 10px; padding: 16px 26px; font-family: "SFMono-Regular", ui-monospace, Consolas, monospace; }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="card">
      <div class="header">
        {{#if logoUrl}}
          <img src="{{logoUrl}}" alt="{{tenantName}}" />
        {{/if}}
        <span class="brand">{{tenantName}}</span>
      </div>
      <div class="content">
        {{bodyHtml}}
      </div>
      <div class="footer">
        <p style="margin:0 0 6px;">This is an automated message from {{tenantName}}. Please keep it for your records.</p>
        <p style="margin:0;">
          <a href="{{website}}">Visit website</a>
          {{#if unsubscribeUrl}}
            &nbsp;&middot;&nbsp; <a href="{{unsubscribeUrl}}">Unsubscribe</a>
          {{/if}}
        </p>
      </div>
    </div>
  </div>
</body>
</html>
`;

export const TEMPLATE_REGISTRY: Record<string, TemplateDefinition> = {
  // Auth Templates
  'signup-verification': {
    subject: 'Confirm your sign up - {{tenantName}}',
    html: '<h2>Confirm your sign up</h2><p>Welcome to {{tenantName}}. Enter the code below to verify your account and finish setting things up.</p><div style="text-align:center;margin:26px 0;"><span class="code">{{otp}}</span></div><p>This code is valid for <strong>{{expiryMinutes}} minutes</strong>. Please do not share it with anyone.</p><p class="muted">If you did not try to sign up, you can safely ignore this email.</p>',
    text: 'Welcome to {{tenantName}}. Your sign-up verification code is {{otp}}. It is valid for {{expiryMinutes}} minutes. Do not share this code with anyone.',
    requiredFields: ['otp', 'expiryMinutes']
  },
  'email-verification': {
    subject: 'Verify your email address - {{tenantName}}',
    html: '<h2>Verify Your Email</h2><p>Please click the button below to verify your email address and activate your account:</p><div style="text-align: center;"><a class="btn" href="{{verificationLink}}">Verify Email</a></div><p>This link will expire in {{expiryHours}} hours. If the button doesn\'t work, copy this URL: <a href="{{verificationLink}}">{{verificationLink}}</a></p>',
    text: 'Hello, please verify your email address by visiting this link: {{verificationLink}}. This link will expire in {{expiryHours}} hours.',
    requiredFields: ['verificationLink', 'expiryHours']
  },
  'password-reset': {
    subject: 'Reset your password - {{tenantName}}',
    html: '<h2>Password Reset Request</h2><p>We received a request to reset your password. Click the button below to choose a new password:</p><div style="text-align: center;"><a class="btn" href="{{resetLink}}">Reset Password</a></div><p>This link will expire in {{expiryHours}} hours. If you did not request this, you can safely ignore this email.</p>',
    text: 'Hello, you can reset your password using this link: {{resetLink}}. This link will expire in {{expiryHours}} hours.',
    requiredFields: ['resetLink', 'expiryHours']
  },
  'otp-verification': {
    subject: 'Your {{tenantName}} verification code is {{otp}}',
    html: '<h2>Your verification code</h2><p>Use the code below to continue. It confirms that this is really you.</p><div style="text-align:center;margin:26px 0;"><span class="code">{{otp}}</span></div><p>This code is valid for <strong>{{expiryMinutes}} minutes</strong>. For your security, never share it with anyone — {{tenantName}} will never ask you for this code.</p><p class="muted">If you did not request this code, you can safely ignore this email.</p>',
    text: 'Your {{tenantName}} verification code is {{otp}}. It is valid for {{expiryMinutes}} minutes. Do not share this code with anyone. If you did not request it, you can ignore this email.',
    requiredFields: ['otp', 'purpose', 'expiryMinutes']
  },
  'login-alert': {
    subject: 'New login detected - {{tenantName}}',
    html: '<h2>New Login Alert</h2><p>We detected a new login to your account on {{loginTime}} from IP address {{ipAddress}} ({{userAgent}}).</p><p>If this was you, no action is needed. If you do not recognize this activity, please reset your password immediately.</p>',
    text: 'Hello, a new login was detected on {{loginTime}} from IP: {{ipAddress}}. If this was not you, change your password immediately.',
    requiredFields: ['loginTime', 'ipAddress', 'userAgent']
  },
  'security-alert': {
    subject: 'Security Alert: Suspicious activity detected',
    html: '<h2>Security Alert</h2><p>We noticed suspicious activity on your account. Details:</p><blockquote style="background: #f8fafc; padding: 12px; margin: 16px 0; border-left: 4px solid #d93025;">{{details}}</blockquote><p>As a precaution, please change your password or verify your settings immediately.</p>',
    text: 'Security Alert: Suspicious activity on your account. Details: {{details}}. Please check your settings.',
    requiredFields: ['details']
  },

  // Booking Lifecycle Templates
  'booking-pending': {
    subject: 'Booking Pending: {{event.title}}',
    html: '<h2>Booking Pending</h2><p>Your booking for <strong>{{event.title}}</strong> is currently being processed. Order Number: <strong>{{order.orderNumber}}</strong>.</p><p>We will notify you as soon as the transaction is confirmed.</p>',
    text: 'Your booking for {{event.title}} is pending. Order Number: {{order.orderNumber}}.',
    requiredFields: ['event.title', 'order.orderNumber']
  },
  'booking-created': {
    subject: 'Booking Created: {{event.title}}',
    html: '<h2>Booking Created</h2><p>Your booking for <strong>{{event.title}}</strong> has been created. Order Number: <strong>{{order.orderNumber}}</strong>.</p><p>Amount: {{order.totalAmount}} {{order.currency}}</p>',
    text: 'Your booking for {{event.title}} is created. Order Number: {{order.orderNumber}}.',
    requiredFields: ['event.title', 'order.orderNumber', 'order.totalAmount', 'order.currency']
  },
  'booking-confirmed': {
    subject: 'Booking confirmed - {{event.title}}',
    html: '<h2>Your booking is confirmed</h2><p>Your booking for <strong>{{event.title}}</strong> is confirmed. Here are the details:</p><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f7f9fc;border:1px solid #e8edf3;border-radius:10px;margin:18px 0;"><tr><td style="padding:14px 18px 4px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="padding:7px 0;color:#64748b;font-size:13px;">Order number</td><td style="padding:7px 0;text-align:right;color:#0f172a;font-size:14px;font-weight:600;font-family:ui-monospace,monospace;">{{order.orderNumber}}</td></tr><tr><td style="padding:7px 0;color:#64748b;font-size:13px;">When</td><td style="padding:7px 0;text-align:right;color:#0f172a;font-size:14px;font-weight:600;">{{event.startDate}}</td></tr><tr><td style="padding:7px 0 14px;color:#64748b;font-size:13px;">Where</td><td style="padding:7px 0 14px;text-align:right;color:#0f172a;font-size:14px;font-weight:600;">{{event.location}}</td></tr></table></td></tr></table><p>Open the app and go to <strong>My Tickets</strong> to view the QR code for entry. Please carry a valid photo ID.</p>',
    text: 'Your booking for {{event.title}} is confirmed. Order {{order.orderNumber}}. When: {{event.startDate}}. Where: {{event.location}}. Show your QR code from My Tickets at entry.',
    requiredFields: ['event.title', 'order.orderNumber', 'event.startDate', 'event.location']
  },
  'ticket-issued': {
    subject: 'Your tickets are ready - {{event.title}}',
    html: '<h2>Your tickets are ready</h2><p>Your tickets for <strong>{{event.title}}</strong> have been issued and are ready to use.</p><div style="text-align:center;margin:8px 0 18px;"><a class="btn" href="{{ticketLink}}">View your tickets</a></div><p class="muted">Order number: {{order.orderNumber}}. Show the QR code at the entrance and carry a valid photo ID.</p>',
    text: 'Your tickets for {{event.title}} are ready. View them here: {{ticketLink}} (Order {{order.orderNumber}}). Carry a valid photo ID at entry.',
    requiredFields: ['event.title', 'ticketLink', 'order.orderNumber']
  },
  'booking-cancelled': {
    subject: 'Booking Cancelled: {{event.title}}',
    html: '<h2>Booking Cancelled</h2><p>Your booking for <strong>{{event.title}}</strong> (Order: {{order.orderNumber}}) has been cancelled.</p><p>Reason: {{reason}}</p>',
    text: 'Your booking for {{event.title}} has been cancelled. Reason: {{reason}}.',
    requiredFields: ['event.title', 'order.orderNumber', 'reason']
  },
  'event-reminder': {
    subject: 'Reminder: {{event.title}} is starting soon',
    html: '<h2>Your event is coming up</h2><p><strong>{{event.title}}</strong> is taking place soon.</p><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:6px 0 4px;"><tr><td style="padding:6px 0;color:#64748b;font-size:13px;">When</td><td style="padding:6px 0;text-align:right;color:#0f172a;font-size:14px;font-weight:600;">{{event.startDate}}</td></tr><tr><td style="padding:6px 0;color:#64748b;font-size:13px;">Where</td><td style="padding:6px 0;text-align:right;color:#0f172a;font-size:14px;font-weight:600;">{{event.location}}</td></tr></table><div style="text-align:center;"><a class="btn" href="{{ticketLink}}">View ticket details</a></div>',
    text: 'Reminder: {{event.title}} is taking place on {{event.startDate}} at {{event.location}}.',
    requiredFields: ['event.title', 'event.startDate', 'event.location', 'ticketLink']
  },
  'event-reminder-24h': {
    subject: '24 Hour Reminder: {{event.title}}',
    html: '<h2>24 hours to go</h2><p><strong>{{event.title}}</strong> starts in 24 hours.</p><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:6px 0;"><tr><td style="padding:6px 0;color:#64748b;font-size:13px;">When</td><td style="padding:6px 0;text-align:right;color:#0f172a;font-size:14px;font-weight:600;">{{event.startDate}}</td></tr><tr><td style="padding:6px 0;color:#64748b;font-size:13px;">Where</td><td style="padding:6px 0;text-align:right;color:#0f172a;font-size:14px;font-weight:600;">{{event.location}}</td></tr></table><p class="muted">Have your ticket QR code ready and carry a valid photo ID.</p>',
    text: 'Reminder: {{event.title}} is starting in 24 hours ({{event.startDate}}) at {{event.location}}.',
    requiredFields: ['event.title', 'event.startDate', 'event.location']
  },
  'event-reminder-1h': {
    subject: 'Starting in 1 hour: {{event.title}}',
    html: '<h2>Starting in 1 hour</h2><p><strong>{{event.title}}</strong> starts in one hour and gates are now open.</p><p>Have your ticket QR code ready for check-in at the entrance, and carry a valid photo ID.</p>',
    text: '{{event.title}} starts in 1 hour. Gates are open — have your ticket QR code and a valid photo ID ready.',
    requiredFields: ['event.title']
  },
  'event-updated': {
    subject: 'Important: Event details updated - {{event.title}}',
    html: '<h2>Event Details Updated</h2><p>There have been updates to <strong>{{event.title}}</strong>:</p><blockquote style="background: #f1f3f5; padding: 12px; border-left: 4px solid {{primaryColor}};">{{changeSummary}}</blockquote><p>Please review the updated tickets or times on our portal.</p>',
    text: 'Important: Details of {{event.title}} have been updated: {{changeSummary}}.',
    requiredFields: ['event.title', 'changeSummary']
  },
  'event-cancelled': {
    subject: 'Cancelled: {{event.title}}',
    html: '<h2>Event Cancelled</h2><p>We regret to inform you that <strong>{{event.title}}</strong> has been cancelled.</p><p>Reason: {{reason}}</p><p>Refund processes will be initiated automatically.</p>',
    text: 'We regret to inform you that {{event.title}} has been cancelled due to: {{reason}}.',
    requiredFields: ['event.title', 'reason']
  },
  'event-completed': {
    subject: 'Thank you for attending {{event.title}}',
    html: '<h2>Thank you for attending</h2><p>Thank you for attending <strong>{{event.title}}</strong>. We hope you had a great experience.</p><p>We would love your feedback — you can share a review from the app at any time.</p>',
    text: 'Thank you for attending {{event.title}}. We hope you enjoyed it. Share your feedback anytime from the app.',
    requiredFields: ['event.title']
  },

  // Financial Templates
  'payment-success': {
    subject: 'Payment receipt - Order {{order.orderNumber}}',
    html: '<h2>Payment received</h2><p>We have received your payment. Your booking is now confirmed.</p><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f7f9fc;border:1px solid #e8edf3;border-radius:10px;margin:18px 0;"><tr><td style="padding:14px 18px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="padding:7px 0;color:#64748b;font-size:13px;">Order number</td><td style="padding:7px 0;text-align:right;color:#0f172a;font-size:14px;font-weight:600;font-family:ui-monospace,monospace;">{{order.orderNumber}}</td></tr><tr><td style="padding:7px 0;color:#64748b;font-size:13px;">Amount paid</td><td style="padding:7px 0;text-align:right;color:#0f172a;font-size:15px;font-weight:700;">{{order.totalAmount}} {{order.currency}}</td></tr></table></td></tr></table><p class="muted">This email is your payment receipt. No further action is needed.</p>',
    text: 'Payment received: {{order.totalAmount}} {{order.currency}} for order {{order.orderNumber}}. Your booking is confirmed. This is your receipt.',
    requiredFields: ['order.orderNumber', 'order.totalAmount', 'order.currency']
  },
  'payment-failed': {
    subject: 'Payment Failed - Order #{{order.orderNumber}}',
    html: '<h2>Payment Failed</h2><p>Your payment attempt for order #{{order.orderNumber}} could not be processed.</p><p>Failure Reason: {{reason}}</p><p>Please retry checking out to secure your tickets.</p>',
    text: 'Payment failed for order #{{order.orderNumber}}. Reason: {{reason}}.',
    requiredFields: ['order.orderNumber', 'reason']
  },
  'refund-initiated': {
    subject: 'Refund Initiated - Order #{{order.orderNumber}}',
    html: '<h2>Refund Initiated</h2><p>A refund of <strong>{{amount}} {{currency}}</strong> has been initiated for your order #{{order.orderNumber}}.</p><p>It should reflect in your account within 5-7 business days.</p>',
    text: 'A refund of {{amount}} {{currency}} has been initiated for order #{{order.orderNumber}}.',
    requiredFields: ['order.orderNumber', 'amount', 'currency']
  },
  'refund-completed': {
    subject: 'Refund Processed - Order #{{order.orderNumber}}',
    html: '<h2>Refund Completed</h2><p>Your refund of <strong>{{amount}} {{currency}}</strong> for order #{{order.orderNumber}} has been successfully processed.</p>',
    text: 'Refund completed: {{amount}} {{currency}} for order #{{order.orderNumber}}.',
    requiredFields: ['order.orderNumber', 'amount', 'currency']
  },
  'withdrawal-submitted': {
    subject: 'Withdrawal Request Submitted',
    html: '<h2>Withdrawal Request</h2><p>We received your request to withdraw <strong>{{amount}} {{currency}}</strong>. It is currently under review by our finance team.</p>',
    text: 'Withdrawal request submitted for {{amount}} {{currency}}.',
    requiredFields: ['amount', 'currency']
  },
  'withdrawal-approved': {
    subject: 'Withdrawal Approved',
    html: '<h2>Withdrawal Request Approved</h2><p>Your withdrawal request for <strong>{{amount}} {{currency}}</strong> has been approved and processed.</p>',
    text: 'Your withdrawal request for {{amount}} {{currency}} was approved.',
    requiredFields: ['amount', 'currency']
  },
  'withdrawal-rejected': {
    subject: 'Withdrawal Declined',
    html: '<h2>Withdrawal Request Declined</h2><p>Your withdrawal request for <strong>{{amount}} {{currency}}</strong> has been declined.</p><p>Reason: {{reason}}</p>',
    text: 'Your withdrawal request for {{amount}} {{currency}} was declined. Reason: {{reason}}.',
    requiredFields: ['amount', 'currency', 'reason']
  },
  'settlement-completed': {
    subject: 'Settlement Completed',
    html: '<h2>Settlement Completed</h2><p>A payout settlement of <strong>{{amount}} {{currency}}</strong> has been completed for your organizer account.</p>',
    text: 'Settlement of {{amount}} {{currency}} has been completed.',
    requiredFields: ['amount', 'currency']
  },

  // Organizer Templates
  'organizer-approved': {
    subject: 'Your organizer account is approved - {{tenantName}}',
    html: '<h2>Your organizer account is approved</h2><p>You can now create events, publish tickets, and manage sales from your dashboard.</p><div style="text-align:center;"><a class="btn" href="{{dashboardLink}}">Go to dashboard</a></div>',
    text: 'Your organizer account has been approved. Go to your dashboard here: {{dashboardLink}}',
    requiredFields: ['dashboardLink']
  },
  'organizer-rejected': {
    subject: 'Organizer application update',
    html: '<h2>Application Declined</h2><p>Your organizer application could not be approved at this time.</p><p>Feedback: {{reason}}</p>',
    text: 'Your organizer application was declined. Reason: {{reason}}',
    requiredFields: ['reason']
  },
  'kyc-approved': {
    subject: 'KYC Verification Successful',
    html: '<h2>KYC Approved</h2><p>Your identity verification documents have been successfully verified. Your payout capabilities are now active.</p>',
    text: 'Your KYC documents have been verified.',
    requiredFields: []
  },
  'kyc-rejected': {
    subject: 'KYC Action Required',
    html: '<h2>KYC Declined</h2><p>Your identity verification documents were declined.</p><p>Reason: {{reason}}</p><p>Please upload valid documents on the portal to avoid withdrawal suspension.</p>',
    text: 'Your KYC verification was declined. Reason: {{reason}}.',
    requiredFields: ['reason']
  },

  // Platform Templates
  'welcome-email': {
    subject: 'Welcome to {{tenantName}}',
    html: '<h2>Welcome to {{tenantName}}</h2><p>Your account is ready. Browse events, book tickets, and manage everything from one place.</p><p>If you need anything, simply reply to this email — our team is happy to help.</p>',
    text: 'Welcome to {{tenantName}}. Your account is ready — browse events and book tickets anytime.',
    requiredFields: []
  },
  'invitation-email': {
    subject: 'You have been invited to join {{tenantName}}',
    html: '<h2>Team Invitation</h2><p>You have been invited to join {{tenantName}} as a team member.</p><div style="text-align: center;"><a class="btn" href="{{inviteLink}}">Accept Invitation</a></div><p>This invitation will expire in 7 days.</p>',
    text: 'You have been invited to join {{tenantName}}. Accept invitation here: {{inviteLink}}',
    requiredFields: ['inviteLink']
  },
  'tenant-invitation': {
    subject: 'Join {{tenantName}} organization',
    html: '<h2>Organization Invitation</h2><p>You have been invited to collaborate with <strong>{{tenantName}}</strong>.</p><div style="text-align: center;"><a class="btn" href="{{inviteLink}}">Accept Organization Invite</a></div>',
    text: 'Join {{tenantName}} organization by clicking: {{inviteLink}}',
    requiredFields: ['inviteLink']
  },
  'membership-added': {
    subject: 'Organization membership added',
    html: '<h2>Membership Confirmed</h2><p>You have been successfully added to organization <strong>{{tenantName}}</strong> as <strong>{{role}}</strong>.</p>',
    text: 'You have been added to organization {{tenantName}} with role {{role}}.',
    requiredFields: ['role']
  },
  'account-suspended': {
    subject: 'Account Suspended - Action Required',
    html: '<h2>Account Suspended</h2><p>Your account has been temporarily suspended due to a policy violation or outstanding action.</p><p>Details: {{reason}}</p><p>Please contact support to resolve this issue.</p>',
    text: 'Your account was suspended. Reason: {{reason}}.',
    requiredFields: ['reason']
  },
  'account-reactivated': {
    subject: 'Account Reactivated',
    html: '<h2>Account Reactivated</h2><p>Your account has been successfully reactivated. You can login and access all features now.</p>',
    text: 'Your account has been reactivated.',
    requiredFields: []
  },

  // Marketing Templates
  'newsletter': {
    subject: '{{newsletter.title}} - {{tenantName}}',
    html: '<h2>{{newsletter.title}}</h2><div>{{newsletter.bodyHtml}}</div>',
    text: '{{newsletter.title}}:\n\n{{newsletter.text}}',
    requiredFields: ['newsletter.title', 'newsletter.bodyHtml', 'newsletter.text']
  },
  'promotional-campaign': {
    subject: '{{promo.title}}',
    html: '<h2>{{promo.title}}</h2><p>{{promo.description}}</p><div style="text-align: center;"><a class="btn" href="{{promo.link}}">{{promo.ctaText}}</a></div>',
    text: '{{promo.title}}: {{promo.description}}. Visit: {{promo.link}}',
    requiredFields: ['promo.title', 'promo.description', 'promo.link', 'promo.ctaText']
  },
  'product-updates': {
    subject: 'New updates on {{tenantName}}',
    html: '<h2>Product Updates</h2><div>{{updatesHtml}}</div>',
    text: 'New product updates are live on {{tenantName}}.',
    requiredFields: ['updatesHtml']
  },
  'event-promotions': {
    subject: 'Featured Events - {{tenantName}}',
    html: '<h2>Featured Events for You</h2><div>{{promotedEventsHtml}}</div>',
    text: 'Check out the featured events on {{tenantName}}.',
    requiredFields: ['promotedEventsHtml']
  }
};

/**
 * Validates that all required placeholders exist in the context object.
 * Prevents missing variable runtime failures.
 */
export function validateTemplateVariables(templateKey: string, context: Record<string, any>): void {
  const definition = TEMPLATE_REGISTRY[templateKey];
  if (!definition) {
    throw new Error(`Template key '${templateKey}' is not registered in the Template Registry.`);
  }

  const missingFields: string[] = [];
  for (const field of definition.requiredFields) {
    const val = getNestedValue(context, field);
    if (val === undefined || val === null || val === '') {
      missingFields.push(field);
    }
  }

  if (missingFields.length > 0) {
    throw new Error(`Email template variable validation failed for template '${templateKey}'. Missing required fields: ${missingFields.join(', ')}`);
  }
}

/**
 * Compiles a template from the registry into standard subject, HTML, and text fallback
 */
export function renderEmail(
  templateKey: string,
  variables: Record<string, any>,
  branding?: TenantBranding | null
): RenderedEmail {
  // Validate variables first before processing
  validateTemplateVariables(templateKey, variables);

  const definition = TEMPLATE_REGISTRY[templateKey];

  const resolvedBranding = {
    tenantName: branding?.name || 'Event Platform',
    logoUrl: branding?.logoUrl || '',
    primaryColor: branding?.primaryColor || '#4F46E5',
    website: branding?.website || '#'
  };

  const context = {
    ...variables,
    ...resolvedBranding
  };

  const subject = renderTemplate(definition.subject, context);
  const textContent = renderTemplate(definition.text, context);
  const bodyHtml = renderTemplate(definition.html, context);

  let htmlContent = BASE_HTML_LAYOUT
    .replace('{{bodyHtml}}', bodyHtml)
    .replaceAll('{{primaryColor}}', resolvedBranding.primaryColor)
    .replaceAll('{{tenantName}}', resolvedBranding.tenantName)
    .replaceAll('{{website}}', resolvedBranding.website)
    .replaceAll('{{subject}}', subject);

  if (resolvedBranding.logoUrl) {
    htmlContent = htmlContent
      .replace('{{#if logoUrl}}', '')
      .replace('{{/if}}', '')
      .replace('{{logoUrl}}', resolvedBranding.logoUrl);
  } else {
    htmlContent = htmlContent.replace(/\{\{#if logoUrl\}\}[\s\S]*?\{\{\/if\}\}/g, '');
  }

  if (variables.unsubscribeUrl) {
    htmlContent = htmlContent
      .replace('{{#if unsubscribeUrl}}', '')
      .replace('{{/if}}', '')
      .replace('{{unsubscribeUrl}}', variables.unsubscribeUrl);
  } else {
    htmlContent = htmlContent.replace(/\{\{#if unsubscribeUrl\}\}[\s\S]*?\{\{\/if\}\}/g, '');
  }

  return {
    subject,
    htmlContent,
    textContent
  };
}
