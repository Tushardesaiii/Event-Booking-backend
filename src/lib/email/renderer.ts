import { emailTemplateRenderError } from '../errors.js';

export interface EmailRenderContext {
  user?: {
    firstName?: string | null;
    lastName?: string | null;
    email?: string | null;
  };
  event?: {
    title?: string | null;
    startDate?: string | null;
    location?: string | null;
  };
  tenant?: {
    name?: string | null;
  };
  campaign?: {
    name?: string | null;
  };
  subscriber?: {
    email?: string | null;
    firstName?: string | null;
    lastName?: string | null;
  };
  segment?: {
    name?: string | null;
  };
  unsubscribeUrl?: string;
}

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function resolvePath(source: unknown, path: string): unknown {
  const segments = path.split('.');
  let current: unknown = source;

  for (const segment of segments) {
    if (!current || typeof current !== 'object') {
      return undefined;
    }

    if (!(segment in current)) {
      return undefined;
    }

    current = (current as Record<string, unknown>)[segment];
  }

  return current;
}

function renderValue(template: string, context: EmailRenderContext) {
  return template.replace(/\{\{\s*([a-zA-Z0-9_.]+)(?:\s*\|\s*([^}]+))?\s*\}\}/g, (_match, path: string, fallback: string | undefined) => {
    const rawValue = resolvePath(context, path);
    const value = rawValue === null || rawValue === undefined || rawValue === '' ? fallback?.trim() ?? '' : String(rawValue);
    return escapeHtml(value);
  });
}

function sanitizeHtmlMarkup(html: string) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/\son[a-z]+="[^"]*"/gi, '')
    .replace(/\son[a-z]+='[^']*'/gi, '')
    .replace(/javascript:/gi, '');
}

export function renderEmailContent(content: string, context: EmailRenderContext) {
  try {
    return sanitizeHtmlMarkup(renderValue(content, context));
  } catch (error) {
    throw emailTemplateRenderError(error);
  }
}

export function renderEmailText(content: string, context: EmailRenderContext) {
  try {
    return renderValue(content, context);
  } catch (error) {
    throw emailTemplateRenderError(error);
  }
}
