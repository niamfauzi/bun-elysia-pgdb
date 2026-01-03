export type ValidationIssue = {
  path: string;
  message: string;
};

export type ValidationDetails = {
  source: string; // body | query | params | headers | request
  issues: ValidationIssue[];
};

// Best-effort formatter untuk error VALIDATION dari Elysia/TypeBox
export function formatValidationDetails(err: unknown): ValidationDetails {
  const e = err as any;

  const source = typeof e?.type === 'string' ? e.type : 'request';

  const issues: ValidationIssue[] = [];

  // Pola yang kamu lihat: e.valueError { path: "/name", message: "..." }
  if (e?.valueError) {
    const p = typeof e.valueError.path === 'string' ? e.valueError.path : '';
    issues.push({
      path: p.replace(/^\//, ''),
      message: typeof e.valueError.message === 'string' ? e.valueError.message : 'Invalid value',
    });
  }

  // Beberapa versi bisa punya array errors
  const maybeArrays = [e?.errors, e?.allErrors, e?.valueErrors];
  for (const arr of maybeArrays) {
    if (!Array.isArray(arr)) continue;

    for (const it of arr) {
      const pRaw =
        typeof it?.path === 'string'
          ? it.path
          : typeof it?.instancePath === 'string'
            ? it.instancePath
            : '';

      const msg =
        typeof it?.message === 'string'
          ? it.message
          : typeof it?.error === 'string'
            ? it.error
            : 'Invalid value';

      issues.push({ path: pRaw.replace(/^\//, ''), message: msg });
    }
  }

  // Fallback kalau format error berubah
  if (issues.length === 0) {
    issues.push({ path: '', message: 'Invalid request payload' });
  }

  // Dedup sederhana (kadang ada duplikat)
  const seen = new Set<string>();
  const deduped = issues.filter((x) => {
    const key = `${x.path}|${x.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return { source, issues: deduped };
}
