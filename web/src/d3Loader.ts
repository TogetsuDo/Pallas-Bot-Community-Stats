let d3Module: Promise<typeof import("d3")> | null = null;

export function importD3(): Promise<typeof import("d3")> {
  if (!d3Module) {
    d3Module = import("d3");
  }
  return d3Module;
}
