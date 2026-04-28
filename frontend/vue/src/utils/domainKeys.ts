const _onlineKey: Record<string, string> = {
  air: 'onlineDataSourceURL',
}

const _offgridKey: Record<string, string> = {
  air: 'offgridDataSourceURL',
}

export function onlineKey(ns: string): string {
  return _onlineKey[ns] ?? 'onlineUrl'
}

export function offgridKey(ns: string): string {
  return _offgridKey[ns] ?? 'offgridSource'
}
