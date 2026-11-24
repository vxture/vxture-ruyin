import { test, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ProjectWorkflowNav } from "./project-workflow-nav.js";
test("workflow exposes one merged settings entry, stage status and recorded duration",async()=>{
 const navigate=vi.fn();
 render(<ProjectWorkflowNav projectId="p" activeId="requirements" collapsed={false} onToggle={()=>{}} onNavigate={navigate} footer={null} items={[
  {id:"analysis",label:"Analysis",state:"complete",startedAt:"2026-11-19T01:00:00Z",completedAt:"2026-11-19T01:05:00Z"},
  {id:"requirements",label:"Requirements",state:"pending"},
 ]}/>);
 const settings=screen.getByRole('link',{name:/Project settings|项目设置/});
 expect(settings).toHaveAttribute('href','#ws/p/overview');
 expect(screen.queryByRole('link',{name:/Project information|项目信息|Project configuration|项目配置/})).toBeNull();
 expect(screen.getByText(/5 minutes|5分钟/)).toBeInTheDocument();
 const stage=screen.getByRole('link',{name:'Requirements'});expect(stage).toHaveAttribute('aria-current','step');expect(stage).toHaveTextContent('02 Requirements');
 await userEvent.click(stage);expect(navigate).toHaveBeenCalledWith('#ws/p/product/requirements');
 await userEvent.click(settings);expect(navigate).toHaveBeenCalledWith('#ws/p/overview');
});

test('collapsed workflow retains stage targets and total duration only when all stages finish',async()=>{
 const onToggle=vi.fn();
 const props={projectId:'p',activeId:'configuration',collapsed:true,onToggle,onNavigate:vi.fn(),footer:null};
 const {rerender}=render(<ProjectWorkflowNav {...props} items={[{id:'analysis',label:'Analyze',state:'complete',startedAt:'2026-11-19T01:00:00Z',completedAt:'2026-11-19T01:00:20Z'}]}/>);
 expect(screen.getByRole('link',{name:/Project settings|项目设置/})).toHaveAttribute('aria-current','page');
 expect(screen.getAllByText(/Less than a minute|不足1分钟|不到1分钟/)).toHaveLength(2);
 await userEvent.click(screen.getByRole('button',{name:/Expand navigation|展开导航/}));expect(onToggle).toHaveBeenCalledTimes(1);
 rerender(<ProjectWorkflowNav {...props} items={[{id:'analysis',label:'Analyze'}]}/>);
 expect(screen.getByRole('link',{name:'Analyze'})).not.toHaveAttribute('aria-current');
 expect(document.querySelector('.workflow-step')).toHaveAttribute('data-state','pending');
 expect(document.querySelector('.workflow-total')).toHaveTextContent(/Not recorded|未记录/);
});
