/** Public projections for organization switching; credentials remain in PlatformSession. */
export interface OrganizationOption {
  tenantId:string;tenantName:string;tenantType:"personal"|"organization";
  workspaceId:string;workspaceName:string;current:boolean;
}
export interface OrganizationSwitchView {
  requestId:string;
  state:"pending"|"completed"|"failed"|"cancelled"|"expired";
  target:OrganizationOption;
  errorCode?:string;
}
export class OrganizationSwitchError extends Error {
  constructor(readonly status:number,readonly code:string,message:string){super(message);}
}
export const isScopeId=(value:unknown):value is string=>typeof value==="string"&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
export function organizationOptions(value:unknown):OrganizationOption[]{
  if(!Array.isArray(value))throw new OrganizationSwitchError(502,"ORGANIZATIONS_UNAVAILABLE","Organization list is unavailable");
  const result:OrganizationOption[]=[],seen=new Set<string>();
  for(const row of value){
    if(!row||!isScopeId(row.tenantId)||!isScopeId(row.workspaceId)||typeof row.tenantName!=="string"||!row.tenantName.trim()||
      !["personal","organization"].includes(row.tenantType)||typeof row.workspaceName!=="string"||!row.workspaceName.trim())continue;
    const key=row.tenantId.toLowerCase()+":"+row.workspaceId.toLowerCase();if(seen.has(key))continue;seen.add(key);
    result.push({tenantId:row.tenantId.toLowerCase(),tenantName:row.tenantName.slice(0,200),tenantType:row.tenantType,
      workspaceId:row.workspaceId.toLowerCase(),workspaceName:row.workspaceName.slice(0,200),current:row.isCurrent===true});
  }
  return result;
}

/** Console's tenant list names its default space; only /mine is workspace membership. */
export function switchableOrganizationOptions(tenants:unknown,scope:unknown,spaces:unknown):OrganizationOption[]{
  const current=scope as {mode?:unknown;id?:unknown;workspace?:unknown}|null;
  if(current?.mode!=="tenant"||!isScopeId(current.id)||!isScopeId(current.workspace)||!Array.isArray(spaces))
    throw new OrganizationSwitchError(502,"ORGANIZATIONS_UNAVAILABLE","Workspace membership is unavailable");
  const rows=organizationOptions(tenants),tenantId=current.id.toLowerCase(),workspaceId=current.workspace.toLowerCase();
  const tenant=rows.find(row=>row.tenantId===tenantId);
  if(!tenant)throw new OrganizationSwitchError(502,"ORGANIZATIONS_UNAVAILABLE","Current organization membership is unavailable");
  const own=organizationOptions(spaces.map(space=>({tenantId,tenantName:tenant.tenantName,tenantType:tenant.tenantType,
    workspaceId:space?.id,workspaceName:space?.name,isCurrent:typeof space?.id==="string"&&space.id.toLowerCase()===workspaceId})));
  return rows.flatMap(row=>row.tenantId===tenantId?own:[{...row,current:false}]);
}
