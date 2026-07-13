import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { Resource } from '@opentelemetry/resources';
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions';

const otelEnabled = process.env.OTEL_ENABLED === 'true';

if (otelEnabled) {
  console.log('[OpenTelemetry] Initializing telemetry SDK...');
  
  const exporterOptions = process.env.OTEL_EXPORTER_OTLP_ENDPOINT
    ? { url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT }
    : undefined;

  const traceExporter = new OTLPTraceExporter(exporterOptions);
  
  const sdk = new NodeSDK({
    resource: new Resource({
      [SemanticResourceAttributes.SERVICE_NAME]: process.env.OTEL_SERVICE_NAME || 'revelis-backend',
    }),
    traceExporter,
    instrumentations: [
      getNodeAutoInstrumentations({
        // Exclude noisy modules to prevent excessive log volume
        '@opentelemetry/instrumentation-fs': { enabled: false },
      }),
    ],
  });

  try {
    sdk.start();
    console.log('[OpenTelemetry] SDK initialized and auto-instrumentation active');
  } catch (error) {
    console.error('[OpenTelemetry] Failed to start telemetry SDK:', error);
  }

  // Gracefully shut down SDK on process termination
  process.on('SIGTERM', () => {
    sdk.shutdown()
      .then(() => console.log('[OpenTelemetry] SDK shut down successfully'))
      .catch((err) => console.error('[OpenTelemetry] Error shutting down SDK:', err));
  });
}
