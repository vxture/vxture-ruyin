import {useState} from "react";
import {fireEvent,render,screen,within} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {expect,test,vi} from "vitest";
import {AgentManagementPage} from "./agent-install-manager";
import {ApiError,type Api,type ProductInfo,type RegistryCatalog} from "./api";
import {LocaleContext} from "./i18n";

const product=(over:Partial<ProductInfo>={}):ProductInfo=>({id:"tender",name:"标书智能体",version:"1.1.0",versions:["1.0.0","1.1.0"],installed:true,state:"active",entitled:true,availability:"available",subscription:null,commercialIntent:null,managed:true,supply:"package",...over});
const registry=(version="1.2.0",signed=true):RegistryCatalog=>({status:"ok",base:"https://registry.test",checkedAt:"now",generatedAt:"now",installable:false,items:[{id:"tender",name:"标书智能体",version,publisher:"vxture",runtime:{minimum:"0.1.0"},size:20,signed,installed:false,installedVersions:[]}]});
function rig(initial=product(),over:Partial<Api>={}){
 let current=initial;
 const api={products:vi.fn(async()=>[current]),registry:vi.fn(async()=>registry("1.1.0")),
 installFromRegistry:vi.fn(async(id:string,version:string)=>{current={...current,versions:[...current.versions,version]};return {productId:id,version,signed:true};}),
 pinProductVersion:vi.fn(async(_id:string,version:string)=>current={...current,version}),
 deactivateProduct:vi.fn(async()=>current={...current,state:"inactive",availability:"disabled"}),
 activateProduct:vi.fn(async()=>current={...current,state:"active",availability:"available"}),...over} as unknown as Api;
 const changed=vi.fn();
 function Harness(){const [open,setOpen]=useState(false);return <><button onClick={()=>setOpen(true)}>Manage</button>{open&&<><button onClick={()=>setOpen(false)}>Leave</button><AgentManagementPage api={api} onChanged={changed}/></>}</>;}
 const view=render(<Harness/>);
 const open=async()=>{await userEvent.click(screen.getByRole("button",{name:"Manage"}));await screen.findByRole("article",{name:initial.name});};
 return{api,changed,view,open};
}

test("manager fetches only on opening, retains machine states and keeps version actions in expandable details",async()=>{
 const r=rig(product(),{products:vi.fn(async()=>[product(),product({id:"dev",supply:"builtin"})])});
 expect(r.api.products).not.toHaveBeenCalled();await r.open();
 expect(screen.getByRole("button",{name:"全部1"})).toBeInTheDocument();expect(screen.getByText("已启用")).toBeInTheDocument();
 const article=screen.getByRole("article",{name:"标书智能体"}),details=article.querySelector("details")!;
 expect(details.open).toBe(false);await userEvent.click(within(article).getByText("已装版本 · 2"));expect(details.open).toBe(true);
 expect(within(article).getByText("当前默认")).toBeInTheDocument();expect(within(article).getByRole("button",{name:"使用此版本"})).toBeVisible();
 await userEvent.click(screen.getByRole("button",{name:"Leave"}));
 expect(screen.queryByRole("dialog")).toBeNull();await r.open();expect(r.api.products).toHaveBeenCalledTimes(2);
});

test("rollback requires confirmation, cancellation makes no change and acknowledged changes survive home refresh failure",async()=>{
 const r=rig();r.changed.mockRejectedValue(Error("Home unavailable"));await r.open();
 await userEvent.click(screen.getByText("已装版本 · 2"));await userEvent.click(screen.getByRole("button",{name:"使用此版本"}));
 let dialog=screen.getByRole("alertdialog");expect(within(dialog).getByText("新项目将使用此版本，已有项目不会降级。")).toBeInTheDocument();
 await userEvent.click(within(dialog).getByRole("button",{name:"取消"}));expect(r.api.pinProductVersion).not.toHaveBeenCalled();
 await userEvent.click(screen.getByRole("button",{name:"使用此版本"}));dialog=screen.getByRole("alertdialog");
 await userEvent.click(within(dialog).getByRole("button",{name:"确认"}));
 await screen.findByText("默认 v1.0.0");expect(r.api.pinProductVersion).toHaveBeenCalledExactlyOnceWith("tender","1.0.0");
 expect(r.api.installFromRegistry).not.toHaveBeenCalled();expect(screen.getByText("已更新本机安装状态。")).toBeInTheDocument();
});

