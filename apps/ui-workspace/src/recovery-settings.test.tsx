import {fireEvent,render,screen,within} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {afterEach,expect,test,vi} from "vitest";
import {RecoverySettings,DiagnosticsSettings} from "./recovery-settings";
import {ApiError,type Api,type MaintenanceRecord,type DiagnosticReport} from "./api";
const host=vi.hoisted(()=>({value:"browser"}));
vi.mock("./host-chrome",()=>({useHostChrome:()=>host.value}));
afterEach(()=>{host.value="browser";vi.restoreAllMocks();});
const record=(state:MaintenanceRecord["state"]="queued"):MaintenanceRecord=>({id:"op",action:"backup",state,source:"C:/data",target:"D:/backup",createdAt:"now",updatedAt:"now"});
function rig(over:Partial<Api>={}){
 const api={maintenance:vi.fn(async()=>({operation:null})),queueMaintenance:vi.fn(async()=>({operation:record()})),cancelMaintenance:vi.fn(async()=>({operation:null})),restartApp:vi.fn(async()=>({ok:true})),pickFolder:vi.fn(async()=>({path:"D:/archives"})),...over} as unknown as Api;
 return {api,...render(<RecoverySettings api={api}/>)};
}
async function prepare(){await userEvent.type(screen.getByLabelText("新目标目录"),"D:/backup");await userEvent.click(screen.getByRole("button",{name:"准备执行"}));return screen.findByRole("alertdialog");}
test("backup requires confirmation, queues once and supports cancellation without pretending a browser can restart",async()=>{
 const r=rig();await vi.waitFor(()=>expect(r.api.maintenance).toHaveBeenCalled());expect(r.api.queueMaintenance).not.toHaveBeenCalled();
 let dialog=await prepare();await userEvent.click(within(dialog).getByRole("button",{name:"取消"}));expect(r.api.queueMaintenance).not.toHaveBeenCalled();
 await userEvent.click(screen.getByRole("button",{name:"准备执行"}));dialog=await screen.findByRole("alertdialog");await userEvent.click(within(dialog).getByRole("button",{name:"确认"}));
 await screen.findByText("等待重启");expect(r.api.queueMaintenance).toHaveBeenCalledExactlyOnceWith({action:"backup",target:"D:/backup"});expect(screen.queryByRole("button",{name:"重启执行"})).toBeNull();
 await userEvent.click(screen.getByRole("button",{name:"取消"}));await screen.findByRole("button",{name:"准备执行"});expect(r.api.cancelMaintenance).toHaveBeenCalledOnce();
});
test("restore includes source, explains account replacement and preserves error details for actionable retry",async()=>{
 const r=rig({queueMaintenance:vi.fn().mockRejectedValueOnce(new ApiError(409,{code:"MAINTENANCE_BUSY",message:"busy"})).mockRejectedValueOnce(new ApiError(409,{code:"BACKUP_INVALID",message:"invalid"})).mockRejectedValueOnce(Error("disk"))});
 await userEvent.selectOptions(screen.getByRole("combobox"),"restore");expect(screen.getByRole("button",{name:"准备执行"})).toBeDisabled();await userEvent.type(screen.getByLabelText("备份目录"),"D:/old");
 const dialog=await prepare();expect(within(dialog).getByText(/恢复后将使用备份中的账号和配置/)).toBeInTheDocument();
 for(const message of ["请先等待当前任务、排版或下载完成。","备份未通过文件、密钥或数据库校验。","操作未完成，请检查目录、权限和可用空间后重试。"]){await userEvent.click(within(dialog).getByRole("button",{name:"确认"}));await vi.waitFor(()=>expect(within(dialog).getByRole("alert")).toHaveTextContent(message));}
 expect(r.api.queueMaintenance).toHaveBeenLastCalledWith({action:"restore",source:"D:/old",target:"D:/backup"});
});
test("desktop folder selection handles cancellation and failure, queues restore, restarts or reports a failed restart",async()=>{
 host.value="electron";const r=rig({pickFolder:vi.fn().mockResolvedValueOnce({path:null}).mockRejectedValueOnce(Error("picker")).mockResolvedValueOnce({path:"D:/archives/"}).mockResolvedValueOnce({path:"D:/source"}),restartApp:vi.fn().mockRejectedValueOnce(Error("busy")).mockResolvedValue({ok:true})});
 await userEvent.click(screen.getByRole("button",{name:"选择"}));expect(screen.getByLabelText("新目标目录")).toHaveValue("");await userEvent.click(screen.getByRole("button",{name:"选择"}));await screen.findByRole("alert");
 await userEvent.click(screen.getByRole("button",{name:"选择"}));expect((screen.getByLabelText("新目标目录") as HTMLInputElement).value).toContain("D:/archives/RUYIN-backup-");
 await userEvent.selectOptions(screen.getByRole("combobox"),"restore");await userEvent.click(screen.getAllByRole("button",{name:"选择"})[0]!);expect(screen.getByLabelText("备份目录")).toHaveValue("D:/source");
 await userEvent.click(screen.getByRole("button",{name:"准备执行"}));await userEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button",{name:"确认"}));
 await userEvent.click(await screen.findByRole("button",{name:"重启执行"}));await screen.findByRole("alert");await userEvent.click(screen.getByRole("button",{name:"重启执行"}));await vi.waitFor(()=>expect(r.api.restartApp).toHaveBeenCalledTimes(2));
 vi.mocked(r.api.cancelMaintenance).mockRejectedValueOnce(Error("busy"));await userEvent.click(screen.getByRole("button",{name:"取消"}));await screen.findByRole("alert");
});
test("unavailable state retries; running operations cannot be cancelled; completed and failed operations allow a new target",async()=>{
 const r=rig({maintenance:vi.fn().mockRejectedValueOnce(Error("offline")).mockResolvedValueOnce({operation:record("running")})});
 await screen.findByRole("alert");await userEvent.click(screen.getByRole("button",{name:"重试"}));await screen.findByText("正在执行");expect(screen.getByRole("button",{name:"取消"})).toBeDisabled();r.unmount();
 const failed=rig({maintenance:vi.fn(async()=>({operation:record("failed")}))});await screen.findByText("执行失败，原数据保留");expect(screen.getByRole("button",{name:"准备执行"})).toBeDisabled();failed.unmount();
 rig({maintenance:vi.fn(async()=>({operation:{...record("completed"),action:"restore" as const}}))});await screen.findByText("验证完成");expect(screen.getByRole("button",{name:"准备执行"})).toBeDisabled();
});
const report:DiagnosticReport={schema:"ruyin-diagnostics/1",version:"test",createdAt:"now",platform:"win32",arch:"x64",checks:[{id:"runtime",status:"ok"},{id:"agents",status:"attention",total:2,available:1},{id:"ui",status:"unknown"}]};
test("diagnostics runs only on request, shows remedies, exports only the received report and revokes its object URL",async()=>{
 const api={diagnostics:vi.fn().mockRejectedValueOnce(Error("offline")).mockResolvedValue(report)} as unknown as Api;
 const create=vi.fn((_blob:Blob)=>"blob:report"),revoke=vi.fn();vi.stubGlobal("URL",{createObjectURL:create,revokeObjectURL:revoke});const click=vi.spyOn(HTMLAnchorElement.prototype,"click").mockImplementation(()=>{});
 try{
  render(<DiagnosticsSettings api={api}/>);expect(api.diagnostics).not.toHaveBeenCalled();expect(screen.getByRole("button",{name:"导出报告"})).toBeDisabled();await userEvent.click(screen.getByRole("button",{name:"运行检查"}));await screen.findByRole("alert");
  await userEvent.click(screen.getByRole("button",{name:"运行检查"}));await screen.findByText("智能体校验");expect(screen.getByText("到智能体管理重新导入通过验证的安装包。")).toBeInTheDocument();expect(create).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole("button",{name:"导出报告"}));expect(create).toHaveBeenCalledOnce();const blob=create.mock.calls[0]![0];expect(blob.type).toBe("application/json");expect(blob.size).toBe(JSON.stringify(report,null,2).length);expect((click.mock.instances[0] as HTMLAnchorElement).download).toBe("ruyin-diagnostics.json");await vi.waitFor(()=>expect(revoke).toHaveBeenCalledExactlyOnceWith("blob:report"),{timeout:2000});
 }finally{vi.unstubAllGlobals();}
});
test("pending status and diagnostics requests may finish after the user leaves the page",async()=>{
 let status!:(value:{operation:null})=>void,diag!:(value:DiagnosticReport)=>void;
 const r=rig({maintenance:vi.fn(()=>new Promise<{operation:null}>(resolve=>{status=resolve;}))});r.unmount();status({operation:null});
 const view=render(<DiagnosticsSettings api={{diagnostics:()=>new Promise(resolve=>{diag=resolve;})} as unknown as Api}/>);fireEvent.click(screen.getByRole("button",{name:"运行检查"}));expect(screen.getByRole("button",{name:"正在检查…"})).toBeDisabled();view.unmount();diag(report);
});
