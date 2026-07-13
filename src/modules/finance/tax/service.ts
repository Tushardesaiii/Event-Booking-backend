import { and, eq } from 'drizzle-orm';
import { db } from '../../../db/client.js';
import { ledgerEntries } from '../../../db/schema/ledger.js';
import { AccountRegistry } from '../accounting/registry.js';

export type TaxJurisdiction = 'IN';
export type TaxComponentType = 'gst' | 'cgst' | 'sgst' | 'igst' | 'vat' | 'ticket_tax' | 'invoice_tax' | 'gateway_gst';

export interface TaxComponent {
  type: TaxComponentType;
  label: string;
  rateBps: number;
  taxableAmount: number;
  amount: number;
}

export interface TaxCalculation {
  jurisdiction: TaxJurisdiction;
  currency: string;
  taxableAmount: number;
  totalTax: number;
  components: TaxComponent[];
  metadata: Record<string, unknown>;
}

const BASIS_POINTS_DENOMINATOR = 10_000;

export const FinanceTaxService = {
  platformCommissionBps: 1_000,
  convenienceFeeBps: 500,
  gstBps: 1_800, // Standard 18% GST

  calculatePlatformFee(subtotalMinor: number): number {
    return this.calculateByBps(subtotalMinor, this.platformCommissionBps);
  },

  calculateConvenienceFee(subtotalMinor: number): number {
    return this.calculateByBps(subtotalMinor, this.convenienceFeeBps);
  },

  calculateGstOnAmount(taxableAmountMinor: number, currency = 'INR'): TaxCalculation {
    const amount = this.calculateByBps(taxableAmountMinor, this.gstBps);

    return {
      jurisdiction: 'IN',
      currency,
      taxableAmount: taxableAmountMinor,
      totalTax: amount,
      components: [
        {
          type: 'gst',
          label: 'GST',
          rateBps: this.gstBps,
          taxableAmount: taxableAmountMinor,
          amount
        }
      ],
      metadata: {
        taxInclusive: false,
        policyVersion: 'finance-tax-v1'
      }
    };
  },

  /**
   * Centralized Regional Tax Calculation (CGST/SGST/IGST)
   */
  calculateRegionalTax(
    taxableAmountMinor: number,
    customerStateCode: string,
    platformStateCode: string,
    currency = 'INR'
  ): TaxCalculation {
    const totalTax = this.calculateByBps(taxableAmountMinor, this.gstBps);
    const components: TaxComponent[] = [];

    if (customerStateCode.trim().toUpperCase() === platformStateCode.trim().toUpperCase()) {
      // Intra-state: CGST (9%) + SGST (9%)
      const cgstAmount = this.calculateByBps(taxableAmountMinor, 900);
      const sgstAmount = totalTax - cgstAmount; // avoid rounding discrepancies
      components.push(
        {
          type: 'cgst',
          label: 'CGST',
          rateBps: 900,
          taxableAmount: taxableAmountMinor,
          amount: cgstAmount
        },
        {
          type: 'sgst',
          label: 'SGST',
          rateBps: 900,
          taxableAmount: taxableAmountMinor,
          amount: sgstAmount
        }
      );
    } else {
      // Inter-state: IGST (18%)
      components.push({
        type: 'igst',
        label: 'IGST',
        rateBps: 1800,
        taxableAmount: taxableAmountMinor,
        amount: totalTax
      });
    }

    return {
      jurisdiction: 'IN',
      currency,
      taxableAmount: taxableAmountMinor,
      totalTax,
      components,
      metadata: {
        taxInclusive: false,
        policyVersion: 'finance-tax-regional-v1',
        customerStateCode,
        platformStateCode
      }
    };
  },

  /**
   * Estimate Provider Fee GST Expense (18% of Razorpay standard 2% fee)
   */
  calculateProviderFeeGst(transactionAmountMinor: number): { providerFee: number; providerGst: number } {
    const providerFee = this.calculateByBps(transactionAmountMinor, 200); // 2% gateway fee
    const providerGst = this.calculateByBps(providerFee, 1800); // 18% GST expense on gateway fee
    return { providerFee, providerGst };
  },

  prorateTax(originalTaxMinor: number, refundAmountMinor: number, originalAmountMinor: number): number {
    if (originalAmountMinor <= 0) return 0;
    return Math.round((refundAmountMinor / originalAmountMinor) * originalTaxMinor);
  },

  calculateByBps(amountMinor: number, bps: number): number {
    return Math.round((amountMinor * bps) / BASIS_POINTS_DENOMINATOR);
  },

  /**
   * Generate statutory tax invoice data model
   */
  generateTaxInvoice(bookingOrder: any, customerState: string, platformState: string) {
    const totalAmountMinor = Math.round(parseFloat(bookingOrder.totalAmount) * 100);
    const subtotalMinor = Math.round(parseFloat(bookingOrder.subtotalAmount) * 100);
    const convenienceFeeMinor = this.calculateConvenienceFee(subtotalMinor);
    const taxCalc = this.calculateRegionalTax(convenienceFeeMinor, customerState, platformState, bookingOrder.currency);

    return {
      invoiceNumber: `INV-${bookingOrder.orderNumber}`,
      invoiceDate: new Date().toISOString(),
      orderId: bookingOrder.id,
      customerName: bookingOrder.purchaserName || 'Customer',
      subtotalAmount: bookingOrder.subtotalAmount,
      convenienceFee: (convenienceFeeMinor / 100).toFixed(2),
      taxableAmount: (convenienceFeeMinor / 100).toFixed(2),
      totalTax: (taxCalc.totalTax / 100).toFixed(2),
      totalAmount: bookingOrder.totalAmount,
      taxComponents: taxCalc.components.map(c => ({
        type: c.type,
        label: c.label,
        rateBps: c.rateBps,
        amount: (c.amount / 100).toFixed(2)
      }))
    };
  },

  /**
   * Query database for general ledger tax records for tax filings
   */
  async getTaxStatutoryReport(tenantId: string) {
    const taxAcc = await AccountRegistry.resolveAccount(db, {
      tenantId,
      type: 'TAX_PAYABLE'
    });

    const entries = await db
      .select()
      .from(ledgerEntries)
      .where(and(eq(ledgerEntries.accountId, taxAcc.id), eq(ledgerEntries.tenantId, tenantId)));

    let totalGst = 0;
    let totalCgst = 0;
    let totalSgst = 0;
    let totalIgst = 0;

    for (const entry of entries) {
      const val = parseFloat(entry.amount);
      const meta = entry.metadata as Record<string, any> || {};
      const accountName = (taxAcc.name ?? '') as string;
      const taxType = (meta.taxType as string | undefined)?.toUpperCase() ||
                      (accountName.includes('CGST') ? 'CGST' :
                       accountName.includes('SGST') ? 'SGST' : 'IGST');

      if (entry.direction === 'credit') {
        totalGst += val;
        if (taxType === 'CGST') totalCgst += val;
        else if (taxType === 'SGST') totalSgst += val;
        else totalIgst += val;
      } else {
        totalGst -= val;
        if (taxType === 'CGST') totalCgst -= val;
        else if (taxType === 'SGST') totalSgst -= val;
        else totalIgst -= val;
      }
    }

    return {
      tenantId,
      totalTaxCollected: totalGst.toFixed(2),
      cgstCollected: totalCgst.toFixed(2),
      sgstCollected: totalSgst.toFixed(2),
      igstCollected: totalIgst.toFixed(2),
      timestamp: new Date()
    };
  }
};
