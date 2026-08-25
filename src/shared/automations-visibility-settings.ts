import type { GlobalSettings } from './global-settings-types'

type AutomationsVisibilitySettings = Pick<
  GlobalSettings,
  'showAutomationsButton' | 'showAutomationsButtonDefaultedOffForAllUsers'
>

export function normalizeAutomationsVisibilityDefault(
  settings: Partial<AutomationsVisibilitySettings> | undefined
): AutomationsVisibilitySettings {
  const defaultedOff = settings?.showAutomationsButtonDefaultedOffForAllUsers === true

  return {
    // Why: prior builds persisted Automations visible by default; migrate those
    // inherited values off once while preserving a later explicit opt-in.
    showAutomationsButton: defaultedOff ? (settings?.showAutomationsButton ?? false) : false,
    showAutomationsButtonDefaultedOffForAllUsers: true
  }
}
