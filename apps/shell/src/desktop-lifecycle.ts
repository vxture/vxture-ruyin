/** Window visibility is independent of the runtime lifetime. No Electron dependency. */
export interface DesktopLifecyclePorts {
  canHide(): boolean;
  closeAction?():Promise<"background"|"exit">;
  hide(): void;
  explainBackground(): void;
  activity(): Promise<{ busy: boolean } | undefined>;
  confirmExit(restart: boolean, unknown: boolean): Promise<boolean>;
  exit(restart: boolean): void;
}

export class DesktopLifecycle {
  private approved = false;
  private explained = false;
  private pending?: Promise<boolean>;
  private closePending = false;
  constructor(private readonly ports: DesktopLifecyclePorts) {}

  get quitting(): boolean { return this.approved; }

  /** True means prevent native close. Hide keeps page state and autosave alive. */
  closeWindow(): boolean {
    if (this.approved) return false;
    if(this.closePending)return true;
    if(this.ports.closeAction){
      this.closePending=true;
      void this.ports.closeAction().catch(()=>"background" as const).then(action=>{
        if(!this.approved)this.handleClose(action);
      }).finally(()=>{this.closePending=false;});
    }else this.handleClose("background");
    return true;
  }

  private handleClose(action:"background"|"exit"):void {
    if (action==="background"&&this.ports.canHide()) {
      try { this.ports.hide(); }
      catch { void this.requestExit(); return; }
      if (!this.explained) {
        this.explained = true;
        try { this.ports.explainBackground(); } catch { /* Notifications are best effort. */ }
      }
    } else void this.requestExit();
  }

  requestExit(restart = false): Promise<boolean> {
    if (this.approved) return Promise.resolve(true);
    if (this.pending) return this.pending;
    this.pending = this.check(restart).finally(() => { this.pending = undefined; });
    return this.pending;
  }

  /** OS logout/shutdown must not be held open by a confirmation dialog. */
  endSession(): void { this.approved = true; }

  private async check(restart: boolean): Promise<boolean> {
    try {
      const activity = await this.ports.activity().catch(() => undefined);
      if (this.approved) return true;
      if (activity?.busy !== false) {
        const confirmed = await this.ports.confirmExit(restart, !activity);
        if (this.approved) return true;
        if (!confirmed) return false;
      }
      this.approved = true;
      this.ports.exit(restart);
      return true;
    } catch { return false; } // A failed dialog must never silently approve exit.
  }
}
