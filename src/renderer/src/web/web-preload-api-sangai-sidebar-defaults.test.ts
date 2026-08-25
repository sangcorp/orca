import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { installBrowserGlobals } from './web-preload-api-test-harness'

// Why a dedicated file: sangai-specific sidebar-visibility default migrations
// (see automations-visibility-settings.ts / agent-dashboard-visibility-settings.ts),
// kept out of web-preload-api-settings.test.ts to stay under its line budget.
describe('sangai sidebar-visibility default migrations', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('migrates Automations sidebar visibility off for stored legacy web settings once', async () => {
    const globals = installBrowserGlobals('Linux')
    globals.storage.setItem('orca.web.settings.v1', JSON.stringify({ showAutomationsButton: true }))
    const { installWebPreloadApi } = await import('./web-preload-api')
    installWebPreloadApi()

    const settings = await globals.window.api.settings.get()
    const stored = JSON.parse(globals.storage.getItem('orca.web.settings.v1') ?? '{}') as {
      showAutomationsButton?: boolean
      showAutomationsButtonDefaultedOffForAllUsers?: boolean
    }

    expect(settings.showAutomationsButton).toBe(false)
    expect(settings.showAutomationsButtonDefaultedOffForAllUsers).toBe(true)
    expect(stored.showAutomationsButton).toBe(false)
    expect(stored.showAutomationsButtonDefaultedOffForAllUsers).toBe(true)
  })

  it('preserves an explicit Automations opt-in after the sidebar-visibility migration', async () => {
    const globals = installBrowserGlobals('Linux')
    globals.storage.setItem(
      'orca.web.settings.v1',
      JSON.stringify({
        showAutomationsButton: true,
        showAutomationsButtonDefaultedOffForAllUsers: true
      })
    )
    const { installWebPreloadApi } = await import('./web-preload-api')
    installWebPreloadApi()

    const settings = await globals.window.api.settings.get()
    expect(settings.showAutomationsButton).toBe(true)
    expect(settings.showAutomationsButtonDefaultedOffForAllUsers).toBe(true)
  })

  it('migrates the Agent Dashboard sidebar entry on, in-window, for stored legacy web settings once', async () => {
    const globals = installBrowserGlobals('Linux')
    globals.storage.setItem('orca.web.settings.v1', JSON.stringify({}))
    const { installWebPreloadApi } = await import('./web-preload-api')
    installWebPreloadApi()

    const settings = await globals.window.api.settings.get()
    const stored = JSON.parse(globals.storage.getItem('orca.web.settings.v1') ?? '{}') as {
      experimentalAgentDashboardPopout?: boolean
      experimentalAgentDashboardMode?: string
      experimentalAgentDashboardDefaultedOnForAllUsers?: boolean
    }

    expect(settings.experimentalAgentDashboardPopout).toBe(true)
    expect(settings.experimentalAgentDashboardMode).toBe('in-window')
    expect(settings.experimentalAgentDashboardDefaultedOnForAllUsers).toBe(true)
    expect(stored.experimentalAgentDashboardPopout).toBe(true)
    expect(stored.experimentalAgentDashboardMode).toBe('in-window')
    expect(stored.experimentalAgentDashboardDefaultedOnForAllUsers).toBe(true)
  })

  it('preserves an explicit Agent Dashboard opt-out after the sidebar-visibility migration', async () => {
    const globals = installBrowserGlobals('Linux')
    globals.storage.setItem(
      'orca.web.settings.v1',
      JSON.stringify({
        experimentalAgentDashboardPopout: false,
        experimentalAgentDashboardDefaultedOnForAllUsers: true
      })
    )
    const { installWebPreloadApi } = await import('./web-preload-api')
    installWebPreloadApi()

    const settings = await globals.window.api.settings.get()
    expect(settings.experimentalAgentDashboardPopout).toBe(false)
    expect(settings.experimentalAgentDashboardDefaultedOnForAllUsers).toBe(true)
  })

  it('preserves an explicit Pop-out choice after the Agent Dashboard migration', async () => {
    const globals = installBrowserGlobals('Linux')
    globals.storage.setItem(
      'orca.web.settings.v1',
      JSON.stringify({
        experimentalAgentDashboardPopout: true,
        experimentalAgentDashboardMode: 'popout',
        experimentalAgentDashboardDefaultedOnForAllUsers: true
      })
    )
    const { installWebPreloadApi } = await import('./web-preload-api')
    installWebPreloadApi()

    const settings = await globals.window.api.settings.get()
    expect(settings.experimentalAgentDashboardMode).toBe('popout')
  })
})
