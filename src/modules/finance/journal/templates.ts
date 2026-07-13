import type { EntryInput, FinanceAccountType } from '../types.js';

export interface PaymentCaptureTemplateInput {
  amount: number; // in minor units
  currency: string;
}

export interface SettlementTemplateInput {
  grossAmount: number;
  platformFee: number;
  tax: number;
  netOrganizerShare: number;
  organizerId: string;
}

export interface RefundTemplateInput {
  refundAmount: number;
  organizerId?: string;
  isSettled: boolean;
  platformFeeRefund?: number;
  taxRefund?: number;
  netOrganizerRefund?: number;
}

export interface WithdrawalTemplateInput {
  amount: number;
  organizerId: string;
}

export const JournalTemplates = {
  /**
   * Payment Capture Template
   * Debit Platform Cash (PAYMENT_GATEWAY_CLEARING or PLATFORM_CASH)
   * Credit Escrow (PLATFORM_ESCROW or ESCROW)
   */
  paymentCapture(input: PaymentCaptureTemplateInput, useLegacy = true): EntryInput[] {
    const cashType: FinanceAccountType = useLegacy ? 'PAYMENT_GATEWAY_CLEARING' : 'PLATFORM_CASH';
    const escrowType: FinanceAccountType = useLegacy ? 'PLATFORM_ESCROW' : 'ESCROW';

    return [
      {
        accountType: cashType,
        accountName: 'Platform Cash Clearing',
        amount: input.amount,
        direction: 'debit'
      },
      {
        accountType: escrowType,
        accountName: 'Platform Escrow Custody',
        amount: input.amount,
        direction: 'credit'
      }
    ];
  },

  /**
   * Settlement Split Template
   * Debit Escrow (PLATFORM_ESCROW or ESCROW)
   * Credit Platform Revenue (PLATFORM_REVENUE or PLATFORM_FEE_REVENUE)
   * Credit Tax Payable (TAX_PAYABLE)
   * Credit Organizer Pending/Available (ORGANIZER_BALANCE or ORGANIZER_AVAILABLE)
   */
  settlement(input: SettlementTemplateInput, useLegacy = true): EntryInput[] {
    const escrowType: FinanceAccountType = useLegacy ? 'PLATFORM_ESCROW' : 'ESCROW';
    const revenueType: FinanceAccountType = useLegacy ? 'PLATFORM_REVENUE' : 'PLATFORM_FEE_REVENUE';
    const organizerType: FinanceAccountType = useLegacy ? 'ORGANIZER_BALANCE' : 'ORGANIZER_AVAILABLE';

    return [
      {
        accountType: escrowType,
        accountName: 'Platform Escrow Custody',
        amount: input.grossAmount,
        direction: 'debit'
      },
      {
        accountType: revenueType,
        accountName: 'Platform Commission Revenue',
        amount: input.platformFee,
        direction: 'credit'
      },
      {
        accountType: 'TAX_PAYABLE',
        accountName: 'Tax Liabilities (GST/VAT)',
        amount: input.tax,
        direction: 'credit'
      },
      {
        accountType: organizerType,
        accountName: `Organizer Available: ${input.organizerId}`,
        amount: input.netOrganizerShare,
        direction: 'credit',
        metadata: { organizerId: input.organizerId }
      }
    ];
  },

  /**
   * Refund Template
   * If pre-settled:
   *   Debit Escrow (PLATFORM_ESCROW or ESCROW)
   *   Credit Platform Cash (PAYMENT_GATEWAY_CLEARING or PLATFORM_CASH)
   * If settled:
   *   Debit Organizer Available (ORGANIZER_BALANCE or ORGANIZER_AVAILABLE)
   *   Debit Platform Revenue (PLATFORM_REVENUE or PLATFORM_FEE_REVENUE)
   *   Debit Tax Payable (TAX_PAYABLE)
   *   Credit Platform Cash (PAYMENT_GATEWAY_CLEARING or PLATFORM_CASH)
   */
  refund(input: RefundTemplateInput, useLegacy = true): EntryInput[] {
    const cashType: FinanceAccountType = useLegacy ? 'PAYMENT_GATEWAY_CLEARING' : 'PLATFORM_CASH';
    const escrowType: FinanceAccountType = useLegacy ? 'PLATFORM_ESCROW' : 'ESCROW';
    const revenueType: FinanceAccountType = useLegacy ? 'PLATFORM_REVENUE' : 'PLATFORM_FEE_REVENUE';
    const organizerType: FinanceAccountType = useLegacy ? 'ORGANIZER_BALANCE' : 'ORGANIZER_AVAILABLE';

    if (!input.isSettled) {
      // Pre-settled refund
      return [
        {
          accountType: escrowType,
          accountName: 'Platform Escrow Custody',
          amount: input.refundAmount,
          direction: 'debit'
        },
        {
          accountType: cashType,
          accountName: 'Platform Cash Clearing',
          amount: input.refundAmount,
          direction: 'credit'
        }
      ];
    } else {
      // Settled refund
      if (!input.organizerId || input.netOrganizerRefund === undefined || input.platformFeeRefund === undefined || input.taxRefund === undefined) {
        throw new Error('Organizer ID and refund breakdown required for settled refunds');
      }

      return [
        {
          accountType: organizerType,
          accountName: `Organizer Available: ${input.organizerId}`,
          amount: input.netOrganizerRefund,
          direction: 'debit',
          metadata: { organizerId: input.organizerId }
        },
        {
          accountType: revenueType,
          accountName: 'Platform Commission Revenue',
          amount: input.platformFeeRefund,
          direction: 'debit'
        },
        {
          accountType: 'TAX_PAYABLE',
          accountName: 'Tax Liabilities (GST/VAT)',
          amount: input.taxRefund,
          direction: 'debit'
        },
        {
          accountType: cashType,
          accountName: 'Platform Cash Clearing',
          amount: input.refundAmount,
          direction: 'credit'
        }
      ];
    }
  },

  /**
   * Withdrawal Template
   * Debit Organizer Available (ORGANIZER_BALANCE or ORGANIZER_AVAILABLE)
   * Credit Platform Cash (PAYMENT_GATEWAY_CLEARING or PLATFORM_CASH)
   */
  withdrawal(input: WithdrawalTemplateInput, useLegacy = true): EntryInput[] {
    const cashType: FinanceAccountType = useLegacy ? 'PAYMENT_GATEWAY_CLEARING' : 'PLATFORM_CASH';
    const organizerType: FinanceAccountType = useLegacy ? 'ORGANIZER_BALANCE' : 'ORGANIZER_AVAILABLE';

    return [
      {
        accountType: organizerType,
        accountName: `Organizer Available: ${input.organizerId}`,
        amount: input.amount,
        direction: 'debit',
        metadata: { organizerId: input.organizerId }
      },
      {
        accountType: cashType,
        accountName: 'Platform Cash Clearing',
        amount: input.amount,
        direction: 'credit'
      }
    ];
  }
};
