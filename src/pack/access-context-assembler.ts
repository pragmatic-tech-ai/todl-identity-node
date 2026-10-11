import { AccessContext, ResourceAuthorizationPolicy } from '@pragmatic-tech-ai/todl-identity'
import type { IIdentityProviderPack, Tenant, Principal } from '@pragmatic-tech-ai/todl-identity'

/** Composes an already-authenticated principal into an AccessContext: loads the subject's grants
 *  from the pack and pairs them with the pack policy (falling back to deny-by-default RBAC). */
export class AccessContextAssembler
{
    public async AssembleAsync(pack: IIdentityProviderPack, tenant: Tenant, principal: Principal): Promise<AccessContext>
    {
        const grants = await pack.Grants.GrantsFor(principal.Id, tenant)
        return new AccessContext(principal, tenant, grants, pack.Policy ?? new ResourceAuthorizationPolicy())
    }
}
