import { test, expect, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach } from "vitest";
import { ProductHome } from "./product-home";
import { Api, type ProductInfo, type ProjectMeta } from "./api";

afterEach(() => {cleanup();vi.restoreAllMocks();localStorage.clear();});
const product = {id:"bidproposal",name:"Bid",availability:"available"} as ProductInfo;
const projects: ProjectMeta[] = [
  {id:"a",name:"Alpha",productId:"bidproposal",productVersion:"1",projectType:"project",workspaceId:"w",createdAt:"2026-11-01T00:00:00Z"},
  {id:"b",name:"Beta",productId:"bidproposal",productVersion:"1",projectType:"project",workspaceId:"w",createdAt:"2026-11-02T00:00:00Z",archivedAt:"2026-11-03T00:00:00Z"},
  {id:"c",name:"Foreign",productId:"other",productVersion:"1",projectType:"project",workspaceId:"w",createdAt:"2026-11-03T00:00:00Z"},
];
function props() { return {api:{createProject:vi.fn().mockResolvedValue({id:"new"})} as unknown as Api,product,projects,catalog:false,onCatalog:vi.fn(),onOpen:vi.fn(),onCreated:vi.fn(),onRefresh:vi.fn()}; }
test("resume is validated against current product list and does not create a project",async()=>{
  localStorage.setItem('ruyin-last-project:w:bidproposal','a');
  const p=props();render(<ProductHome {...p}/>);
  await userEvent.click(screen.getByRole('button',{name:/Continue work|继续工作/}));
  expect(p.onOpen).toHaveBeenCalledWith('a');expect(p.api.createProject).not.toHaveBeenCalled();
  expect(screen.queryByText('Foreign')).toBeNull();expect(screen.queryByText('Beta')).toBeNull();
});
test("catalog filters archived projects and searches names",async()=>{
  const p=props();render(<ProductHome {...p} catalog/>);const user=userEvent.setup();
  expect(screen.getByText('Alpha')).toBeTruthy();expect(screen.queryByText('Beta')).toBeNull();
  await user.selectOptions(screen.getByRole('combobox',{name:/Project status|项目状态/}),'archived');
  expect(screen.getByText('Beta')).toBeTruthy();expect(screen.queryByText('Alpha')).toBeNull();
  await user.type(screen.getByRole('textbox',{name:/Search project|搜索项目/}),'missing');
  expect(screen.queryByText('Beta')).toBeNull();expect(screen.queryByText('Foreign')).toBeNull();
});
test("explicit named creation is the only creation path and handles failure",async()=>{
  const p=props();vi.mocked(p.api.createProject).mockRejectedValue(new Error('Create failed'));
  render(<ProductHome {...p}/>);const user=userEvent.setup();
  await user.click(screen.getByRole('button',{name:/New project|新建项目/}));
  await user.type(screen.getByRole('textbox'), '  New bid  ');
  await user.click(screen.getByRole('button',{name:/Create and open|创建并进入/}));
  expect(p.api.createProject).toHaveBeenCalledWith('bidproposal','New bid');
  expect(await screen.findByRole('alert')).toHaveTextContent('Create failed');expect(p.onCreated).not.toHaveBeenCalled();
});
test("failed refresh hides stale projects and resume, and supports retry without creating data",async()=>{
  localStorage.setItem('ruyin-last-project:w:bidproposal','a');
  const p=props();const {rerender}=render(<ProductHome {...p} projectsState="failed"/>);
  expect(screen.getByRole('heading',{name:/Projects could not be loaded|项目读取失败/})).toBeTruthy();
  expect(screen.queryByText('Alpha')).toBeNull();
  expect(screen.queryByText(/No current projects|暂无进行中的项目/)).toBeNull();
  expect(screen.queryByRole('button',{name:/Continue work|继续工作/})).toBeNull();
  expect(screen.getByRole('button',{name:/New project|新建项目/})).toBeDisabled();
  await userEvent.click(screen.getByRole('button',{name:/Retry loading|重新读取/}));
  expect(p.onRefresh).toHaveBeenCalledTimes(1);expect(p.api.createProject).not.toHaveBeenCalled();
  rerender(<ProductHome {...p} projectsState="ready"/>);
  expect(screen.getByText('Alpha')).toBeTruthy();
  expect(screen.getByRole('button',{name:/Continue work|继续工作/})).toBeEnabled();
});
test("loading catalog does not report a zero result or expose stale rows",()=>{
  render(<ProductHome {...props()} projectsState="loading" catalog/>);
  expect(screen.getByRole('heading',{name:/Loading projects|正在读取项目/})).toBeTruthy();
  expect(screen.queryByText('Alpha')).toBeNull();
  expect(screen.queryByRole('textbox')).toBeNull();
  expect(screen.getByRole('button',{name:/New project|新建项目/})).toBeDisabled();
});

