// Keep only messages the user has opened, in this mounted Inbox's memory.
export class MessageReaderCache {
  private entries = new Map<string, { value: any; bytes: number; expires: number }>();
  private bytes = 0;
  constructor(
    private maxBytes = 4 * 1024 * 1024,
    private ttlMs = 60_000,
  ) {}
  get(key: string) {
    const entry = this.entries.get(key);
    if (!entry) return;
    this.entries.delete(key);
    if (entry.expires <= Date.now()) {
      this.bytes -= entry.bytes;
      return;
    }
    this.entries.set(key, entry);
    return entry.value;
  }
  set(key: string, value: any) {
    const bytes = new TextEncoder().encode(JSON.stringify(value)).byteLength;
    const previous = this.entries.get(key);
    if (previous) {
      this.bytes -= previous.bytes;
      this.entries.delete(key);
    }
    if (bytes > this.maxBytes) return;
    while (this.entries.size && (this.bytes + bytes > this.maxBytes || this.entries.size >= 12)) {
      const [oldKey, entry] = this.entries.entries().next().value!;
      this.entries.delete(oldKey);
      this.bytes -= entry.bytes;
    }
    this.entries.set(key, { value, bytes, expires: Date.now() + this.ttlMs });
    this.bytes += bytes;
  }
  clear() {
    this.entries.clear();
    this.bytes = 0;
  }
}
