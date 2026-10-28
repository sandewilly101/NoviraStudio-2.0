// Varieties of a procedural object (Nozila builds): tent families and sizes,
// LED panels and screen presets, truss shapes, drapes, stands, fixtures.
import { useState } from 'react';
import { FlatList, Modal, Pressable, View } from 'react-native';
import { Button, Icon, T, Toggle } from '@/components/ui';
import { C } from '@/lib/theme';
import type { SceneObject } from '@/lib/types';
import { currentVariety, varietiesFor, type Variety } from '@/nozila/adapter';
import { ProceduralThumb } from '@/nozila/thumbnails';

const LABEL: Record<string, string> = { stage: 'stages', led_screen: 'LED walls', tent: 'tents', truss: 'trusses', curtain: 'drapes', booth: 'stands', light: 'lights' };

export function VarietyModal({ obj, sameType, onClose, onPick }: {
  obj: SceneObject; sameType: number; onClose: () => void; onPick: (v: Variety, all: boolean) => void;
}) {
  const [all, setAll] = useState(false);
  const items = varietiesFor(obj.type);
  const now = currentVariety(obj);
  const preview = (v: Variety): SceneObject => ({ ...obj, ...v.patch, spec: { ...obj.spec, ...v.patch.spec } } as SceneObject);
  return (
    <Modal transparent visible animationType="fade" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(18,26,43,.55)', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <View style={{ width: '100%', maxWidth: 920, height: '88%', backgroundColor: C.surface, borderRadius: 16, padding: 20, gap: 12 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
            <View style={{ borderRadius: 10, overflow: 'hidden' }}><ProceduralThumb o={obj} size={56} /></View>
            <View style={{ flex: 1 }}>
              <T size={18} weight="700">Choose a {obj.name.toLowerCase()} variety</T>
              <T size={12.5} color={C.sub}>Built to real trade specifications. Position and rotation stay the same.</T>
            </View>
            <Pressable onPress={onClose} accessibilityLabel="Close"><Icon name="x" size={20} /></Pressable>
          </View>
          {sameType > 1 && (
            <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
              <Toggle value={all} onChange={setAll} /><T size={13}>Apply to all {sameType} {LABEL[obj.type] || 'of this type'}</T>
            </View>
          )}
          <FlatList
            data={items}
            numColumns={4}
            keyExtractor={(v) => v.key}
            columnWrapperStyle={{ gap: 12 }}
            contentContainerStyle={{ gap: 12, paddingBottom: 12 }}
            initialNumToRender={8}
            windowSize={4}
            renderItem={({ item: v }) => {
              const active = (v.patch.variant ?? v.key) === now && !v.key.startsWith('preset:');
              return (
                <Pressable onPress={() => { onPick(v, all); onClose(); }}
                  style={({ hovered }: any) => ({ flex: 1, maxWidth: '25%', borderRadius: 12, borderWidth: active ? 2 : 1, borderColor: active || hovered ? C.blue : C.border, overflow: 'hidden', backgroundColor: C.surface })}>
                  <View style={{ aspectRatio: 1 }}><ProceduralThumb o={preview(v)} size="100%" /></View>
                  <View style={{ padding: 10, gap: 2 }}>
                    <T size={12.5} weight="600" numberOfLines={1}>{v.label}</T>
                    {v.note ? <T size={11} color={C.muted} numberOfLines={2}>{v.note}</T> : null}
                  </View>
                </Pressable>
              );
            }}
          />
          <View style={{ alignItems: 'flex-end' }}><Button kind="secondary" label="Cancel" onPress={onClose} /></View>
        </View>
      </View>
    </Modal>
  );
}
