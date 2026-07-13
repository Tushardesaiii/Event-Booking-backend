/**
 * Helper function to safely resolve nested properties using dot-notation (e.g. "user.profile.firstName")
 */
export function getNestedValue(obj: unknown, path: string): unknown {
  if (!obj || typeof obj !== 'object') {
    return undefined;
  }

  const parts = path.split('.');
  let current: any = obj;

  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== 'object') {
      return undefined;
    }
    current = current[part];
  }

  return current;
}

/**
 * Parses and replaces placeholders of the form {{ path | fallback }} or {{ path }}
 * in a template string, resolving values from a provided context object.
 *
 * Example:
 *   renderTemplate("Hello {{user.firstName | 'there'}}", { user: { firstName: "Alice" } }) => "Hello Alice"
 *   renderTemplate("Hello {{user.firstName | 'there'}}", {}) => "Hello there"
 *
 * Avoids eval/new Function to prevent arbitrary code execution (ACE).
 */
export function renderTemplate(template: string, context: Record<string, unknown>): string {
  if (!template) {
    return '';
  }

  const regex = /\{\{\s*([^|}]+?)(?:\s*\|\s*([^}]+?))?\s*\}\}/g;

  return template.replace(regex, (match, pathPart, fallbackPart) => {
    const path = pathPart.trim();
    const resolvedValue = getNestedValue(context, path);

    if (resolvedValue !== undefined && resolvedValue !== null && resolvedValue !== '') {
      return String(resolvedValue);
    }

    if (fallbackPart !== undefined) {
      let fallback = fallbackPart.trim();
      // Remove surrounding quotes if present
      if (
        (fallback.startsWith("'") && fallback.endsWith("'")) ||
        (fallback.startsWith('"') && fallback.endsWith('"'))
      ) {
        fallback = fallback.slice(1, -1);
      }
      return fallback;
    }

    return '';
  });
}
