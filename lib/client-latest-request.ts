// Abort superseded work and also guard against transports that ignore abort.
export class LatestRequest {
  private controller: AbortController | null = null;
  begin() {
    this.cancel();
    const controller = new AbortController();
    this.controller = controller;
    return { signal: controller.signal, current: () => this.controller === controller && !controller.signal.aborted };
  }
  cancel() {
    this.controller?.abort();
    this.controller = null;
  }
}