test("enable/disable waits for acknowledgement; unfinished work keeps the agent enabled and remains retryable",async()=>{
 const r=rig();vi.mocked(r.api.deactivateProduct).mockRejectedValueOnce(new ApiError(409,{code:"PRODUCT_BUSY",message:"private workspace"}));
 await r.open();await userEvent.click(screen.getByRole("button",{name:"停用"}));
 expect(r.api.deactivateProduct).not.toHaveBeenCalled();let dialog=screen.getByRole("alertdialog");await userEvent.click(within(dialog).getByRole("button",{name:"确认"}));
 await within(dialog).findByText("仍有未完成工作，完成或取消后再停用。");expect(screen.queryByText("private workspace")).toBeNull();
 expect(screen.getByText("已启用")).toBeInTheDocument();await userEvent.click(within(dialog).getByRole("button",{name:"确认"}));
 await within(screen.getByRole("article",{name:"标书智能体"})).findByText("已停用");await userEvent.click(screen.getByRole("button",{name:"启用"}));await screen.findByText("已启用");
 expect(r.api.activateProduct).toHaveBeenCalledExactlyOnceWith("tender");expect(r.changed).toHaveBeenCalledTimes(2);
});

test("update downloads the exact release before pinning; duplicate clicks and dismissal cannot duplicate or cancel accepted work",async()=>{
 let finish!:(result:Awaited<ReturnType<Api["installFromRegistry"]>>)=>void;
 const r=rig(product(),{registry:vi.fn(async()=>registry()),installFromRegistry:vi.fn<Api["installFromRegistry"]>(()=>new Promise(resolve=>finish=resolve))});await r.open();
 const update=await screen.findByRole("button",{name:"更新至 v1.2.0"});fireEvent.click(update);fireEvent.click(update);
 expect(r.api.installFromRegistry).toHaveBeenCalledExactlyOnceWith("tender","1.2.0");expect(r.api.pinProductVersion).not.toHaveBeenCalled();
 await userEvent.click(screen.getByRole("button",{name:"Leave"}));
 finish({productId:"tender",version:"1.2.0",signed:true,from:"registry"});await vi.waitFor(()=>expect(r.api.pinProductVersion).toHaveBeenCalledExactlyOnceWith("tender","1.2.0"));
 await r.open();await screen.findByText("默认 v1.2.0");expect(r.changed).toHaveBeenCalledTimes(1);
});

test("failed download or identity mismatch never pins; rejection is visible and a new attempt can succeed",async()=>{
 const install=vi.fn().mockRejectedValueOnce(Error("offline")).mockResolvedValueOnce({productId:"wrong",version:"1.2.0"}).mockRejectedValueOnce(new ApiError(422,{code:"REGISTRY_PACKAGE_MISMATCH",message:"wrong"})).mockResolvedValue({productId:"tender",version:"1.2.0",signed:true});
 const r=rig(product(),{registry:vi.fn(async()=>registry()),installFromRegistry:install});await r.open();
 for(let i=0;i<3;i++){
  await userEvent.click(await screen.findByRole("button",{name:"更新至 v1.2.0"}));
  await screen.findByText(i===2?"安装包与所选版本不符，已停止安装。":"操作未完成，请检查安装状态后重试。");
  await vi.waitFor(()=>expect(screen.getByRole("button",{name:"更新至 v1.2.0"})).toBeEnabled());expect(r.api.pinProductVersion).not.toHaveBeenCalled();
 }
 await userEvent.click(screen.getByRole("button",{name:"更新至 v1.2.0"}));await screen.findByText("默认 v1.2.0");
});

test("retained updates work without network; unsigned published updates are blocked in production",async()=>{
 const r=rig(product({version:"1.0.0"}),{registry:vi.fn().mockRejectedValue(Error("offline"))});await r.open();
 await screen.findByText("更新服务暂不可用，已装版本仍可管理。");await userEvent.click(screen.getByRole("button",{name:"更新至 v1.1.0"}));
 await screen.findByText("默认 v1.1.0");expect(r.api.installFromRegistry).not.toHaveBeenCalled();r.view.unmount();
 const blocked=rig(product(),{registry:vi.fn(async()=>registry("1.2.0",false))});await blocked.open();expect(await screen.findByRole("button",{name:"更新至 v1.2.0"})).toBeDisabled();
});

