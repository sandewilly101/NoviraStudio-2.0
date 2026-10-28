// A side panel you can resize by dragging its inner edge. The edge shows a thin
// line that turns blue on hover, the cursor becomes a resize cursor, and the
// width is shown while dragging. Widths snap softly to compact / normal / wide,
// stay between a minimum and maximum, reset on double-click, and are
// remembered. Drag past the minimum (or press the chevron) to fold the panel
// away; a slim tab brings it back. Contents can read the width to adapt.
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Pressable, View } from 'react-native';
import { Icon, T } from '@/components/ui';
import { C } from '@/lib/theme';

export const PanelWidth = createContext(300);
/** The width of the panel a component sits in. */
export const usePanelWidth = () => useContext(PanelWidth);

const SNAP = 14;
const read = (k: string) => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } };
const write = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode: not remembered */ } };

export function ResizablePanel({ side, storageKey, defaultWidth, min, max, snaps, collapsed, onCollapsedChange, children }: {
  side: 'left' | 'right'; storageKey: string; defaultWidth: number; min: number; max: number; snaps: number[];
  collapsed: boolean; onCollapsedChange: (v: boolean) => void; children: ReactNode;
}) {
  const [width, setWidth] = useState<number>(() => { const w = read(`${storageKey}.width`); return typeof w === 'number' ? Math.min(max, Math.max(min, w)) : defaultWidth; });
  const [drag, setDrag] = useState<{ w: number; folding: boolean } | null>(null);
  const [hover, setHover] = useState(false);
  const start = useRef({ x: 0, w: 0 });
  const [handle, setHandle] = useState<HTMLElement | null>(null);
  const lastDown = useRef(0);
  useEffect(() => write(`${storageKey}.width`, width), [storageKey, width]);

  const onPointerDown = useCallback((e: any) => {
    if (e.target?.closest?.('[aria-label="Hide panel"]')) return; // the hide button, not a drag
    e.preventDefault?.();
    // two presses in quick succession reset the width (the browser's dblclick never fires after a cancelled press)
    const now = e.timeStamp; // when the press happened, even if the page was busy
    if (now - lastDown.current < 350) { lastDown.current = 0; setWidth(defaultWidth); return; }
    lastDown.current = now;
    start.current = { x: e.clientX, w: width };
    setDrag({ w: width, folding: false });
    const sign = side === 'left' ? 1 : -1;
    let latest = { w: width, folding: false };
    const move = (ev: PointerEvent) => {
      const raw = start.current.w + (ev.clientX - start.current.x) * sign;
      const folding = raw < min - 60;
      let w = Math.min(max, Math.max(min, raw));
      const near = snaps.find((s) => Math.abs(s - w) <= SNAP);
      if (near) w = near;
      latest = { w: Math.round(w), folding };
      setDrag(latest);
    };
    const up = () => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
      document.body.style.cursor = ''; document.body.style.userSelect = '';
      setDrag(null);
      if (latest.folding) onCollapsedChange(true); else setWidth(latest.w);
    };
    document.body.style.cursor = 'col-resize'; document.body.style.userSelect = 'none';
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  }, [width, side, min, max, snaps, onCollapsedChange, defaultWidth]);

  // real DOM listeners: the UI layer drops hover and double-click props on plain views
  useEffect(() => {
    if (!handle) return;
    const enter = () => setHover(true), leave = () => setHover(false);
    handle.addEventListener('pointerdown', onPointerDown); handle.addEventListener('pointerenter', enter); handle.addEventListener('pointerleave', leave);
    return () => { handle.removeEventListener('pointerdown', onPointerDown); handle.removeEventListener('pointerenter', enter); handle.removeEventListener('pointerleave', leave); };
  }, [handle, onPointerDown]);

  const edge = side === 'left' ? { right: -5 } : { left: -5 };
  const border = side === 'left' ? { borderRightWidth: 1, borderRightColor: C.border } : { borderLeftWidth: 1, borderLeftColor: C.border };

  if (collapsed) {
    // a slim tab on the edge brings the panel back
    return (
      <Pressable onPress={() => onCollapsedChange(false)} accessibilityLabel="Show panel" {...({ title: 'Show panel' } as any)}
        style={({ hovered }: any) => ({ width: 14, backgroundColor: hovered ? C.blueTint : C.surface, alignItems: 'center', justifyContent: 'center', ...border })}>
        <Icon name={side === 'left' ? 'chevron-right' : 'chevron-left'} size={12} color={C.sub} />
      </Pressable>
    );
  }
  const shown = drag ? drag.w : width, active = hover || !!drag;
  return (
    <PanelWidth.Provider value={shown}>
      {/* above the 3D view, so the handle that overlaps it still catches the pointer */}
      <View style={{ width: shown, backgroundColor: C.surface, padding: 16, opacity: drag?.folding ? 0.45 : 1, position: 'relative', zIndex: 10, ...border }}>
        {children}
        {/* the drag handle on the inner edge */}
        <View
          ref={setHandle as any}
          style={{ position: 'absolute', top: 0, bottom: 0, width: 10, zIndex: 30, cursor: 'col-resize', alignItems: 'center', ...edge } as any}>
          <View style={{ width: active ? 2 : 1, height: '100%', backgroundColor: active ? C.blue : 'transparent' }} />
          {active && !drag && (
            <Pressable onPress={() => onCollapsedChange(true)} accessibilityLabel="Hide panel" {...({ title: 'Hide panel · drag to resize · double-click to reset' } as any)}
              style={{ position: 'absolute', top: '50%', marginTop: -12, width: 22, height: 22, borderRadius: 11, backgroundColor: C.surface, borderWidth: 1, borderColor: C.blue, alignItems: 'center', justifyContent: 'center', boxShadow: '0 2px 6px rgba(0,0,0,.12)' } as any}>
              <Icon name={side === 'left' ? 'chevron-left' : 'chevron-right'} size={12} color={C.blue} />
            </Pressable>
          )}
        </View>
        {drag && (
          <View pointerEvents="none" style={{ position: 'absolute', bottom: 12, [side === 'left' ? 'right' : 'left']: 12, backgroundColor: C.dark, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 } as any}>
            <T size={11} color="#fff">{drag.folding ? 'Release to hide' : `${drag.w} px`}</T>
          </View>
        )}
      </View>
    </PanelWidth.Provider>
  );
}

/** Remembered collapsed state for a panel. */
export function useCollapsed(key: string): [boolean, (v: boolean) => void] {
  const [v, setV] = useState<boolean>(() => read(`${key}.collapsed`) === true);
  const set = useCallback((n: boolean) => { setV(n); write(`${key}.collapsed`, n); }, [key]);
  return [v, set];
}
