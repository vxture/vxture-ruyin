import {act,fireEvent,render,screen,waitFor} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {afterEach,expect,test,vi} from "vitest";
import {OrganizationSelector} from "./organization-selector";
import type {Api,OrganizationOption,OrganizationSwitchView} from "./api";
import {LocaleContext} from "./i18n";

const rows:OrganizationOption[]=[{tenantId:"personal",tenantName:"我的个人空间",tenantType:"personal",workspaceId:"w1",workspaceName:"个人工作区",current:true},
 {tenantId:"org",tenantName:"测试组织全名",tenantType:"organization",workspaceId:"w2",workspaceName:"组织工作区",current:false}];
const view=(state:OrganizationSwitchView["state"]="pending",errorCode?:string):OrganizationSwitchView=>({requestId:"request",state,target:rows[1]!,...(errorCode?{errorCode}:{})});
function apiWith(over:Partial<Api>={}):Api{return {organizations:vi.fn().mockResolvedValue({items:rows}),organizationSwitchStatus:vi.fn().mockResolvedValue(null),
 switchOrganization:vi.fn().mockResolvedValue({requestId:"request",authorizeUrl:"https://console.test/auth/login?surface=native"}),cancelOrganizationSwitch:vi.fn().mockResolvedValue(view("cancelled")),...over} as unknown as Api;}
function deferred<T>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(ok=>{resolve=ok;});return {promise,resolve};}
async function open(){await userEvent.click(screen.getByRole("button",{name:"组织切换"}));}
afterEach(()=>{vi.unstubAllGlobals();vi.useRealTimers();});

test("organization choices load on demand; current scope stays disabled and contains its workspace",async()=>{
 const api=apiWith();render(<OrganizationSelector api={api} onChanged={vi.fn()}/>);
 expect(api.organizations).not.toHaveBeenCalled();await open();
 expect(screen.getByRole("dialog",{name:"组织与工作区"})).toBeInTheDocument();
 expect(screen.getByRole("button",{name:"组织切换"}).parentElement).not.toContainElement(screen.getByRole("dialog",{name:"组织与工作区"}));
 expect(await screen.findByText("组织工作区")).toBeInTheDocument();
 expect(screen.getByRole("button",{name:"个人工作区"})).toBeDisabled();
 expect(screen.getByRole("button",{name:"组织工作区"})).toBeEnabled();
 await open();expect(screen.queryByText("组织工作区")).toBeNull();expect(api.organizations).toHaveBeenCalledTimes(1);
});

test("organization headings group several workspaces; only a specific workspace begins a switch",async()=>{
 const extra={...rows[0]!,workspaceId:"w3",workspaceName:"投标工作区",current:false};
 const api=apiWith({organizations:vi.fn().mockResolvedValue({items:[rows[0],extra,rows[1]]}),
  organizationSwitchStatus:vi.fn().mockResolvedValueOnce(null).mockResolvedValue({...view(),target:extra})});
 vi.stubGlobal("open",vi.fn().mockReturnValue(null));
 render(<OrganizationSelector api={api} onChanged={vi.fn()}/>);await open();
 expect(await screen.findByRole("list",{name:"我的个人空间"})).toBeInTheDocument();
 expect(screen.getAllByText("我的个人空间")).toHaveLength(1);
 expect(screen.queryByRole("button",{name:/我的个人空间/})).toBeNull();
 expect(screen.getByRole("button",{name:"个人工作区"})).toHaveAttribute("aria-current","true");
 await userEvent.click(screen.getByRole("button",{name:"投标工作区"}));
 expect(api.switchOrganization).toHaveBeenCalledWith("personal","w3");
 expect(await screen.findByText("正在切换至「投标工作区」…")).toBeInTheDocument();
});

test("pending switch keeps a fallback sign-in link, confirms success and never logs out",async()=>{
 const status=deferred<OrganizationSwitchView|null>(),onChanged=vi.fn(),win={opener:{}};
 vi.stubGlobal("open",vi.fn().mockReturnValue(win));
 const api=apiWith({organizationSwitchStatus:vi.fn().mockResolvedValueOnce(null).mockReturnValue(status.promise)});
 render(<OrganizationSelector api={api} onChanged={onChanged}/>);await open();
 await userEvent.click(await screen.findByRole("button",{name:"组织工作区"}));
 expect(await screen.findByText("正在切换至「组织工作区」…")).toBeInTheDocument();
 expect(api.switchOrganization).toHaveBeenCalledWith("org","w2");expect(win.opener).toBeNull();
 expect(screen.getByRole("link",{name:"打开登录页"})).toHaveAttribute("href","https://console.test/auth/login?surface=native");
 expect(onChanged).not.toHaveBeenCalled();await act(async()=>status.resolve(view("completed")));
 expect(onChanged).toHaveBeenCalledTimes(1);
});

