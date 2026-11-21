import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { DesktopDevicePicker, DesktopDevicesSection } from "./desktop-devices";
import { Api, type DesktopDeviceList } from "./api";
import { LocaleContext } from "./i18n";

const view: DesktopDeviceList = {limit:3,devices:[
  {id:"one",name:"Office PC",platform:"win32",lastActiveAt:"2026-11-21T04:00:00Z",current:true},
  {id:"two",name:"Laptop",platform:"darwin",lastActiveAt:"2026-11-20T04:00:00Z",current:false},
]};

test("each computer keeps OS and recent activity together in its secondary information",()=>{
  render(<DesktopDevicePicker view={view} mode="login" onRelease={async()=>{}} onRefresh={async()=>{}}/>);
  const row=screen.getByRole("radio",{name:/Laptop/}).closest("label")!;
  const secondary=row.querySelector(".desktop-device-meta")!;
  expect(secondary).toHaveTextContent("macOS · 最近活动：");
  expect(secondary.querySelector("time")).toHaveAttribute("dateTime",view.devices[1]!.lastActiveAt);
  expect(row.querySelector(".desktop-device-name")).toHaveTextContent("Laptop");
  expect(screen.queryByText("电脑名称")).not.toBeInTheDocument();
});

test("device picker never selects a victim; selection, warning and explicit confirmation precede release",async()=>{
  let settle!:()=>void;const release=vi.fn().mockImplementation(()=>new Promise<void>(r=>{settle=r;}));
  render(<DesktopDevicePicker view={view} mode="login" onRelease={release} onRefresh={async()=>{}}/>);
  const button=screen.getByRole("button",{name:"释放并在此登录"});
  expect(button).toBeDisabled();expect(screen.getByRole("radio",{name:/Office PC/})).toBeDisabled();
  expect(release).not.toHaveBeenCalled();fireEvent.click(button);expect(release).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("radio",{name:/Laptop/}));
  fireEvent.click(button);
  const dialog=screen.getByRole("alertdialog",{name:"确认释放这台电脑？"});
  expect(within(dialog).getByText("Laptop")).toBeInTheDocument();expect(release).not.toHaveBeenCalled();
  expect(within(dialog).queryByText(/任务后续需要授权时可能暂停/)).not.toBeInTheDocument();
  fireEvent.click(within(dialog).getByRole("button",{name:"确认释放并继续"}));
  expect(within(dialog).getByRole("button",{name:"正在确认释放…"})).toBeDisabled();
  fireEvent.keyDown(dialog,{key:"Escape",code:"Escape"});expect(dialog).toBeInTheDocument();
  expect(release).toHaveBeenCalledExactlyOnceWith("two");settle();
  await waitFor(()=>expect(screen.getByRole("button",{name:"释放并在此登录"})).toBeDisabled());
});

test("release failure remains visible and refresh failure is actionable",async()=>{
  const release=vi.fn().mockRejectedValue(Error("offline")),refresh=vi.fn().mockRejectedValue(Error("offline"));
  render(<DesktopDevicePicker view={view} mode="manage" onRelease={release} onRefresh={refresh}/>);
  fireEvent.click(screen.getByRole("radio",{name:/Laptop/}));fireEvent.click(screen.getByRole("button",{name:"释放所选设备"}));
  fireEvent.click(screen.getByRole("button",{name:"确认释放"}));
  expect(await screen.findByRole("alert")).toHaveTextContent("尚未确认释放结果");
  fireEvent.click(screen.getByRole("button",{name:"刷新设备"}));
  expect(await screen.findByRole("alert")).toBeInTheDocument();expect(refresh).toHaveBeenCalledTimes(1);
});

test("account devices use platform values, release remote selection and refresh authoritative list",async()=>{
  const desktopDevices=vi.fn().mockResolvedValueOnce({supported:true,...view}).mockResolvedValue({supported:true,limit:8,devices:[]});
  const releaseDesktopDevice=vi.fn().mockResolvedValue({ok:true});
  render(<DesktopDevicesSection api={{desktopDevices,releaseDesktopDevice} as unknown as Api}/>);
  expect(screen.getByRole("status")).toHaveTextContent("正在读取");
  expect(await screen.findByText("已授权 2 台 · 账号上限 3 台，浏览器会话单独管理。")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("radio",{name:/Laptop/}));fireEvent.click(screen.getByRole("button",{name:"释放所选设备"}));
  fireEvent.click(screen.getByRole("button",{name:"确认释放"}));
  expect(await screen.findByText("暂无已授权的桌面设备。")).toBeInTheDocument();
  expect(releaseDesktopDevice).toHaveBeenCalledExactlyOnceWith("two");
  expect(screen.getByText(/账号上限 8 台/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button",{name:"刷新设备"}));await waitFor(()=>expect(desktopDevices).toHaveBeenCalledTimes(3));
});

test("unsupported is different from outage; refresh recovers without a local fallback limit",async()=>{
  const desktopDevices=vi.fn().mockResolvedValueOnce({supported:false}).mockRejectedValueOnce(Error("offline")).mockResolvedValue({supported:true,...view});
  render(<DesktopDevicesSection api={{desktopDevices} as unknown as Api}/>);
  expect(await screen.findByRole("status")).toBeInTheDocument();
  await screen.findByText("当前平台尚未接入桌面设备管理。");
  expect(screen.queryByRole("radio")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button",{name:"刷新设备"}));
  await screen.findByText("暂时无法读取设备，当前登录会话保留，请重试。");
  fireEvent.click(screen.getByRole("button",{name:"刷新设备"}));
  expect(await screen.findByRole("radio",{name:/Laptop/})).toBeInTheDocument();
});

test("English device-limit view displays the returned policy and a compact identity confirmation",()=>{
  render(<LocaleContext.Provider value="en"><DesktopDevicePicker view={{...view,limit:5}} mode="login" onRelease={async()=>{}} onRefresh={async()=>{}}/></LocaleContext.Provider>);
  expect(screen.getByText("2 / 5 authorized")).toBeInTheDocument();
  expect(screen.getByText("Device authorization limit reached. Release a device to continue.")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("radio",{name:/Laptop/}));
  fireEvent.click(screen.getByRole("button",{name:"Release and sign in here"}));
  const dialog=screen.getByRole("alertdialog",{name:"Release this computer?"});
  expect(within(dialog).getByText("Laptop")).toBeInTheDocument();
  expect(within(dialog).getByRole("button",{name:"Confirm and continue"})).toBeInTheDocument();
});

test("cancel and Escape from confirmation perform no release and preserve the exact system-defined name",async()=>{
  const release=vi.fn();const computerName="客户设置的电脑 名称-α";
  const names={limit:3,devices:[{...view.devices[1]!,name:computerName}]};
  render(<DesktopDevicePicker view={names} mode="manage" onRelease={release} onRefresh={async()=>{}}/>);
  expect(screen.getByText(computerName)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("radio",{name:new RegExp(computerName)}));
  fireEvent.click(screen.getByRole("button",{name:"释放所选设备"}));
  expect(within(screen.getByRole("alertdialog")).getByText(computerName)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button",{name:"暂不释放"}));
  await waitFor(()=>expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
  fireEvent.click(screen.getByRole("button",{name:"释放所选设备"}));
  fireEvent.keyDown(screen.getByRole("alertdialog"),{key:"Escape",code:"Escape"});
  await waitFor(()=>expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
  expect(release).not.toHaveBeenCalled();expect(screen.getByText(computerName)).toBeInTheDocument();
});
