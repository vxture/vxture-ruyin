/**
 * Original Node runtime adapter shared by native and product server hosts.
 * @package @vxture/ruyin-node-runtime
 * @layer Infrastructure
 * @category Runtime
 * @author AI-Generated
 * @date 2026-11-25
 */
/** Declarative task batches. No product code executes in the host process. */
import { createHash } from "node:crypto";
import type { ProjectRuntime, TaskInstanceRecord } from "@vxture/ruyin-core";
import type { EventBus } from "./events.js";
import type { TaskRunner } from "./task-runner.js";

type Doc = {id: string; markdown: string; revision: number};
export interface JobDocuments {
  get(pid: string, product: string, id: string): Doc | undefined;
  put(pid: string, product: string, id: string, markdown: string, revision: number): Doc | undefined;
  list(pid: string, product: string, prefix: string): Doc[];
}
interface StepInput { id: string; taskId: string; context?: {id: string; markdown: string} }
export interface JobInput { id: string; label: string; sources: {id: string; revision: number}[]; steps: StepInput[] }
interface Step extends StepInput {state: "pending" | "submitting" | "running" | "done"; attempt?: number; previousTasks?: string[]; taskInstanceId?: string; resultDocument?: string; runtimeState?: string; waitingOn?: string[]}
export interface BackgroundJob extends Omit<JobInput, "steps"> {steps: Step[]; state: "running" | "waiting" | "paused" | "cancelling" | "completed" | "error" | "cancelled"; cancelRequested?: boolean; paused: boolean; createdAt: string; updatedAt: string; contractHash: string; requestHash: string; contextApproval?: {requestHash:string; contractHash:string; at:string}; error?: string}
/** Host-session view only. Correlation changes presentation, never authorization. */
export interface BackgroundJobSummary {
  id: string;
  label: string;
  state: string;
  requestHash: string;
  approved: boolean;
  approvable: boolean;
  steps: number;
  bytes: number;
  contextConfirmations: Array<{taskInstanceId: string; checkpointId: string}>;
}
const hash = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex");
const terminal = new Set(["completed", "failed", "cancelled", "rejected"]);
const validId = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9_-]{1,80}$/.test(v);
const writable = (v: unknown): v is string => validId(v) && !v.startsWith("runtime_");
export class BackgroundJobs {
  private readonly locks = new Set<string>();
  private readonly active = new Map<string, {pid: string; product: string; id: string}>();
  get activeCount():number {
    return [...this.active.values()].filter(item=>{
      const job=this.get(item.pid,item.product,item.id);
      return job&&!['completed','error','cancelled','waiting'].includes(job.state)&&(!job.paused||job.state==='cancelling');
    }).length;
  }
  private timer?: ReturnType<typeof setTimeout>;
  private unsubscribe?: () => void;
  constructor(private readonly runtime: ProjectRuntime, private readonly tasks: TaskRunner, private readonly docs: JobDocuments, private readonly events?: EventBus) {}
  private key(pid: string, id: string) { return pid + ":" + id; }
  get(pid: string, product: string, id: string): BackgroundJob | undefined {
    const doc = this.docs.get(pid, product, "runtime_job_" + id); return doc ? JSON.parse(doc.markdown) as BackgroundJob : undefined;
  }
  list(pid: string, product: string): BackgroundJob[] { return this.docs.list(pid, product, "runtime_job_").map(d => JSON.parse(d.markdown) as BackgroundJob); }
  async summaries(pid: string, product: string): Promise<BackgroundJobSummary[]> {
    const view = await this.runtime.openProject(pid);
    if (view.meta.productId !== product) throw Error("Project unavailable");
    const instances = new Map((await this.runtime.listTaskInstances(pid)).map(task => [task.id, task]));
    const contractHash = hash(view.contract);
    return this.list(pid, product).map(job => {
      const approvable = job.steps.every(step => !!step.context && view.contract.tasks.find(t => t.id === step.taskId)?.input_types.length === 1);
      let contextConfirmations: BackgroundJobSummary["contextConfirmations"] = [];
      if (approvable && !view.meta.archivedAt && !job.cancelRequested && ["running", "waiting", "paused"].includes(job.state) && job.contractHash === contractHash) {
        // A stale batch must not hide the standalone prompt that explains its problem.
        try {
          this.checkSources(pid, product, job);
          contextConfirmations = job.steps.flatMap(step => {
            const task = step.taskInstanceId ? instances.get(step.taskInstanceId) : undefined;
            const checkpoint = task?.checkpoints.find(c => !c.decision);
            const definition = view.contract.tasks.find(t => t.id === step.taskId)!;
            const declared = view.contract.context.types.some(t => t.project_document === step.context!.id && definition.input_types.includes(t.id));
            if (step.state !== "running" || task?.taskId !== step.taskId || task.state !== "waiting_human" || checkpoint?.kind !== "context_confirm" || !declared || !this.matchesContext(pid, product, step, task)) return [];
            return [{taskInstanceId: task.id, checkpointId: checkpoint.id}];
          });
        } catch { /* Keep every individual confirmation visible on uncertain input. */ }
      }
      return {id: job.id, label: job.label, state: job.state, requestHash: job.requestHash,
        approved: !!job.contextApproval, approvable, steps: job.steps.length,
        bytes: job.steps.reduce((n, step) => n + Buffer.byteLength(step.context?.markdown ?? ""), 0), contextConfirmations};
    });
  }
  private matchesContext(pid: string, product: string, step: Step, task: Pick<TaskInstanceRecord, "contextSet">): boolean {
    const context = step.context, item = task.contextSet?.[0];
    if (!context || task.contextSet?.length !== 1 || item?.connector !== "project-document" || item.ref !== context.id) return false;
    const document = this.docs.get(pid, product, context.id);
    return !!document && item.documentRevision === document.revision && document.markdown === context.markdown;
  }
  private save(pid: string, product: string, job: BackgroundJob) {
    const id = "runtime_job_" + job.id, old = this.docs.get(pid, product, id);
    if (old?.markdown === JSON.stringify(job)) return;
    job.updatedAt = new Date().toISOString();
    if (!this.docs.put(pid, product, id, JSON.stringify(job), old?.revision ?? 0)) throw Error("Background job storage conflict");
    this.events?.publish({kind:"project", projectId:pid});
  }
  async create(pid: string, product: string, raw: unknown): Promise<BackgroundJob> {
    let input = raw as JobInput;
    if (!input || typeof input !== "object" || !/^[a-f0-9-]{36}$/.test(input.id) || typeof input.label !== "string" || input.label.length > 120 || !Array.isArray(input.sources) || input.sources.length > 12 || input.sources.some(s => !writable(s.id) || !Number.isSafeInteger(s.revision) || s.revision < 0) || !Array.isArray(input.steps) || !input.steps.length || input.steps.length > 80 || new Set(input.steps.map(s => s.id)).size !== input.steps.length || input.steps.some(s => !validId(s.id) || !validId(s.taskId) || s.context && (!writable(s.context.id) || typeof s.context.markdown !== "string" || Buffer.byteLength(s.context.markdown) > 200000)) || Buffer.byteLength(JSON.stringify(input)) > 4*1024*1024) throw Error("Invalid background job");
    // Never persist caller-provided state or authorization fields.
    input={id:input.id,label:input.label,sources:input.sources.map(s=>({id:s.id,revision:s.revision})),steps:input.steps.map(s=>({id:s.id,taskId:s.taskId,...(s.context?{context:{id:s.context.id,markdown:s.context.markdown}}:{})}))};
    const key = this.key(pid, input.id); if (this.locks.has(key)) throw Error("Background job is being updated; retry the same ID");
    this.locks.add(key);
    try {
      const old = this.get(pid, product, input.id);
      if (old) {if (old.requestHash !== hash(input)) throw Error("Job ID already belongs to a different request"); return old;}
      const view = await this.runtime.openProject(pid);
      if (view.meta.productId !== product || view.meta.archivedAt) throw Error("Project unavailable");
      for (const step of input.steps) {
        const task = view.contract.tasks.find(t => t.id === step.taskId); if (!task) throw Error("Task not declared by this product");
        if (step.context && !view.contract.context.types.some(t => t.project_document === step.context!.id && task.input_types.includes(t.id))) throw Error("Context document not declared for this task");
      }
      if (this.list(pid, product).some(j => !["completed","error","cancelled"].includes(j.state) && j.steps.some(s => input.steps.some(n => n.taskId === s.taskId || !!s.context && n.context?.id === s.context.id)))) throw Error("A background job already owns these task inputs");
      const at = new Date().toISOString(); const job: BackgroundJob = {...structuredClone(input),steps:input.steps.map(s => ({...s,state:"pending"})),paused:false,state:"running",createdAt:at,updatedAt:at,contractHash:hash(view.contract),requestHash:hash(input)};
      this.checkSources(pid, product, job); this.save(pid, product, job); this.active.set(key,{pid,product,id:job.id}); this.schedule(); return job;
    } finally {this.locks.delete(key);}
  }
  owns(pid: string, product: string, taskId?: string, documentId?: string): boolean {
    return this.list(pid,product).some(j => !["completed","error","cancelled"].includes(j.state) && j.steps.some(s => s.taskId === taskId || !!documentId && s.context?.id === documentId));
  }
  /** Called only by the authenticated host, never the product bridge. */
  async approveContext(pid:string, product:string, id:string, requestHash:unknown) {
    const key=this.key(pid,id);if(this.locks.has(key))throw Error("Job is updating; retry approval");this.locks.add(key);
    try {
      const job=this.get(pid,product,id);if(!job||job.requestHash!==requestHash||["completed","cancelled","error"].includes(job.state))throw Error("Approval request is stale");
      const view=await this.runtime.openProject(pid);
      if(view.meta.archivedAt||view.meta.productId!==product||hash(view.contract)!==job.contractHash)throw Error("Product contract changed");
      this.checkSources(pid,product,job);
      if(job.steps.some(s=>!s.context||view.contract.tasks.find(t=>t.id===s.taskId)?.input_types.length!==1))throw Error("Batch approval requires exactly one declared project context per step");
      job.contextApproval={requestHash:job.requestHash,contractHash:job.contractHash,at:new Date().toISOString()};this.save(pid,product,job);
      this.active.set(key,{pid,product,id});this.schedule();return job;
    } finally {this.locks.delete(key);}
  }
  async control(pid: string, product: string, id: string, action: unknown) {
    if (action !== "pause" && action !== "resume" && action !== "cancel" && action !== "retry") throw Error("Use pause, resume, cancel or retry");
    const key=this.key(pid,id); if (this.locks.has(key)) throw Error("Job is updating; retry control");
    this.locks.add(key);
    try {
      const job=this.get(pid,product,id);if(!job)throw Error("Job not found");
      if(action==="retry"){
        if(job.state!=="error")return job;
        this.checkSources(pid,product,job);
        if(hash((await this.runtime.openProject(pid)).contract)!==job.contractHash)throw Error("Product contract changed; start a new job");
        const step=job.steps.find(s=>s.state!=="done");
        if(step?.taskInstanceId){const task=(await this.runtime.listTaskInstances(pid)).find(t=>t.id===step.taskInstanceId);if(!task||!["failed","cancelled","rejected"].includes(task.state))throw Error("Cannot retry an uncertain task; inspect the runtime record");step.previousTasks=[...(step.previousTasks??[]),step.taskInstanceId];step.attempt=(step.attempt??0)+1;step.state="pending";delete step.taskInstanceId;delete step.runtimeState;delete step.waitingOn;delete step.resultDocument;}
        job.paused=false;job.state="running";delete job.error;delete job.cancelRequested;
      }else{
        if(["completed","error","cancelled"].includes(job.state))return job;
        if(job.cancelRequested&&action!=="cancel")throw Error("Cancellation is pending; it cannot be resumed");
        job.paused=action!=="resume";job.cancelRequested=action==="cancel";job.state=job.cancelRequested?(job.steps.some(s=>s.state==="running"||s.state==="submitting")?"cancelling":"cancelled"):job.paused?"paused":"running";
      }
      this.save(pid,product,job);this.active.set(key,{pid,product,id});this.schedule();return job;
    }
    finally {this.locks.delete(key);}
  }
  private checkSources(pid: string, product: string, job: BackgroundJob) {for(const source of job.sources)if((this.docs.get(pid,product,source.id)?.revision??0)!==source.revision)throw Error("Source document changed; saved results are preserved. Start a new job.");}
  /** Run once; callable in tests without timers or a browser. */
  async tick(pid: string, product: string, id: string): Promise<void> {
    const key=this.key(pid,id);if(this.locks.has(key))return;this.locks.add(key);
    try {
      const job=this.get(pid,product,id);if(!job||["completed","error","cancelled"].includes(job.state)){this.active.delete(key);return;}
      try {
        const view=await this.runtime.openProject(pid);if(view.meta.productId!==product||view.meta.archivedAt)throw Error("Project unavailable");
        let step=job.steps.find(s=>s.state==="running"||s.state==="submitting");
        if(job.cancelRequested&&(!step||step.state==="submitting"&&!step.taskInstanceId)){
          const key=step&&`job:${job.id}:${step.id}${step.attempt?":retry"+step.attempt:""}`;
          const existing=key&&(await this.runtime.listTaskInstances(pid)).find(task=>task.requestKey===key);
          if(!existing){job.state="cancelled";this.save(pid,product,job);this.active.delete(this.key(pid,id));return;}
          step!.taskInstanceId=existing.id;step!.state="running";
        }
        if(!step){if(job.paused)return;this.checkSources(pid,product,job);if(hash(view.contract)!==job.contractHash)throw Error("Product contract changed; start a new job");step=job.steps.find(s=>s.state==="pending");}
        if(!step){job.state="completed";this.save(pid,product,job);this.active.delete(key);return;}
        if(step.state==="pending"){
          if((await this.runtime.listTaskInstances(pid)).some(t=>t.taskId===step!.taskId&&!terminal.has(t.state)))throw Error("Another task is using this context; saved results preserved");
          if(step.context){const old=this.docs.get(pid,product,step.context.id);if(!this.docs.put(pid,product,step.context.id,step.context.markdown,old?.revision??0))throw Error("Context storage conflict");}
          step.state="submitting";this.save(pid,product,job);
        }
        if(step.state==="submitting"){
          this.checkSources(pid,product,job);
          if(hash(view.contract)!==job.contractHash)throw Error("Product contract changed; start a new job");
          if(step.context&&this.docs.get(pid,product,step.context.id)?.markdown!==step.context.markdown)throw Error("Prepared context changed; no automatic resubmission");
          const harness=await this.runtime.createHarness(pid);
          const task=await harness.startTask(step.taskId,undefined,{requestedBy:`product:${product}`,requestKey:`job:${job.id}:${step.id}${step.attempt?":retry"+step.attempt:""}`});
          step.taskInstanceId=task.id;step.state="running";this.save(pid,product,job);this.tasks.start(pid,task.id);
        }
        let task=(await this.runtime.listTaskInstances(pid)).find(t=>t.id===step!.taskInstanceId);if(!task)throw Error("Saved task is unavailable; no automatic resubmission");
        if(job.cancelRequested&&!terminal.has(task.state)){
          await this.tasks.cancel(pid,task.id);
          task=(await this.runtime.listTaskInstances(pid)).find(t=>t.id===step!.taskInstanceId)!;
          if(!task)throw Error("Cancelled task record unavailable");
        }
        const checkpoint=task.checkpoints.find(c=>!c.decision);
        if(!job.paused&&checkpoint?.kind==="context_confirm"&&job.contextApproval){
          this.checkSources(pid,product,job);
          const approval=job.contextApproval;
          if(approval.requestHash!==job.requestHash||approval.contractHash!==hash(view.contract)||!this.matchesContext(pid,product,step,task))throw Error("Approved batch context changed; inspect the runtime record");
          const harness=await this.runtime.createHarness(pid);
          task=await harness.decideCheckpoint(task.id,{choice:"approve",checkpointId:checkpoint.id});
          this.tasks.start(pid,task.id);
        }
        step.runtimeState=task.state;step.waitingOn=task.checkpoints.filter(c=>!c.decision).map(c=>c.kind);
        if(Object.keys(task.capabilityOutputs).length){
          const resultId="runtime_result_"+job.id+"_"+job.steps.indexOf(step), old=this.docs.get(pid,product,resultId);
          const markdown=JSON.stringify({taskInstanceId:task.id,taskId:task.taskId,verified:task.state==="completed",content:task.result?.content??task.capabilityOutputs,verification:task.verification.map(v=>({id:v.id,kind:v.kind,status:v.status}))});
          if(old?.markdown!==markdown&&!this.docs.put(pid,product,resultId,markdown,old?.revision??0))throw Error("Result storage conflict");step.resultDocument=resultId;
        }
        // A requested batch cancellation may settle through its running task.
        // Keep partial results and the real task state, without calling it a failure.
        if(job.cancelRequested&&task.state==="cancelled"){
          job.state="cancelled";this.save(pid,product,job);this.active.delete(key);return;
        }
        if(["failed","cancelled","rejected"].includes(task.state))throw Error("Task "+task.state+"; inspect the runtime record");
        if(task.state==="completed"){step.state="done";job.state=job.cancelRequested?"cancelled":job.steps.every(s=>s.state==="done")?"completed":job.paused?"paused":"running";}
        else job.state=job.cancelRequested?"cancelling":job.paused?"paused":task.state==="waiting_human"?"waiting":"running";
        this.save(pid,product,job);
      } catch(e){job.state="error";job.error=e instanceof Error?e.message:"Background job failed";this.save(pid,product,job);this.active.delete(key);}
    } finally {this.locks.delete(key);}
  }
  async recoverAll() {for(const project of await this.runtime.listProjects())for(const job of this.list(project.id,project.productId))if(!["completed","error","cancelled"].includes(job.state))this.active.set(this.key(project.id,job.id),{pid:project.id,product:project.productId,id:job.id});this.unsubscribe??=this.events?.subscribe(e=>{if(e.kind==="task")this.schedule();});this.schedule();}
  private schedule(){if(this.timer||!this.active.size)return;this.timer=setTimeout(()=>{this.timer=undefined;void Promise.allSettled([...this.active.values()].map(j=>this.tick(j.pid,j.product,j.id))).then(()=>{if([...this.active.values()].some(j=>{const v=this.get(j.pid,j.product,j.id);return v&&(v.state==="cancelling"||!v.paused&&v.state!=="waiting");}))this.schedule();});},1000);this.timer.unref();}
  close(){if(this.timer)clearTimeout(this.timer);this.timer=undefined;this.unsubscribe?.();}
}
