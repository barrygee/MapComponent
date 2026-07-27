// Global test setup, loaded before every test file (vitest setupFiles).
// Registers the jest-axe accessibility matcher so component tests can assert
// `expect(await axe(html)).toHaveNoViolations()`.
import { beforeEach, expect } from 'vitest'
import { toHaveNoViolations } from 'jest-axe'

expect.extend(toHaveNoViolations)

// Node 25 exposes an experimental, non-functional global `localStorage`/
// `sessionStorage` (the "--localstorage-file" runtime warning) that shadows
// jsdom's. Replace them with a simple in-memory Storage so the code under test
// and instance spies (vi.spyOn(localStorage, …)) behave deterministically.
class MemoryStorage {
  private data = new Map<string, string>()
  get length(): number {
    return this.data.size
  }
  clear(): void {
    this.data.clear()
  }
  getItem(key: string): string | null {
    return this.data.has(key) ? this.data.get(key)! : null
  }
  setItem(key: string, value: string): void {
    this.data.set(key, String(value))
  }
  removeItem(key: string): void {
    this.data.delete(key)
  }
  key(index: number): string | null {
    return Array.from(this.data.keys())[index] ?? null
  }
}

const localStorageMock = new MemoryStorage()
const sessionStorageMock = new MemoryStorage()
for (const target of [globalThis, globalThis.window].filter(Boolean)) {
  Object.defineProperty(target, 'localStorage', { configurable: true, value: localStorageMock })
  Object.defineProperty(target, 'sessionStorage', { configurable: true, value: sessionStorageMock })
}

// jsdom implements no layout, so it ships no `Element.prototype.scrollIntoView`
// at all. Any component that keeps a selection in view (the filter panes) throws
// on it — and because those calls sit in watchers, the throw surfaces as an
// unhandled error that fails the run *without* failing a test, which is easy to
// miss when reading the summary. A no-op keeps the DOM honest: the method exists,
// as it does in a browser, and does nothing since there is nothing to scroll.
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function scrollIntoView(): void {}
}

// Storage persists across tests in a file — start each test with a clean slate.
beforeEach(() => {
  localStorageMock.clear()
  sessionStorageMock.clear()
})
