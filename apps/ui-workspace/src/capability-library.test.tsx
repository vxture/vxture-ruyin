import {act,fireEvent,render,screen,within} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {expect,test,vi} from "vitest";
import {CapabilityLibrary} from "./capability-library";
import type {Api,CapabilityCatalogPage,SkillListing} from "./api";
import {LocaleContext} from "./i18n";

const local:SkillListing={items:[{name:"private-report",description:"Private knowledge",layer:"user",source:"user",enabled:true,hasScripts:false,dir:"private"}],layers:[],scannedAt:"now"};
const page=(n=1):CapabilityCatalogPage=>({items:Array.from({length:n},(_,i)=>({capabilityId:"remote."+i,title:"Cloud "+i,primitiveType:"skill" as const,tags:[],local:{runnable:false}})),total:n,source:{kind:"platform",state:"synced",ref:"version"}});
function apiWith(value=page()):Api{return {capabilityCatalog:vi.fn().mockResolvedValue(value),refreshCapabilityCatalog:vi.fn().mockResolvedValue({})} as unknown as Api;}
function pending<T>(){let resolve!:(value:T)=>void, reject!:(e:Error)=>void;const promise=new Promise<T>((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};}
function view(api:Api,listing:SkillListing|null=local,action=vi.fn()){
 return <CapabilityLibrary api={api} listing={listing} busy={false} onRefresh={async()=>{}}
  errors={null} localSummary={<span>Local summary</span>} renderSkill={s=><li key={s.source}>{s.name}</li>}
  renderSkillAction={s=><button onClick={()=>action(s)}>{s.enabled?"停用":"启用"}</button>}/>;
}
test("a large union renders in small batches; search resets the batch without more catalog calls",async()=>{
 const api=apiWith(page(105));render(view(api));
 await screen.findByText("106 项");
 expect(document.querySelectorAll(".capability-inventory-item")).toHaveLength(50);
 await userEvent.click(screen.getByRole("button",{name:"再显示更多"}));
 expect(document.querySelectorAll(".capability-inventory-item")).toHaveLength(100);
 await userEvent.click(screen.getByRole("button",{name:"再显示更多"}));
 expect(document.querySelectorAll(".capability-inventory-item")).toHaveLength(106);
 expect(screen.queryByRole("button",{name:"再显示更多"})).toBeNull();
 fireEvent.change(screen.getByRole("textbox",{name:"搜索技能"}),{target:{value:"private"}});
 expect(document.querySelectorAll(".capability-inventory-item")).toHaveLength(1);
 expect(screen.getByText("1 项")).toBeInTheDocument();
 await userEvent.selectOptions(screen.getByLabelText("安装来源"),"user");
 await userEvent.selectOptions(screen.getByLabelText("安装状态"),"installed");
 await userEvent.selectOptions(screen.getByLabelText("可用状态"),"ready");
 expect(document.querySelectorAll(".capability-inventory-item")).toHaveLength(1);
 expect(api.capabilityCatalog).toHaveBeenCalledTimes(1);
});
test("late directory replies from an old API scope cannot replace the current inventory",async()=>{
 const old=pending<CapabilityCatalogPage>(),apiA=apiWith(),apiB=apiWith({...page(),items:[{...page().items[0]!,title:"Current cloud"}]});
 vi.mocked(apiA.capabilityCatalog).mockReturnValueOnce(old.promise);
 const component=render(view(apiA));
 expect(screen.getByText("正在读取能力…")).toBeInTheDocument();
 component.rerender(view(apiB));await screen.findByText("Current cloud");
 await act(async()=>{old.resolve({...page(),items:[{...page().items[0]!,title:"Old cloud"}]});});
 expect(screen.queryByText("Old cloud")).toBeNull();expect(screen.getByText("Current cloud")).toBeInTheDocument();
});
test("an old failed refresh after unmount cannot remove the current directory",async()=>{
 const old=pending<CapabilityCatalogPage>(),api=apiWith();
 const component=render(view(api));await screen.findByText("Cloud 0");
 vi.mocked(api.capabilityCatalog).mockReturnValueOnce(old.promise);
 await userEvent.click(screen.getByRole("button",{name:"刷新"}));
 component.rerender(view(apiWith({...page(),items:[{...page().items[0]!,title:"New scope"}]})));
 await screen.findByText("New scope");
 await act(async()=>{old.reject(Error("offline"));});
 expect(screen.queryByText("云端目录暂不可用，仍可查看本机能力。")).toBeNull();
});
test("refresh errors remain local; unmounting an initial read is safe",async()=>{
 const api=apiWith(),refresh=vi.fn().mockRejectedValue(Error("local failure"));
 const component=render(<CapabilityLibrary api={api} listing={local} busy={false} onRefresh={refresh}
  errors={<span>Action error</span>} localSummary={null} renderSkill={s=><li key={s.name}>{s.name}</li>}
  renderSkillAction={()=>null}/>);
 await screen.findByText("Cloud 0");await userEvent.click(screen.getByRole("button",{name:"刷新"}));
 expect(await screen.findByText("云端目录暂不可用，仍可查看本机能力。")).toBeInTheDocument();
 expect(screen.getByText("Cloud 0")).toBeInTheDocument();
 component.unmount();
 const late=pending<CapabilityCatalogPage>(),lateApi=apiWith();vi.mocked(lateApi.capabilityCatalog).mockReturnValueOnce(late.promise);
 const next=render(view(lateApi,null));expect(screen.getAllByText("正在读取能力…").length).toBeGreaterThan(0);
 next.unmount();await act(async()=>{late.reject(Error("gone"));});
});
test("English labels and tool details are separate from remote listing metadata",async()=>{
 const api=apiWith({...page(),items:[{...page().items[0]!,category:"research",summary:"Cloud summary"}],source:{kind:"platform",state:"synced",fetchedAt:"2026-11-21T08:00:00Z"}});
 render(<LocaleContext.Provider value="en">{view(api,local)}</LocaleContext.Provider>);
 expect(await screen.findByText("2 skills")).toBeInTheDocument();
 const record=screen.getByText("Cloud 0").closest("details")!;
 fireEvent.click(record.querySelector("summary")!);
 expect(within(record).getByText("remote.0")).toBeInTheDocument();
 expect(within(record).queryByRole("button")).toBeNull();
 expect(within(record).getByText("Not installed")).toBeInTheDocument();
});

test("installation filters reset incompatible conditions and never offer project scope",async()=>{
 const api=apiWith();render(view(api));await screen.findByText("2 项");
 const installation=screen.getByLabelText("安装状态"),source=screen.getByLabelText("安装来源"),state=screen.getByLabelText("可用状态");
 expect(within(source).queryByRole("option",{name:"项目"})).toBeNull();
 await userEvent.selectOptions(source,"user");expect(installation).toHaveValue("installed");
 await userEvent.selectOptions(state,"ready");expect(screen.getByText("1 项")).toBeInTheDocument();
 await userEvent.selectOptions(installation,"not-installed");
 expect(source).toBeDisabled();expect(source).toHaveValue("all");expect(state).toBeDisabled();expect(state).toHaveValue("all");
 expect(screen.getByText("Cloud 0")).toBeInTheDocument();expect(screen.queryByText("private-report",{selector:".capability-record-name"})).toBeNull();
 await userEvent.selectOptions(installation,"all");expect(source).toBeEnabled();expect(state).toBeEnabled();
 await userEvent.selectOptions(source,"all");expect(installation).toHaveValue("all");
 await userEvent.selectOptions(state,"all");expect(installation).toHaveValue("all");
 await userEvent.selectOptions(state,"disabled");expect(installation).toHaveValue("installed");expect(screen.getByText("没有符合条件的能力。")).toBeInTheDocument();
 expect(api.capabilityCatalog).toHaveBeenCalledTimes(1);
});

test("a single local action stays above details and cannot toggle the disclosure",async()=>{
 const action=vi.fn();render(view(apiWith(),local,action));await screen.findByText("2 项");
 const record=screen.getByText("private-report",{selector:".capability-record-name"}).closest("details")!;
 const summary=record.querySelector("summary")!,button=within(summary).getByRole("button",{name:"停用"});
 expect(within(record).getAllByRole("button")).toHaveLength(1);
 expect(within(record).getByRole("img",{name:"已安装在本机"})).toBeInTheDocument();
 expect(within(record).queryByRole("img",{name:/云端已收录/})).toBeNull();
 await userEvent.click(button);expect(action).toHaveBeenLastCalledWith(local.items[0]);expect(record.open).toBe(false);
 await userEvent.click(summary);expect(record.open).toBe(true);
 await userEvent.click(button);expect(action).toHaveBeenCalledTimes(2);expect(record.open).toBe(true);
 button.focus();await userEvent.keyboard("{Enter}");expect(action).toHaveBeenCalledTimes(3);expect(record.open).toBe(true);
 expect(record.querySelector(".capability-record-detail")?.firstElementChild).toHaveClass("capability-full-description");
});

test("merged copies have distinct actions first in expanded details and independent local/cloud icons",async()=>{
 const listing:SkillListing={...local,items:[{...local.items[0]!,layer:"bundled",source:"vendor.repo",capabilityId:"remote.0"},
  {...local.items[0]!,layer:"distributed",source:"agent",capabilityId:"remote.0",enabled:false}]};
 const action=vi.fn();render(view(apiWith({...page(),items:[{...page().items[0]!,category:"research",tags:["market"],summary:"Full cloud description"}]}),listing,action));
 await screen.findByText("1 项");const record=screen.getByText("Cloud 0").closest("details")!;
 const summary=record.querySelector("summary")!;expect(within(summary).queryByRole("button")).toBeNull();
 expect(within(summary).getByRole("img",{name:"已安装在本机"})).toBeInTheDocument();
 expect(within(summary).getByRole("img",{name:"云端已收录，调用状态未提供"})).toHaveAttribute("title","云端已收录，调用状态未提供");
 await userEvent.click(summary);
 const detail=record.querySelector<HTMLElement>(".capability-record-detail")!;expect(detail.firstElementChild).toHaveClass("capability-copy-controls");
 await userEvent.click(within(detail).getByRole("button",{name:"启用"}));expect(action).toHaveBeenLastCalledWith(listing.items[1]);
 await userEvent.click(within(detail).getByRole("button",{name:"停用"}));expect(action).toHaveBeenLastCalledWith(listing.items[0]);
 expect(record.open).toBe(true);
 expect(detail.querySelector(".capability-full-description")?.textContent).toBe("Full cloud description");
 expect(detail.lastElementChild).toHaveClass("capability-cloud-meta");expect(within(detail).getByText("market")).toBeInTheDocument();
});

test("restricted skills explain the actual limit and guide discovery without changing enabled copies",async()=>{
 const base=local.items[0]!;
 const listing:SkillListing={...local,items:[
  {...base,name:"script",layer:"bundled",source:"vendor.repo",hasScripts:true},
  {...base,name:"report",layer:"bundled",source:"vendor.repo",shadowedBy:"user"},
  {...base,name:"report"},
 ]};
 const api=apiWith(page(0)),action=vi.fn();render(view(api,listing,action));await screen.findByText("3 项");
 await userEvent.selectOptions(screen.getByLabelText("安装来源"),"bundled");
 await userEvent.selectOptions(screen.getByLabelText("可用状态"),"attention");
 fireEvent.change(screen.getByRole("textbox",{name:"搜索技能"}),{target:{value:"script"}});
 const script=screen.getByText("script",{selector:".capability-record-name"}).closest("details")!;
 expect(within(script).getByTitle("展开查看使用限制及处理建议")).toBeInTheDocument();
 await userEvent.click(script.querySelector("summary")!);
 expect(within(script).getByText(/调整启停开关无法解除此限制/)).toBeInTheDocument();
 expect(script.querySelector(".capability-record-detail")?.firstElementChild).toHaveClass("capability-skill-guidance");
 await userEvent.click(within(script).getByRole("button",{name:"查看可用技能"}));
 expect(screen.getByLabelText("可用状态")).toHaveValue("ready");expect(screen.getByLabelText("安装来源")).toHaveValue("all");
 expect(screen.getByRole("textbox",{name:"搜索技能"})).toHaveValue("");expect(screen.getByText("1 项")).toBeInTheDocument();
 expect(screen.getByText("report",{selector:".capability-record-name"})).toBeInTheDocument();
 await userEvent.selectOptions(screen.getByLabelText("可用状态"),"attention");
 const shadowed=screen.getByText("report",{selector:".capability-record-name"}).closest("details")!;
 await userEvent.click(shadowed.querySelector("summary")!);
 expect(within(shadowed).getByText(/当前生效的是「用户」中的同名技能/)).toBeInTheDocument();
 await userEvent.click(within(shadowed).getByRole("button",{name:"查找同名技能"}));
 expect(screen.getByRole("textbox",{name:"搜索技能"})).toHaveValue("report");
 expect(screen.getByLabelText("可用状态")).toHaveValue("all");expect(screen.getByLabelText("安装状态")).toHaveValue("installed");
 expect(screen.getByText("2 项")).toBeInTheDocument();expect(screen.getAllByText("report",{selector:".capability-record-name"})).toHaveLength(2);
 expect(action).not.toHaveBeenCalled();expect(api.capabilityCatalog).toHaveBeenCalledTimes(1);
});