test("create trims the name, waits for opening, clears the form and supports cancel",async()=>{
 const p=props();render(<ProductHome {...p}/>);const user=userEvent.setup();
 await user.click(screen.getByRole('button',{name:/New project|新建项目/}));
 fireEvent.submit(screen.getByRole('textbox').closest('form')!);
 expect(p.api.createProject).not.toHaveBeenCalled();
 await user.type(screen.getByRole('textbox'),'  New bid  ');
 await user.click(screen.getByRole('button',{name:/Create and open|创建并进入/}));
 await waitFor(()=>expect(p.onCreated).toHaveBeenCalledWith('new'));
 await waitFor(()=>expect(screen.queryByRole('textbox')).toBeNull());
 await user.click(screen.getByRole('button',{name:/New project|新建项目/}));
 expect(screen.getByRole('textbox')).toHaveValue('');
 await user.click(screen.getByRole('button',{name:/Cancel|取消/}));
 expect(screen.queryByRole('textbox')).toBeNull();
});

test("catalog sorts and opens projects, reports refresh errors, and recovers",async()=>{
 const p=props();p.onRefresh.mockRejectedValueOnce('Refresh offline');
 render(<ProductHome {...p} catalog projects={[...projects,{...projects[0]!,id:'z',name:'Zulu',createdAt:'2026-11-04T00:00:00Z'}]}/>);
 const user=userEvent.setup();
 await user.selectOptions(screen.getByRole('combobox',{name:/Project status|项目状态/}),'all');
 await user.selectOptions(screen.getByRole('combobox',{name:/Sort|排序/}),'name');
 expect(Array.from(document.querySelectorAll('.product-project-row strong')).map(el=>el.textContent)).toEqual(['Alpha','Beta','Zulu']);
 await user.click(screen.getByRole('button',{name:/Alpha/}));expect(p.onOpen).toHaveBeenCalledWith('a');
 await user.click(screen.getByRole('button',{name:/Refresh|刷新/}));
 expect(await screen.findByRole('alert')).toHaveTextContent('Refresh offline');
 await user.click(screen.getByRole('button',{name:/Refresh|刷新/}));
 await waitFor(()=>expect(screen.queryByRole('alert')).toBeNull());
 expect(p.onRefresh).toHaveBeenCalledTimes(2);
});

test("unavailable storage and empty project list still allow explicit product actions",async()=>{
 const storage=vi.spyOn(Storage.prototype,'getItem').mockImplementation(()=>{throw Error('Storage blocked');});
 const p=props(),onLibrary=vi.fn();render(<ProductHome {...p} projects={[]} onLibrary={onLibrary}/>);
 expect(screen.getByText(/No current projects|尚无进行中的项目/)).toBeTruthy();
 await userEvent.click(screen.getByRole('button',{name:/All projects|全部项目/}));expect(p.onCatalog).toHaveBeenCalledTimes(1);
 await userEvent.click(screen.getByRole('button',{name:/Manage materials|管理知识资料/}));expect(onLibrary).toHaveBeenCalledTimes(1);
 storage.mockRestore();
});

test('non-Error creation failure preserves the name and failed retry shows the current cause',async()=>{
 const p=props();vi.mocked(p.api.createProject).mockRejectedValue('Create refused');p.onRefresh.mockRejectedValue(Error('Still offline'));
 const {rerender}=render(<ProductHome {...p}/>);const user=userEvent.setup();
 await user.click(screen.getByRole('button',{name:/New project|新建项目/}));await user.type(screen.getByRole('textbox'),'Keep this name');
 await user.click(screen.getByRole('button',{name:/Create and open|创建并进入/}));
 expect(await screen.findByRole('alert')).toHaveTextContent('Create refused');expect(screen.getByRole('textbox')).toHaveValue('Keep this name');
 rerender(<ProductHome {...p} projectsState="failed"/>);
 await user.click(screen.getByRole('button',{name:/Retry loading|重新读取/}));expect(await screen.findByRole('alert')).toHaveTextContent('Still offline');
});
