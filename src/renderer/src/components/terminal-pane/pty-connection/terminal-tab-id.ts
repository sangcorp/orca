type UnifiedTabLookup = {
  getTab?: (tabId: string) => { contentType: string; entityId: string } | null
}

/** Resolve a renderer tab id to the legacy terminal-tab id used by PTY state. */
export function resolveTerminalTabId(state: UnifiedTabLookup, tabId: string): string {
  const unifiedTab = state.getTab?.(tabId)
  return unifiedTab?.contentType === 'terminal' ? unifiedTab.entityId : tabId
}
