export function isUniqueViolation(error: unknown) {
  return typeof error === 'object' && error !== null && 'code' in error && String((error as { code?: string }).code ?? '') === '23505';
}