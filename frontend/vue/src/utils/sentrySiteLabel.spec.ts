import { describe, it, expect } from 'vitest'
import { siteLabel } from './sentrySiteLabel'
import type { SentrySite } from '@/services/sentryApi'

function site(overrides: Partial<SentrySite> = {}): SentrySite {
  return {
    id: 1,
    name: null,
    address: '192.168.1.60',
    port: 8000,
    reachable: true,
    latitude: 54.95,
    longitude: -1.53,
    updated_at: null,
    ...overrides,
  }
}

describe('siteLabel', () => {
  it('uses the site name when it has one', () => {
    expect(siteLabel(site({ name: 'Roof Pi' }))).toBe('Roof Pi')
  })

  it('falls back to address:port when the name is null', () => {
    expect(siteLabel(site({ name: null }))).toBe('192.168.1.60:8000')
  })

  it('treats a whitespace-only name as no name at all', () => {
    // A host registered but never named can carry '   ' from the Sentry's own
    // form; rendering that would give the marker a blank label.
    expect(siteLabel(site({ name: '   ' }))).toBe('192.168.1.60:8000')
  })

  it('falls back when the name is an empty string', () => {
    expect(siteLabel(site({ name: '' }))).toBe('192.168.1.60:8000')
  })
})