test("a newer retained version can be selected explicitly, while unmanaged supply has no switch controls",async()=>{
 const r=rig(product({version:"1.0.0"}));await r.open();await userEvent.click(screen.getByText("已装版本 · 2"));await userEvent.click(screen.getByRole("button",{name:"使用此版本"}));
 const dialog=screen.getByRole("alertdialog");expect(within(dialog).getByText("已有项目会按兼容性更新。")).toBeInTheDocument();await userEvent.click(within(dialog).getByRole("button",{name:"确认"}));await screen.findByText("默认 v1.1.0");r.view.unmount();
 const other=rig(product({managed:false,supply:"contract_fetch"}));await other.open();await userEvent.click(screen.getByText("已装版本 · 2"));expect(screen.getByRole("button",{name:"使用此版本"})).toBeDisabled();
});

test("an unavailable local list is not an empty install and retry restores management; catalog waiting never blocks the local list",async()=>{
 let release!:(value:RegistryCatalog)=>void;
 const api={products:vi.fn().mockRejectedValueOnce(Error("unavailable")).mockResolvedValue([]),registry:vi.fn(()=>new Promise(resolve=>release=resolve))} as unknown as Api;
 render(<AgentManagementPage api={api} onChanged={()=>{}}/>);
 expect(screen.getByText("正在读取已安装智能体…")).toBeInTheDocument();await screen.findByText("暂时无法读取已安装智能体。");expect(screen.queryByText("尚未安装智能体")).toBeNull();
 await userEvent.click(screen.getByRole("button",{name:"重新读取"}));await screen.findByText("尚未安装智能体");
 release({status:"unreachable",base:"",reason:"raw network",checkedAt:""});await screen.findByText("更新服务暂不可用，已装版本仍可管理。");
 expect(screen.queryByText("raw network")).toBeNull();
});

test("refresh failure keeps prior rows but disables changes until retry; late reads cannot replace a newer client",async()=>{
 const r=rig();await r.open();vi.mocked(r.api.products).mockRejectedValueOnce(Error("offline"));
 await userEvent.click(screen.getByRole("button",{name:"检查更新"}));await screen.findByText("暂时无法读取已安装智能体。");expect(screen.getByRole("button",{name:"停用"})).toBeDisabled();
 await userEvent.click(screen.getByRole("button",{name:"重新读取"}));await vi.waitFor(()=>expect(screen.getByRole("button",{name:"停用"})).toBeEnabled());r.view.unmount();
 let late!:(value:ProductInfo[])=>void;
 const slow={products:vi.fn(()=>new Promise(resolve=>late=resolve)),registry:vi.fn(async()=>registry())} as unknown as Api;
 const pending=render(<AgentManagementPage api={slow} onChanged={()=>{}}/>);
 const fresh={...slow,products:vi.fn(async()=>[product({name:"New client"})])} as unknown as Api;
 pending.rerender(<AgentManagementPage api={fresh} onChanged={()=>{}}/>);
 await screen.findByText("New client");late([product({name:"Old client"})]);await Promise.resolve();expect(screen.queryByText("Old client")).toBeNull();
});

test("late catalog rejection or acknowledged mutation after unmount does not restart reads",async()=>{
 let fail!:(reason:Error)=>void,settle!:(value:ProductInfo)=>void;
 const r=rig(product(),{registry:vi.fn<Api["registry"]>(()=>new Promise((_resolve,reject)=>fail=reject)),pinProductVersion:vi.fn<Api["pinProductVersion"]>(()=>new Promise(resolve=>settle=resolve))});await r.open();
 await userEvent.click(screen.getByText("已装版本 · 2"));await userEvent.click(screen.getByRole("button",{name:"使用此版本"}));await userEvent.click(within(screen.getByRole("alertdialog")).getByRole("button",{name:"确认"}));
 r.view.unmount();fail(Error("offline"));settle(product({version:"1.0.0"}));await vi.waitFor(()=>expect(r.changed).toHaveBeenCalledTimes(1));expect(r.api.products).toHaveBeenCalledTimes(1);
});

