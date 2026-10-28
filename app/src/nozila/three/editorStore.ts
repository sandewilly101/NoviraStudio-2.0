// Bridge for the few Nozila components that talk to their editor store
// (curtain handles). Novira's editor registers its update function here.
type Bridge = { updateObject: (id: string, patch: Record<string, unknown>) => void; readOnly: boolean };

let bridge: Bridge = { updateObject: () => {}, readOnly: true };

export function setNoziraBridge(next: Bridge) { bridge = next; }

export function useEditor<T>(select: (s: Bridge) => T): T { return select(bridge); }
