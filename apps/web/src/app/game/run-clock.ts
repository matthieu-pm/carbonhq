export class RunClock {
  private startedAt: number | null = null;
  private playedMs = 0;

  start(now: number) {
    this.startedAt ??= now;
  }

  pause(now: number) {
    if (this.startedAt === null) return;
    this.playedMs += now - this.startedAt;
    this.startedAt = null;
  }

  milliseconds(now: number) {
    return Math.floor(this.playedMs + (this.startedAt === null ? 0 : now - this.startedAt));
  }
}
