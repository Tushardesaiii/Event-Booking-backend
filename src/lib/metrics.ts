export const prometheusMetrics = {
  redis_connected: 1, // 1 for connected, 0 for disconnected
  redis_reconnects_total: 0,
  redis_errors_total: 0,
  redis_operations_total: 0,
  
  twilio_sms_sent_total: 0,
  twilio_sms_failed_total: 0,
  twilio_delivery_failures_total: 0,
  
  otp_generated_total: 0,
  otp_verified_total: 0,
  otp_failed_total: 0,
  otp_expired_total: 0,
  
  qstash_jobs_published_total: 0,
  qstash_jobs_completed_total: 0,
  qstash_jobs_failed_total: 0,
  qstash_jobs_retried_total: 0,

  emails_sent_total: 0,
  emails_failed_total: 0,
  emails_delivered_total: 0,
  emails_opened_total: 0,
  emails_clicked_total: 0,
  emails_bounced_total: 0,
  emails_complaints_total: 0,
  emails_unsubscribed_total: 0,
  campaigns_created_total: 0,
  campaigns_sent_total: 0,
  campaigns_failed_total: 0,
  emails_queued_total: 0,

  payments_created_total: 0,
  payments_success_total: 0,
  payments_failed_total: 0,
  payments_refunded_total: 0,
  razorpay_webhook_total: 0,
  razorpay_webhook_failures_total: 0,
  payment_webhooks_total: 0,
  payment_webhook_failures_total: 0,
  disputes_received_total: 0,
  disputes_won_total: 0,
  disputes_lost_total: 0,
  payment_processing_duration_ms: 0,
  reconciliation_discrepancies_total: 0,
  fraud_events_total: 0,
  refund_attempts_total: 0,
  payments_captured_total: 0,
  refunds_total: 0,
  settlements_total: 0,
  withdrawals_total: 0,
  withdrawal_failures_total: 0,
  organizer_wallet_balance: 0,
  ledger_transactions_total: 0,
  storage_uploads_total: 0,
  storage_downloads_total: 0,
  storage_deletes_total: 0,
  storage_bytes_stored: 0,
  storage_variants_generated_total: 0,
  storage_processing_failures_total: 0,
  storage_presigned_urls_generated_total: 0,

  // Phase 15 additions
  storage_assets_total: 0,
  storage_variants_total: 0,
  storage_processing_duration: 0,
  storage_integrity_failures: 0,
  storage_integrity_repairs: 0,
  storage_scan_failures: 0,
  storage_scan_successes: 0,
  storage_duplicate_assets: 0,
  storage_deduplicated_bytes: 0,
  storage_multipart_uploads: 0,
  storage_signed_url_requests: 0,
  
  // Ledger Enterprise Metrics
  ledger_postings_total: 0,
  ledger_posting_failures_total: 0,
  ledger_balance_queries_total: 0,
  ledger_reconciliation_failures_total: 0,
  ledger_posting_duration: 0,
  ledger_db_transaction_duration: 0,
  ledger_snapshot_rebuild_total: 0,

  // Reservation & Inventory Metrics
  reservation_created_total: 0,
  reservation_converted_total: 0,
  reservation_expired_total: 0,
  reservation_extended_total: 0,
  reservation_failed_total: 0,
  oversell_prevented_total: 0,
  duplicate_payment_prevented_total: 0,
  duplicate_webhook_prevented_total: 0,
  late_payment_refunds_total: 0,
  inventory_reserved: 0,
  inventory_available: 0,
  inventory_sold: 0,
  reservation_reconciliation_failures: 0,
};

// Registry is open: statically-known counters above are always present, while
// dynamically-named counters (e.g. `domain_event_*_total`) are created on first use.
const registry: Record<string, number> = prometheusMetrics as Record<string, number>;

export type MetricName = keyof typeof prometheusMetrics | (string & {});

export function incrementMetric(name: MetricName, value: number = 1) {
  registry[name] = (registry[name] ?? 0) + value;
}

export function setMetric(name: MetricName, value: number) {
  registry[name] = value;
}