test("cancelling a pending switch leaves the organization and fences an old progress reply",async()=>{
 vi.stubGlobal("open",vi.fn().mockReturnValue(null));const status=deferred<OrganizationSwitchView|null>(),changed=vi.fn();
 const api=apiWith({organizationSwitchStatus:vi.fn().mockResolvedValueOnce(null).mockReturnValue(status.promise)});
 render(<OrganizationSelector api={api} onChanged={changed}/>);await open();
 await userEvent.click(await screen.findByRole("button",{name:"组织工作区"}));
 await userEvent.click(await screen.findByRole("button",{name:"取消切换"}));
 expect(await screen.findByText("已取消切换，当前组织未变更。")).toBeInTheDocument();expect(api.cancelOrganizationSwitch).toHaveBeenCalledWith("request");
 await act(async()=>status.resolve(view("completed")));expect(changed).not.toHaveBeenCalled();
});

test("a cancellation racing a completed switch refreshes the committed scope",async()=>{
 const changed=vi.fn(),api=apiWith({organizationSwitchStatus:vi.fn().mockResolvedValue(view()),cancelOrganizationSwitch:vi.fn().mockResolvedValue(view("completed"))});
 render(<OrganizationSelector api={api} onChanged={changed}/>);await open();await userEvent.click(await screen.findByRole("button",{name:"取消切换"}));
 expect(changed).toHaveBeenCalledTimes(1);
});

test("list and start failures are retryable without a session change",async()=>{
 const changed=vi.fn(),api=apiWith({organizations:vi.fn().mockRejectedValueOnce(Error("offline")).mockResolvedValue({items:rows}),switchOrganization:vi.fn().mockRejectedValue(Error("denied"))});
 render(<OrganizationSelector api={api} onChanged={changed}/>);await open();
 expect(await screen.findByText("组织列表读取失败，当前组织未变更。")).toBeInTheDocument();
 await userEvent.click(screen.getByRole("button",{name:"重试"}));await userEvent.click(await screen.findByRole("button",{name:"组织工作区"}));
 expect(await screen.findByText("无法发起切换，请重试。当前组织未变更。")).toBeInTheDocument();expect(changed).not.toHaveBeenCalled();
});

for(const [state,code,message]of [["failed","ORG_SWITCH_SCOPE_MISMATCH","浏览器返回的账号或组织不匹配"],["failed","ORG_SWITCH_FAILED","切换未完成"],["expired",undefined,"切换已超时"]]as const){
 test(`${state} ${code} explains the result without switching`,async()=>{
  const changed=vi.fn(),api=apiWith({organizationSwitchStatus:vi.fn().mockResolvedValue(view(state,code))});
  render(<OrganizationSelector api={api} onChanged={changed}/>);await open();
  expect(await screen.findByText(new RegExp(message))).toBeInTheDocument();expect(changed).not.toHaveBeenCalled();
 });
}

test("polling and cancellation failures retain pending state, retry and clean up after unmount",async()=>{
 vi.useFakeTimers();const changed=vi.fn(),api=apiWith({organizationSwitchStatus:vi.fn().mockResolvedValueOnce(view()).mockRejectedValue(Error("offline")),cancelOrganizationSwitch:vi.fn().mockRejectedValue(Error("ambiguous"))});
 const mounted=render(<OrganizationSelector api={api} onChanged={changed}/>);
 fireEvent.click(screen.getByRole("button",{name:"组织切换"}));await act(async()=>{});
 expect(screen.getByText("暂时无法读取切换进度，当前工作仍保留。")).toBeInTheDocument();
 fireEvent.click(screen.getByRole("button",{name:"取消切换"}));await act(async()=>{});
 expect(screen.getByText("未能确认取消结果，请检查切换进度。")).toBeInTheDocument();
 await act(async()=>vi.advanceTimersByTime(1500));expect(api.organizationSwitchStatus).toHaveBeenCalledTimes(3);
 mounted.unmount();await act(async()=>vi.advanceTimersByTime(3000));expect(api.organizationSwitchStatus).toHaveBeenCalledTimes(3);expect(changed).not.toHaveBeenCalled();
});

test("an empty authorized list is distinct from failure; late list replies after unmount are ignored",async()=>{
 const pending=deferred<{items:OrganizationOption[]}>(),api=apiWith({organizations:vi.fn().mockReturnValueOnce(pending.promise).mockResolvedValue({items:[]})});
 const first=render(<OrganizationSelector api={api} onChanged={vi.fn()}/>);await open();expect(screen.getByText("正在读取组织…")).toBeInTheDocument();first.unmount();
 await act(async()=>pending.resolve({items:rows}));render(<OrganizationSelector api={api} onChanged={vi.fn()}/>);await open();
 expect(await screen.findByText("没有可切换的工作区。")).toBeInTheDocument();
});

test("English organization trigger and personal badge use localized copy",async()=>{
 render(<LocaleContext.Provider value="en"><OrganizationSelector api={apiWith()} onChanged={vi.fn()}/></LocaleContext.Provider>);
 expect(screen.getByRole("button",{name:"Switch organization"})).toBeInTheDocument();
 expect(screen.getByRole("button",{name:"Switch organization"})).not.toHaveAttribute("href");
});
