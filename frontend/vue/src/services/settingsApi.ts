const BASE = '/api/settings'

export async function getNamespace(ns: string): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(`${BASE}/${ns}`)
    if (!res.ok) return null
    return await res.json() as Record<string, unknown>
  } catch (e) {
    console.warn('[SettingsAPI] getNamespace failed:', e)
    return null
  }
}

export async function put(ns: string, key: string, value: unknown): Promise<void> {
  try {
    await fetch(`${BASE}/${ns}/${key}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value }),
    })
  } catch (e) {
    console.warn('[SettingsAPI] put failed:', e)
  }
}

export async function getAll(): Promise<Record<string, Record<string, unknown>> | null> {
  try {
    const res = await fetch(BASE)
    if (!res.ok) return null
    return await res.json() as Record<string, Record<string, unknown>>
  } catch (e) {
    console.warn('[SettingsAPI] getAll failed:', e)
    return null
  }
}