test("English state labels and footer use the same compact management surface",async()=>{
 const r=rig();r.view.unmount();
 render(<LocaleContext.Provider value="en"><AgentManagementPage api={r.api} onChanged={()=>{}}/></LocaleContext.Provider>);
 expect(await screen.findByRole("region",{name:"Agent management"})).toBeInTheDocument();await screen.findByText("Enabled");expect(screen.getByText("Project data and previous versions are retained.")).toBeInTheDocument();
});

test("search and status filters share counts and never mark an unreachable registry as current",async()=>{
 const r=rig(product(),{products:vi.fn(async()=>[product(),product({id:"sales",name:"销售智能体",state:"inactive",version:"1.0.0"}),product({id:"online",name:"在线开发夹具",supply:"builtin"})]),registry:vi.fn(async()=>registry())});await r.open();
 expect(screen.getByRole("button",{name:"全部2"})).toHaveAttribute("aria-pressed","true");
 await userEvent.click(screen.getByRole("button",{name:"可更新2"}));expect(screen.getAllByRole("article")).toHaveLength(2);
 await userEvent.type(screen.getByRole("textbox",{name:"搜索智能体"}),"sales");expect(screen.getByRole("button",{name:"全部1"})).toBeInTheDocument();expect(screen.getByRole("article",{name:"销售智能体"})).toBeInTheDocument();
 await userEvent.click(screen.getByRole("button",{name:"已停用1"}));expect(screen.getAllByRole("article")).toHaveLength(1);
 await userEvent.clear(screen.getByRole("textbox",{name:"搜索智能体"}));await userEvent.type(screen.getByRole("textbox",{name:"搜索智能体"}),"missing");await screen.findByText("没有匹配的智能体");
 await userEvent.clear(screen.getByRole("textbox",{name:"搜索智能体"}));await userEvent.click(screen.getByRole("button",{name:"全部2"}));expect(screen.getAllByRole("article")).toHaveLength(2);
 vi.mocked(r.api.registry).mockRejectedValueOnce(Error("offline"));await userEvent.click(screen.getByRole("button",{name:"检查更新"}));await screen.findByText("更新服务暂不可用，已装版本仍可管理。");expect(screen.getByRole("button",{name:"可更新—"})).toBeInTheDocument();
});

test("page imports and registry installations share existing validation and refresh the same installed list",async()=>{
 let rows:ProductInfo[]=[];
 const api={products:vi.fn(async()=>rows),registry:vi.fn(async()=>registry()),
  preflightPackage:vi.fn(async()=>({productId:"tender",name:"标书智能体",version:"1.1.0",publisher:"vxture",signed:true})),
  installPackage:vi.fn(async()=>{rows=[product()];return {productId:"tender",version:"1.1.0",signed:true};}),
  installFromRegistry:vi.fn(async()=>{rows=[product({version:"1.2.0",versions:["1.1.0","1.2.0"]})];return {productId:"tender",version:"1.2.0",signed:true,from:"registry"};})} as unknown as Api;
 const changed=vi.fn(),view=render(<AgentManagementPage api={api} onChanged={changed}/>);
 await screen.findByText("尚未安装智能体");const input=view.container.querySelector('input[type="file"]') as HTMLInputElement;
 const click=vi.spyOn(input,"click");await userEvent.click(screen.getByRole("button",{name:"导入安装包"}));expect(click).toHaveBeenCalledTimes(1);
 await userEvent.upload(input,new File(["synthetic"],"agent.ruyinpkg"));await userEvent.click(await screen.findByRole("button",{name:"确认安装"}));await screen.findByRole("article",{name:"标书智能体"});expect(changed).toHaveBeenCalledTimes(1);
 await userEvent.click(screen.getByRole("button",{name:"浏览产品库"}));const list=await screen.findByRole("list",{name:"产品库"});await userEvent.click(within(list).getByRole("button",{name:"安装"}));await screen.findByText("默认 v1.2.0");expect(changed).toHaveBeenCalledTimes(2);
 await userEvent.click(screen.getByRole("button",{name:"收起产品库"}));expect(screen.queryByRole("list",{name:"产品库"})).toBeNull();
});
