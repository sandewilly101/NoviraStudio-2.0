// A number you can slide: drag left/right anywhere on the box to change the
// value live (Shift for fine steps, Alt or Ctrl for big ones); a plain click
// types instead, and while typing ↑ / ↓ nudge it. A whole drag is one undo step.
import { createContext, createElement, useContext, useEffect, useRef, useState } from 'react';
import { TextInput, View } from 'react-native';
import { Icon, T } from '@/components/ui';
import { C } from '@/lib/theme';

/** Groups the live changes of one drag into a single undo step (provided by the inspector). */
export const ScrubGesture = createContext<{ begin: () => void; end: () => void } | null>(null);

const parse = (v: string, d: number) => { const n = parseFloat(v); return Number.isFinite(n) ? n : d; };
const PX_PER_STEP = 4; // how far to drag for one step

export function NumBox({ label, value, onChange, step = 0.1, min, max }: {
  label: string; value: number; onChange: (v: number) => void; step?: number; min?: number; max?: number;
}) {
  const gesture = useContext(ScrubGesture);
  const [text, setText] = useState(String(value));
  const [prev, setPrev] = useState(value);
  if (prev !== value) { setPrev(value); setText(String(value)); } // follow outside changes (gizmo, undo, scrubbing)
  const [mode, setMode] = useState<'idle' | 'scrub' | 'edit'>('idle');
  const [hover, setHover] = useState(false);
  const input = useRef<any>(null);

  const decimals = step >= 1 ? 0 : step >= 0.01 ? 2 : 3;
  const tidy = (v: number) => {
    const c = Math.min(max ?? Infinity, Math.max(min ?? -Infinity, v));
    return Math.round(c * 10 ** decimals) / 10 ** decimals;
  };

  useEffect(() => { if (mode === 'edit') setTimeout(() => { input.current?.focus(); input.current?.select?.(); }, 0); }, [mode]);

  const onPointerDown = (e: PointerEvent) => {
    if (mode === 'edit' || e.button !== 0) return;
    e.preventDefault();
    const startX = e.clientX, startV = value;
    let sent = value; // only the dragged field changes while scrubbing, so this render's onChange stays valid
    let moved = false, frame = 0, pending: number | null = null;
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - startX;
      if (!moved) {
        if (Math.abs(dx) < 3) return;
        moved = true; gesture?.begin(); setMode('scrub');
        document.body.style.cursor = 'ew-resize'; document.body.style.userSelect = 'none';
      }
      const k = ev.shiftKey ? 0.1 : ev.altKey || ev.ctrlKey ? 10 : 1;
      pending = tidy(startV + ((dx - Math.sign(dx) * 3) / PX_PER_STEP) * step * k);
      if (!frame) frame = requestAnimationFrame(() => {
        frame = 0;
        if (pending != null && pending !== sent) onChange((sent = pending));
      });
    };
    const up = () => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
      document.body.style.cursor = ''; document.body.style.userSelect = '';
      if (moved) {
        if (frame) cancelAnimationFrame(frame);
        if (pending != null && pending !== sent) onChange((sent = pending));
        gesture?.end(); setMode('idle');
      } else setMode('edit'); // a plain click: type a value
    };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  };

  const commit = () => { const v = tidy(parse(text, value)); setMode('idle'); if (v !== value) onChange(v); else setText(String(value)); };
  const active = mode !== 'idle';
  return createElement('div', {
    onPointerDown, onPointerEnter: () => setHover(true), onPointerLeave: () => setHover(false),
    title: mode === 'edit' ? undefined : 'Drag to adjust · Shift: fine · Alt: big steps · click to type',
    style: {
      flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 4, height: 32, padding: '0 6px 0 8px', boxSizing: 'border-box',
      borderRadius: 6, border: `1px solid ${active ? C.blue : hover ? '#B7C4D1' : C.border}`, background: mode === 'scrub' ? C.blueTint : mode === 'edit' ? C.surface : C.bg,
      cursor: mode === 'edit' ? 'text' : 'ew-resize', userSelect: 'none', transition: 'border-color .12s, background .12s',
      boxShadow: mode === 'scrub' ? `0 0 0 3px rgba(0,106,177,.12)` : 'none',
    },
  },
    <T size={11} weight="600" color={active ? C.blue : C.muted}>{label}</T>,
    mode === 'edit'
      ? <TextInput ref={input} value={text} onChangeText={setText} onBlur={commit} onSubmitEditing={commit} keyboardType="numeric"
          onKeyPress={(e: any) => {
            const key = e.nativeEvent.key;
            if (key === 'Escape') { setText(String(value)); setMode('idle'); return; }
            if (key !== 'ArrowUp' && key !== 'ArrowDown') return;
            e.preventDefault?.();
            const k = e.nativeEvent.shiftKey ? 0.1 : e.nativeEvent.altKey ? 10 : 1;
            const v = tidy(parse(text, value) + (key === 'ArrowUp' ? 1 : -1) * step * k);
            setText(String(v)); onChange(v);
          }}
          style={{ flex: 1, fontSize: 12, color: C.text, outlineWidth: 0, minWidth: 0 } as any} />
      : <T size={12} color={C.text} numberOfLines={1} style={{ flex: 1, minWidth: 0 }}>{text}</T>,
    // a quiet hint that the box slides
    !active && hover ? <View style={{ flexDirection: 'row', opacity: 0.55 }}><Icon name="chevron-left" size={10} color={C.muted} /><Icon name="chevron-right" size={10} color={C.muted} /></View> : null,
  );
}
