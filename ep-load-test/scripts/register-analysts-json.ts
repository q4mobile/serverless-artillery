/** Shared JSON.parse with consistent error labels (plan file + HTTP bodies). */
export function parseLabeledJson<T>(text: string, label: string): T {
  try {
    return JSON.parse(text) as T;
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    throw new Error(`${label}: invalid JSON (${err})`);
  }
}
