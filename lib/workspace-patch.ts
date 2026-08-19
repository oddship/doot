export type WorkspacePatchOperation = { op: "add" | "replace" | "remove"; path: string; value?: unknown };

const BLOCKED_SEGMENTS = new Set(["__proto__", "prototype", "constructor"]);

function segments(path: string) {
  if (!path.startsWith("/") || path.length > 500) throw new Error("patch path must be a JSON pointer");
  const values = path
    .slice(1)
    .split("/")
    .map((segment) => segment.replace(/~1/g, "/").replace(/~0/g, "~"));
  if (!values.length || values.length > 20 || values.some((segment) => BLOCKED_SEGMENTS.has(segment)))
    throw new Error("unsafe workspace patch path");
  if (values[0] === "schemaVersion") throw new Error("workspace schemaVersion cannot be edited");
  return values;
}

function arrayIndex(segment: string, length: number, allowEnd: boolean) {
  if (allowEnd && segment === "-") return length;
  if (!/^(0|[1-9]\d*)$/.test(segment)) throw new Error("invalid workspace array index");
  const index = Number(segment);
  if (index < 0 || index > length || (!allowEnd && index === length))
    throw new Error("workspace array index is out of bounds");
  return index;
}

export function applyWorkspacePatch<T>(workspace: T, operations: WorkspacePatchOperation[]): T {
  if (!Array.isArray(operations) || !operations.length || operations.length > 20)
    throw new Error("workspace update needs 1–20 patch operations");
  const result: any = structuredClone(workspace);
  for (const operation of operations) {
    if (!operation || !["add", "replace", "remove"].includes(operation.op))
      throw new Error("unsupported workspace patch operation");
    if ((operation.op === "add" || operation.op === "replace") && !("value" in operation))
      throw new Error(`${operation.op} requires a value`);
    const path = segments(operation.path);
    let parent: any = result;
    for (const segment of path.slice(0, -1)) {
      if (Array.isArray(parent)) parent = parent[arrayIndex(segment, parent.length, false)];
      else if (parent && typeof parent === "object" && Object.hasOwn(parent, segment)) parent = parent[segment];
      else throw new Error("workspace patch path does not exist");
    }
    const key = path[path.length - 1];
    if (Array.isArray(parent)) {
      const index = arrayIndex(key, parent.length, operation.op === "add");
      if (operation.op === "add") parent.splice(index, 0, structuredClone(operation.value));
      else if (operation.op === "replace") parent[index] = structuredClone(operation.value);
      else parent.splice(index, 1);
    } else if (parent && typeof parent === "object") {
      if (operation.op !== "add" && !Object.hasOwn(parent, key)) throw new Error("workspace patch path does not exist");
      if (operation.op === "remove") delete parent[key];
      else parent[key] = structuredClone(operation.value);
    } else throw new Error("workspace patch parent is not a container");
  }
  return result;
}
