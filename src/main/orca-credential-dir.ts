import { homedir } from 'node:os'
import { join } from 'node:path'

/** Where Orca keeps provider credentials (Jira, Linear, Bitbucket, MiniMax, speech).
 *
 * These deliberately live outside the profile userData, so two instances on one
 * machine share them. ORCA_CREDENTIAL_DIR separates them per workspace; unset, the
 * path is unchanged. */
export function getOrcaCredentialDir(): string {
  const override = process.env.ORCA_CREDENTIAL_DIR?.trim()
  return override ? override : join(homedir(), '.orca')
}
