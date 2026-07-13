import { renderTemplate } from './template-engine.js';

export interface TenantBranding {
  name?: string | null;
  logoUrl?: string | null;
  primaryColor?: string | null;
  website?: string | null;
}

export interface RenderedTemplate {
  subject: string;
  htmlContent: string;
  textContent: string;
}

const BASE_HTML_LAYOUT = `
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
    .content h3 { margin: 0 0 8px; color: #0f172a; font-size: 16px; font-weight: 700; }
    .content p { margin: 0 0 14px; color: #374151; }
    .content strong { color: #0f172a; }
    .muted { color: #64748b; font-size: 13px; }
    .panel { background: #f7f9fc; border: 1px solid #e8edf3; border-radius: 10px; padding: 16px 18px; margin: 18px 0; }
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

const TEMPLATE_DEFINITIONS: Record<
  string,
  { subject: string; html: string; text: string }
> = {
  'welcome-email': {
    subject: "Welcome to {{tenantName}}",
    html: `
      <h2>Welcome to {{tenantName}}</h2>
      <p>Hi {{user.fullName | 'there'}}, your account is ready. You can now browse events, book tickets, and manage everything from one place.</p>
      <p>If you have any questions, simply reply to this email — our team is happy to help.</p>
    `,
    text: "Hi {{user.fullName}}, welcome to {{tenantName}}. Your account is ready — you can now browse events and book tickets."
  },
  'email-verification': {
    subject: "Verify your email address - {{tenantName}}",
    html: `
      <h2>Verify your email address</h2>
      <p>Confirm this email address to activate your {{tenantName}} account. This link is valid for <strong>{{expiryHours}} hours</strong>.</p>
      <div style="text-align: center;">
        <a class="btn" href="{{verificationLink}}">Verify email address</a>
      </div>
      <p class="muted">If the button does not work, copy and paste this link into your browser:<br/><a href="{{verificationLink}}" style="color:#6b7280;">{{verificationLink}}</a></p>
      <p class="muted">If you did not create this account, you can safely ignore this email.</p>
    `,
    text: "Verify your {{tenantName}} email address: {{verificationLink}} (valid for {{expiryHours}} hours). If you did not create this account, ignore this email."
  },
  'otp-code': {
    subject: "Your {{tenantName}} verification code is {{otp}}",
    html: `
      <h2>Your verification code</h2>
      <p>Use the code below to continue. It confirms that this is really you.</p>
      <div style="text-align: center; margin: 26px 0;">
        <span class="code">{{otp}}</span>
      </div>
      <p>This code is valid for <strong>{{expiryMinutes}} minutes</strong>. For your security, never share it with anyone — {{tenantName}} will never ask you for this code.</p>
      <p class="muted">If you did not request this code, you can safely ignore this email.</p>
    `,
    text: "Your {{tenantName}} verification code is {{otp}}. It is valid for {{expiryMinutes}} minutes. Do not share this code with anyone."
  },
  'event-announcement': {
    subject: "New event: {{event.title}}",
    html: `
      <h2>A new event you might like</h2>
      <p>A new event is now live on {{tenantName}}.</p>
      <div class="panel">
        <h3>{{event.title}}</h3>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
          <tr><td style="padding:5px 0;color:#64748b;font-size:13px;">When</td><td style="padding:5px 0;text-align:right;color:#0f172a;font-size:14px;font-weight:600;">{{event.startDate}}</td></tr>
          <tr><td style="padding:5px 0;color:#64748b;font-size:13px;">Where</td><td style="padding:5px 0;text-align:right;color:#0f172a;font-size:14px;font-weight:600;">{{event.location}}</td></tr>
        </table>
      </div>
      <p>{{event.description}}</p>
      <div style="text-align: center;">
        <a class="btn" href="{{eventLink}}">View event</a>
      </div>
    `,
    text: "New event on {{tenantName}}: {{event.title}} on {{event.startDate}} at {{event.location}}. View it here: {{eventLink}}"
  },
  'event-reminder': {
    subject: "Reminder: {{event.title}}",
    html: `
      <h2>Your event is coming up</h2>
      <p>A quick reminder about your upcoming event. Here are the details:</p>
      <div class="panel">
        <h3>{{event.title}}</h3>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
          <tr><td style="padding:5px 0;color:#64748b;font-size:13px;">When</td><td style="padding:5px 0;text-align:right;color:#0f172a;font-size:14px;font-weight:600;">{{event.startDate}}</td></tr>
          <tr><td style="padding:5px 0;color:#64748b;font-size:13px;">Where</td><td style="padding:5px 0;text-align:right;color:#0f172a;font-size:14px;font-weight:600;">{{event.location}}</td></tr>
        </table>
      </div>
      <p>Have your ticket QR code ready for check-in at the gate, and carry a valid photo ID.</p>
      <div style="text-align: center;">
        <a class="btn" href="{{ticketLink}}">View ticket</a>
      </div>
    `,
    text: "Reminder: {{event.title}} on {{event.startDate}} at {{event.location}}. View your ticket: {{ticketLink}}. Carry a valid photo ID."
  },
  'newsletter': {
    subject: "{{newsletter.title}} - {{tenantName}}",
    html: `
      <h2>{{newsletter.title}}</h2>
      <div>{{newsletter.bodyHtml}}</div>
    `,
    text: "{{newsletter.title}}:\n\n{{newsletter.text}}"
  }
};

export function renderEmailTemplate(
  templateType: string,
  variables: Record<string, any>,
  branding?: TenantBranding | null
): RenderedTemplate {
  const def = TEMPLATE_DEFINITIONS[templateType];
  if (!def) {
    throw new Error(`Email template '${templateType}' is not defined.`);
  }

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

  const subject = renderTemplate(def.subject, context);
  const textContent = renderTemplate(def.text, context);
  const bodyHtml = renderTemplate(def.html, context);

  let htmlContent = BASE_HTML_LAYOUT
    .replace('{{bodyHtml}}', bodyHtml)
    .replaceAll('{{primaryColor}}', resolvedBranding.primaryColor)
    .replaceAll('{{tenantName}}', resolvedBranding.tenantName)
    .replaceAll('{{website}}', resolvedBranding.website)
    .replaceAll('{{subject}}', subject);

  if (resolvedBranding.logoUrl) {
    htmlContent = htmlContent.replace('{{#if logoUrl}}', '').replace('{{/if}}', '').replace('{{logoUrl}}', resolvedBranding.logoUrl);
  } else {
    htmlContent = htmlContent.replace(/\{\{#if logoUrl\}\}[\s\S]*?\{\{\/if\}\}/g, '');
  }

  // Handle optional unsubscribe url
  if (variables.unsubscribeUrl) {
    htmlContent = htmlContent.replace('{{#if unsubscribeUrl}}', '').replace('{{/if}}', '').replace('{{unsubscribeUrl}}', variables.unsubscribeUrl);
  } else {
    htmlContent = htmlContent.replace(/\{\{#if unsubscribeUrl\}\}[\s\S]*?\{\{\/if\}\}/g, '');
  }

  return {
    subject,
    htmlContent,
    textContent
  };
}
