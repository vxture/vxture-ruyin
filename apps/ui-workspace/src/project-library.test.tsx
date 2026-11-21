import {test,expect,vi,afterEach} from "vitest";
import {render,screen,cleanup,waitFor} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {ProjectLibrary} from "./project-library";
import {Api,type LibrarySelection} from "./api";
afterEach(cleanup);
test("explicit version choice pins the requested revision, source preview reads the pin, and removal preserves library resources",async()=>{
 let selection:LibrarySelection={revision:1,items:[{id:"resource",name:"Synthetic qualification.md",version:1,hash:"a".repeat(64),fileId:"f1",readingId:"r1",category:"qualification",selectedAt:"2026-11-20"}]};
 const resources=[{id:"resource",name:"Synthetic qualification.md",category:"qualification",versions:[{version:1,reading:{state:"completed"}},{version:2,reading:{state:"completed"}}]}];const api={projectLibrary:vi.fn().mockResolvedValue({items:resources}),librarySelection:vi.fn(async()=>structuredClone(selection)),selectLibraryResource:vi.fn(async(_pid,id,version,revision)=>{expect(revision).toBe(1);selection={revision:2,items:[{...selection.items[0]!,id,version}]};return selection;}),unselectLibraryResource:vi.fn(async()=>{selection={revision:3,items:[]};return selection;}),selectedResourceUnit:vi.fn().mockResolvedValue({text:"Synthetic version one source",total:1})} as unknown as Api;
 render(<ProjectLibrary api={api} projectId="project-a" productId="bidproposal"/>);await screen.findByText(/New version available|有新版本可选/);expect(api.selectLibraryResource).not.toHaveBeenCalled();await userEvent.click(screen.getByRole('button',{name:/View source|查看原文/}));expect(api.selectedResourceUnit).toHaveBeenCalledWith('project-a','r1',0);expect(await screen.findByText('Synthetic version one source')).toBeTruthy();await userEvent.click(screen.getByRole('button',{name:/^Select materials$|^选择资料$/}));await userEvent.selectOptions(screen.getByRole('combobox',{name:'Synthetic qualification.md'}),'2');await userEvent.click(screen.getAllByRole('button',{name:/^Select materials$|^选择资料$/}).at(-1)!);await waitFor(()=>expect(api.selectLibraryResource).toHaveBeenCalledWith('project-a','resource',2,1));await userEvent.click(screen.getByRole('button',{name:/Remove selection|移出本次选用/}));await waitFor(()=>expect(api.unselectLibraryResource).toHaveBeenCalledWith('project-a','resource',2));expect(resources).toHaveLength(1);
});
test("archived configuration cannot change selected materials",async()=>{const api={projectLibrary:vi.fn().mockResolvedValue({items:[]}),librarySelection:vi.fn().mockResolvedValue({revision:0,items:[]})} as unknown as Api;render(<ProjectLibrary api={api} projectId="p" productId="bidproposal" archived/>);await screen.findByText(/No shared materials|尚未选用共享资料/);expect(screen.getByRole('button',{name:/Select materials|选择资料/})).toBeDisabled();});

function selectedApi(){return {
 projectLibrary:vi.fn().mockResolvedValue({items:[]}),
 librarySelection:vi.fn().mockResolvedValue({revision:1,items:[{id:'r',name:'Selected source',version:1,readingId:'reading'}]}),
 selectedResourceUnit:vi.fn().mockImplementation(async(_p,_r,index)=>({text:'Source unit '+index,total:2})),
 unselectLibraryResource:vi.fn().mockResolvedValue({revision:2,items:[]}),
};}

test('selected source preview changes units, closes, and reports inaccessible originals',async()=>{
 const api=selectedApi();render(<ProjectLibrary api={api as unknown as Api} projectId="p" productId="bidproposal"/>);
 await screen.findByText('Selected source');const user=userEvent.setup();
 await user.click(screen.getByRole('button',{name:/View source|查看原文/}));
 expect(await screen.findByText('Source unit 0')).toBeTruthy();
 await user.selectOptions(screen.getByRole('combobox',{name:/View source|查看原文/}),'1');
 expect(await screen.findByText('Source unit 1')).toBeTruthy();expect(api.selectedResourceUnit).toHaveBeenLastCalledWith('p','reading',1);
 await user.click(screen.getByRole('button',{name:/Close|关闭/}));expect(screen.queryByText('Source unit 1')).toBeNull();
 api.selectedResourceUnit.mockRejectedValueOnce(Error('Original unavailable'));
 await user.click(screen.getByRole('button',{name:/View source|查看原文/}));expect(await screen.findByRole('alert')).toHaveTextContent('Original unavailable');
});

test('revision conflicts preserve selections and allow retry after refreshed data',async()=>{
 const api=selectedApi();api.unselectLibraryResource.mockRejectedValueOnce(Error('Selection changed'));
 render(<ProjectLibrary api={api as unknown as Api} projectId="p" productId="bidproposal"/>);
 await screen.findByText('Selected source');const user=userEvent.setup();
 await user.click(screen.getByRole('button',{name:/Remove selection|移出本次选用/}));
 expect(await screen.findByRole('alert')).toHaveTextContent('Selection changed');expect(screen.getByText('Selected source')).toBeTruthy();
 await user.click(screen.getByRole('button',{name:/Remove selection|移出本次选用/}));
 await waitFor(()=>expect(api.unselectLibraryResource).toHaveBeenCalledTimes(2));
 await waitFor(()=>expect(screen.queryByRole('alert')).toBeNull());
});

test('initial and picker refresh failures are visible without losing existing pins',async()=>{
 const api=selectedApi();api.projectLibrary.mockRejectedValueOnce(Error('Library offline'));
 const {unmount}=render(<ProjectLibrary api={api as unknown as Api} projectId="p" productId="bidproposal"/>);
 expect(await screen.findByRole('alert')).toHaveTextContent('Library offline');expect(screen.getByRole('button',{name:/Select materials|选择资料/})).toBeDisabled();unmount();
 render(<ProjectLibrary api={api as unknown as Api} projectId="p" productId="bidproposal"/>);await screen.findByText('Selected source');
 api.projectLibrary.mockRejectedValueOnce(Error('Refresh offline'));
 await userEvent.click(screen.getByRole('button',{name:/Select materials|选择资料/}));
 expect(await screen.findByRole('alert')).toHaveTextContent('Refresh offline');expect(screen.getByText('Selected source')).toBeTruthy();
});

test('unparsed materials are visible in the picker and cannot be selected',async()=>{
 const api=selectedApi();api.projectLibrary.mockResolvedValue({items:[{id:'r',name:'Unread original',versions:[{version:1,reading:{state:'failed'}}]}]} as never);
 render(<ProjectLibrary api={api as unknown as Api} projectId="p" productId="bidproposal"/>);await screen.findByText('Selected source');
 await userEvent.click(screen.getByRole('button',{name:/Select materials|选择资料/}));
 expect(screen.getAllByRole('button',{name:/Select materials|选择资料/}).at(-1)).toBeDisabled();
 expect(screen.getByRole('link',{name:/Manage|管理/})).toHaveAttribute('href','#library/bidproposal');
});
