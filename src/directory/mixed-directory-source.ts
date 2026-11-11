import { IdpDirectorySnapshot, IdpUserState } from '@pragmatic-tech-ai/todl-identity'
import type { IdpDirectoryRequest, IIdpDirectorySource, ILocalAccountStore, Tenant } from '@pragmatic-tech-ai/todl-identity'

/**
 * Directory source for a pack that mixes external authenticators with local accounts and has no connector.
 * The snapshot is non-authoritative (external users fall back to sign-in group claims), but every requested
 * principal that has a local account carries its Enabled/Disabled state so a disabled local user is deprovisioned.
 * A principal with no local account is left out (not Deleted): it may be an external user.
 */
export class MixedDirectorySource implements IIdpDirectorySource
{
    public readonly Authoritative = false

    public constructor(
        private readonly accounts: ILocalAccountStore,
        private readonly now: () => Date = () => new Date())
    {
    }

    public async Snapshot(tenant: Tenant, request: IdpDirectoryRequest): Promise<IdpDirectorySnapshot>
    {
        const users = new Map<string, IdpUserState>()
        for (const principalId of request.PrincipalIds)
        {
            const account = await this.accounts.FindByPrincipalId(tenant, principalId)
            if (account !== null)
            {
                users.set(principalId, account.Disabled ? IdpUserState.Disabled : IdpUserState.Enabled)
            }
        }
        return new IdpDirectorySnapshot(this.now(), this.Authoritative, users, new Map())
    }
}
