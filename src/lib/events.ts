import { EventEmitter } from 'node:events';
import { logger } from './logger.js';
import { incrementMetric } from './metrics.js';

export const domainEvents = new EventEmitter();

export function emitDomainEvent(eventName: string, payload: any) {
  logger.info(`[DomainEvent] Emitting ${eventName}`, payload);
  incrementMetric(`domain_event_${eventName.toLowerCase()}_total`);
  domainEvents.emit(eventName, payload);
}
