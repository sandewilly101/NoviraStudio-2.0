// The floor plan as a measured drawing: preview it, then take it away as a PDF
// (to print, A3 at a true scale), a DXF (for AutoCAD and other CAD tools — save
// as DWG from there) or a picture saved with the project's renders.
import { createElement, useMemo, useState } from 'react';
import { Modal, Pressable, View } from 'react-native';
import { Button, ErrorNote, Icon, T } from '@/components/ui';
import { api } from '@/lib/api';
import { buildPlan, toDxf, toPdf, toSvg } from '@/lib/floorplan';
import { C } from '@/lib/theme';
import type { Scene } from '@/lib/types';

type Room = { minX: number; maxX: number; minZ: number; maxZ: number };

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob), a = document.createElement('a');
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
const fileName = (t: string) => t.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').toLowerCase() || 'floor-plan';

/** The drawing as a PNG data URL, for the renders gallery. */
function svgToPng(svg: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => { const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; c.getContext('2d')!.drawImage(img, 0, 0); resolve(c.toDataURL('image/png')); };
    img.onerror = () => reject(new Error('Could not draw the plan.'));
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  });
}

export function PlanModal({ scene, room, title, venue, projectId, version, onClose, onSaved }: {
  scene: Scene; room: Room; title: string; venue: string; projectId: string; version?: number; onClose: () => void; onSaved: (url: string) => void;
}) {
  const plan = useMemo(() => buildPlan(scene, room, { title, venue }), [scene, room, title, venue]);
  const preview = useMemo(() => toSvg(plan, 28, true), [plan]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    setBusy(true); setError(null);
    try {
      const r = await api(`/renders/project/${projectId}/capture`, { body: { kind: 'floorplan', dataUrl: await svgToPng(toSvg(plan, 60)), version } });
      onSaved(r.file_url);
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };
  return (
    <Modal transparent visible animationType="fade" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(18,26,43,.55)', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
        <View style={{ backgroundColor: C.surface, borderRadius: 16, padding: 20, width: '100%', maxWidth: 1180, maxHeight: '100%', gap: 12 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <View><T size={18} weight="700">Floor plan</T><T size={12} color={C.sub}>Measured from the design: footprints, table numbers, dimensions in metres</T></View>
            <Pressable onPress={onClose} accessibilityLabel="Close"><Icon name="x" size={20} /></Pressable>
          </View>
          <View style={{ flexShrink: 1, minHeight: 200, height: 'min(66vh, 640px)', borderRadius: 10, borderWidth: 1, borderColor: C.border, overflow: 'hidden', backgroundColor: '#fff' } as any}>
            {createElement('div', { style: { width: '100%', height: '100%', padding: 12, boxSizing: 'border-box' }, dangerouslySetInnerHTML: { __html: preview } })}
          </View>
          <ErrorNote text={error} />
          <View style={{ flexDirection: 'row', gap: 10, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
            <Button kind="secondary" icon="file-text" label="PDF (A3, to scale)" onPress={() => download(toPdf(plan), `${fileName(title)}-floor-plan.pdf`)} />
            <Button kind="secondary" icon="download" label="DXF for AutoCAD / DWG" onPress={() => download(new Blob([toDxf(plan)], { type: 'application/dxf' }), `${fileName(title)}-floor-plan.dxf`)} />
            <Button icon="image" label="Save to renders" onPress={save} loading={busy} />
          </View>
        </View>
      </View>
    </Modal>
  );
}
