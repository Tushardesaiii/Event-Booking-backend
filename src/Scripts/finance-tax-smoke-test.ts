import { FinanceTaxService } from '../modules/finance/tax/service.js';

function assertEqual(actual: unknown, expected: unknown, message: string) {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${expected}, received ${actual}`);
  }
}

function run() {
  const subtotalMinor = 10_000;
  const convenienceFee = FinanceTaxService.calculateConvenienceFee(subtotalMinor);
  const platformFee = FinanceTaxService.calculatePlatformFee(subtotalMinor);
  const gstOnPlatformFee = FinanceTaxService.calculateGstOnAmount(platformFee, 'INR');
  const partialRefundTax = FinanceTaxService.prorateTax(gstOnPlatformFee.totalTax, 5_000, 10_000);

  assertEqual(convenienceFee, 500, 'Convenience fee should remain 5%');
  assertEqual(platformFee, 1_000, 'Platform commission should remain 10%');
  assertEqual(gstOnPlatformFee.totalTax, 180, 'GST should remain 18% of platform commission');
  assertEqual(partialRefundTax, 90, 'Partial refund tax reversal should be prorated');
  assertEqual(gstOnPlatformFee.components[0]?.type, 'gst', 'Tax component should be typed');
  assertEqual(gstOnPlatformFee.metadata.policyVersion, 'finance-tax-v1', 'Tax policy version should be recorded');

  console.log('finance-tax-smoke-test: passed');
}

run();
