// Post-payment confirmation notifications for the consumer (mobile) flow.
//
// Fired (fire-and-forget) from POST /consumer/payments/verify once a payment is
// confirmed and tickets are issued. Sends:
//   • an SMS to the buyer's phone (Twilio) with the key booking details, and
//   • a formatted HTML email (Brevo, via the outbox queue) IF a delivery email
//     was captured at checkout (phone-OTP consumers have no email on file).
//
// Never throws — notification failure must not affect the payment outcome.

import { twilioService } from '../../lib/twilio.js';
import { sendBrevoEmail } from '../../lib/email/providers/brevo/client.js';
import { logger } from '../../lib/logger.js';
import { getPublicEventService } from '../public/service.js';
import { getConsumerBooking } from './service.js';
import { listUserTickets, getUserById } from './repository.js';

interface TicketRow {
  ticketNumber: string;
  ticketTypeName: string | null;
  qrCodeToken: string | null;
  unitPrice: string | number | null;
  currency: string | null;
}

function formatMoney(amount: string | number | null | undefined, currency = 'INR'): string {
  const n = Number(amount ?? 0);
  const symbol = currency === 'INR' ? '₹' : `${currency} `;
  return `${symbol}${n.toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

function formatEventDate(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('en-IN', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

function buildSms(params: {
  eventTitle: string;
  dateLabel: string;
  venueLabel: string;
  passSummary: string;
  orderNumber: string;
  amountLabel: string;
  firstTicketNumber: string;
}): string {
  // Plain, scannable, no decorative characters — reads cleanly on every handset.
  const lines = [
    'REVELIS — Booking confirmed',
    params.eventTitle,
    params.dateLabel ? `When: ${params.dateLabel}` : '',
    params.venueLabel ? `Where: ${params.venueLabel}` : '',
    params.passSummary ? `Tickets: ${params.passSummary}` : '',
    `Order ${params.orderNumber}  |  Paid ${params.amountLabel}`,
    params.firstTicketNumber ? `Ticket no. ${params.firstTicketNumber}` : '',
    'Show your QR code in the Revelis app (My Tickets) at the entrance. Please carry a valid photo ID.',
  ];
  return lines.filter(Boolean).join('\n');
}

// A single label/value row in the summary tables.
function infoRow(label: string, value: string, opts?: { strong?: boolean; mono?: boolean }): string {
  const valueStyle = [
    'padding:8px 0',
    'text-align:right',
    `color:${opts?.strong ? '#0f172a' : '#1f2937'}`,
    `font-size:${opts?.strong ? '15px' : '14px'}`,
    `font-weight:${opts?.strong ? '700' : '600'}`,
    opts?.mono ? "font-family:'SFMono-Regular',ui-monospace,Consolas,monospace;letter-spacing:0.4px" : '',
  ]
    .filter(Boolean)
    .join(';');
  return `
        <tr>
          <td style="padding:8px 0;color:#64748b;font-size:13px;vertical-align:top;">${label}</td>
          <td style="${valueStyle}">${value}</td>
        </tr>`;
}

function buildEmailHtml(params: {
  name: string;
  eventTitle: string;
  dateLabel: string;
  venueLabel: string;
  orderNumber: string;
  amountLabel: string;
  tickets: TicketRow[];
}): string {
  const ticketRows = params.tickets
    .map(
      (t, i) => `
        <tr>
          <td style="padding:13px 18px;${i === 0 ? '' : 'border-top:1px solid #eef0f4;'}color:#0f172a;font-size:14px;font-weight:600;">
            ${t.ticketTypeName ?? 'Pass'}
          </td>
          <td style="padding:13px 18px;${i === 0 ? '' : 'border-top:1px solid #eef0f4;'}color:#475569;font-size:13px;font-family:'SFMono-Regular',ui-monospace,Consolas,monospace;letter-spacing:0.4px;text-align:right;">
            ${t.ticketNumber}
          </td>
        </tr>`,
    )
    .join('');

  const preheader = `Your tickets for ${params.eventTitle} are confirmed. Order ${params.orderNumber}.`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="color-scheme" content="light" />
  <title>Booking confirmed</title>
</head>
<body style="margin:0;padding:0;background:#eef1f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased;">
  <span style="display:none!important;visibility:hidden;opacity:0;height:0;width:0;overflow:hidden;mso-hide:all;">${preheader}</span>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef1f5;padding:24px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #e3e7ee;">

          <!-- Brand bar -->
          <tr>
            <td style="background:#141026;padding:22px 28px;">
              <span style="color:#ffffff;font-size:18px;font-weight:700;letter-spacing:3px;">REVELIS</span>
              <span style="color:#9aa0b5;font-size:12px;letter-spacing:1px;float:right;padding-top:4px;">TICKETS &amp; EXPERIENCES</span>
            </td>
          </tr>

          <!-- Status + heading -->
          <tr>
            <td style="padding:30px 28px 6px;">
              <p style="margin:0 0 8px;color:#0f9d58;font-size:12px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;">Booking confirmed</p>
              <h1 style="margin:0 0 10px;color:#0f172a;font-size:23px;line-height:1.3;font-weight:700;">You're going to ${params.eventTitle}</h1>
              <p style="margin:0;color:#475569;font-size:14px;line-height:1.6;">Hi ${params.name}, your payment was successful and your tickets are confirmed. Everything you need is below — please keep this email for your records.</p>
            </td>
          </tr>

          <!-- Event details -->
          <tr>
            <td style="padding:22px 28px 6px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f7f9fc;border:1px solid #e8edf3;border-radius:10px;">
                <tr><td style="padding:16px 18px 4px;">
                  <p style="margin:0 0 12px;color:#94a3b8;font-size:11px;font-weight:700;letter-spacing:1px;text-transform:uppercase;">Event details</p>
                  <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                    ${params.dateLabel ? infoRow('When', params.dateLabel) : ''}
                    ${params.venueLabel ? infoRow('Where', params.venueLabel) : ''}
                  </table>
                  <div style="height:6px;"></div>
                </td></tr>
              </table>
            </td>
          </tr>

          <!-- Tickets -->
          <tr>
            <td style="padding:18px 28px 6px;">
              <p style="margin:0 0 10px;color:#94a3b8;font-size:11px;font-weight:700;letter-spacing:1px;text-transform:uppercase;">Your tickets</p>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e8edf3;border-radius:10px;overflow:hidden;">
                <tr style="background:#f7f9fc;">
                  <th align="left" style="padding:10px 18px;color:#64748b;font-size:11px;font-weight:700;letter-spacing:0.5px;text-transform:uppercase;">Pass</th>
                  <th align="right" style="padding:10px 18px;color:#64748b;font-size:11px;font-weight:700;letter-spacing:0.5px;text-transform:uppercase;">Ticket number</th>
                </tr>
                ${ticketRows}
              </table>
            </td>
          </tr>

          <!-- Payment summary -->
          <tr>
            <td style="padding:18px 28px 6px;">
              <p style="margin:0 0 6px;color:#94a3b8;font-size:11px;font-weight:700;letter-spacing:1px;text-transform:uppercase;">Payment summary</p>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                ${infoRow('Order number', params.orderNumber, { mono: true })}
                ${infoRow('Amount paid', params.amountLabel, { strong: true })}
              </table>
            </td>
          </tr>

          <!-- Entry instructions -->
          <tr>
            <td style="padding:18px 28px 8px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1eefb;border:1px solid #e2dbf6;border-radius:10px;">
                <tr><td style="padding:16px 18px;">
                  <p style="margin:0 0 10px;color:#4c1d95;font-size:13px;font-weight:700;">At the venue</p>
                  <p style="margin:0 0 6px;color:#3b3563;font-size:13px;line-height:1.6;">1.&nbsp;&nbsp;Open the Revelis app and go to My Tickets.</p>
                  <p style="margin:0 0 6px;color:#3b3563;font-size:13px;line-height:1.6;">2.&nbsp;&nbsp;Show the QR code for this booking at the entrance gate.</p>
                  <p style="margin:0;color:#3b3563;font-size:13px;line-height:1.6;">3.&nbsp;&nbsp;Carry a valid government photo ID — it may be checked at entry.</p>
                </td></tr>
              </table>
            </td>
          </tr>

          <!-- Support -->
          <tr>
            <td style="padding:8px 28px 26px;">
              <p style="margin:0;color:#64748b;font-size:13px;line-height:1.6;">Questions about your booking? Simply reply to this email and our support team will be glad to help.</p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:20px 28px;background:#f7f9fc;border-top:1px solid #e8edf3;">
              <p style="margin:0 0 4px;color:#94a3b8;font-size:12px;line-height:1.6;">This is a transactional receipt for your Revelis booking. Tickets are subject to the organizer's entry and refund policies.</p>
              <p style="margin:0;color:#b0b8c5;font-size:12px;">&copy; Revelis. All rights reserved.</p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

export async function sendBookingConfirmation(
  userId: string,
  bookingOrderId: string,
  contactEmail?: string | null,
): Promise<void> {
  try {
    const [booking, tickets, user] = await Promise.all([
      getConsumerBooking(userId, bookingOrderId).catch(() => null),
      listUserTickets(userId, bookingOrderId).catch(() => [] as TicketRow[]),
      getUserById(userId).catch(() => null),
    ]);

    if (!booking) {
      logger.warn('[confirmation-notify] booking not found, skipping', { userId, bookingOrderId });
      return;
    }

    const eventTitle = (booking as any).eventTitle ?? 'Your event';
    const orderNumber = (booking as any).orderNumber ?? bookingOrderId;
    const currency = (booking as any).currency ?? 'INR';
    const amountLabel = formatMoney((booking as any).totalAmount, currency);

    // Enrich with venue/date (best-effort).
    let dateLabel = '';
    let venueLabel = '';
    try {
      const event = await getPublicEventService((booking as any).eventId);
      dateLabel = formatEventDate(event?.startDateTime);
      if (event?.venue) {
        venueLabel = [event.venue.name, event.venue.city].filter(Boolean).join(', ');
      }
    } catch {
      // Non-fatal — messages still go out without venue/date.
    }

    const ticketList = (tickets as TicketRow[]) ?? [];
    const passCounts = new Map<string, number>();
    for (const t of ticketList) {
      const key = t.ticketTypeName ?? 'Pass';
      passCounts.set(key, (passCounts.get(key) ?? 0) + 1);
    }
    const passSummary = Array.from(passCounts.entries())
      .map(([name, qty]) => `${name}${qty > 1 ? ` x${qty}` : ''}`)
      .join(', ');
    const firstTicketNumber = ticketList[0]?.ticketNumber ?? '';
    const buyerName = (user as any)?.fullName && (user as any).fullName !== 'Guest' ? (user as any).fullName : 'there';
    const phone = (user as any)?.phoneNumber as string | undefined;

    // --- SMS (to the buyer's phone) ---
    if (phone) {
      const smsBody = buildSms({ eventTitle, dateLabel, venueLabel, passSummary, orderNumber, amountLabel, firstTicketNumber });
      twilioService
        .sendSms(phone, smsBody)
        .then(() => logger.info('[confirmation-notify] SMS dispatched', { bookingOrderId }))
        .catch((err) => logger.error('[confirmation-notify] SMS failed', { bookingOrderId, error: err?.message }));
    }

    // --- Email (only if a delivery address was captured at checkout) ---
    const email = (contactEmail ?? '').trim();
    if (email && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      const html = buildEmailHtml({
        name: buyerName,
        eventTitle,
        dateLabel,
        venueLabel,
        orderNumber,
        amountLabel,
        tickets: ticketList,
      });
      const textContent = buildSms({ eventTitle, dateLabel, venueLabel, passSummary, orderNumber, amountLabel, firstTicketNumber });
      // Send the transactional confirmation directly via Brevo (immediate, with a
      // verified sender) rather than the QStash-backed outbox, which can't be
      // reached on localhost in dev.
      sendBrevoEmail({
        to: [{ email }],
        subject: `Booking confirmed — ${eventTitle} (Order ${orderNumber})`,
        htmlContent: html,
        textContent,
      })
        .then((r) => logger.info('[confirmation-notify] email sent', { bookingOrderId, email, messageId: r?.messageId }))
        .catch((err) => logger.error('[confirmation-notify] email failed', { bookingOrderId, error: err?.message }));
    }
  } catch (err: any) {
    logger.error('[confirmation-notify] unexpected failure', { userId, bookingOrderId, error: err?.message });
  }
}
