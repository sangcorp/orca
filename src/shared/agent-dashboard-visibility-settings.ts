import type { GlobalSettings } from './global-settings-types'

type AgentDashboardVisibilitySettings = Pick<
  GlobalSettings,
  | 'experimentalAgentDashboardPopout'
  | 'experimentalAgentDashboardMode'
  | 'experimentalAgentDashboardDefaultedOnForAllUsers'
>

export function normalizeAgentDashboardVisibilityDefault(
  settings: Partial<AgentDashboardVisibilitySettings> | undefined
): AgentDashboardVisibilitySettings {
  const defaultedOn = settings?.experimentalAgentDashboardDefaultedOnForAllUsers === true

  return {
    // Why: prior builds left the Agent Dashboard sidebar entry off (Settings
    // opt-in only); migrate those inherited values on once, in-window, while
    // preserving a later explicit opt-out or Pop-out choice.
    experimentalAgentDashboardPopout: defaultedOn
      ? (settings?.experimentalAgentDashboardPopout ?? true)
      : true,
    experimentalAgentDashboardMode: defaultedOn
      ? (settings?.experimentalAgentDashboardMode ?? 'in-window')
      : 'in-window',
    experimentalAgentDashboardDefaultedOnForAllUsers: true
  }
}
