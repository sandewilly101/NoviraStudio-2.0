import { Feather } from '@expo/vector-icons';
import type { ComponentProps, ReactNode } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, TextInput, View, type StyleProp, type TextInputProps, type TextStyle, type ViewStyle } from 'react-native';
import { C, font, radius } from '@/lib/theme';

export type IconName = ComponentProps<typeof Feather>['name'];

// On the web the icon font is a static file the browser loads itself
// (public/fonts), so icons never wait on expo-font's 12 s loader timeout.
if (Platform.OS === 'web' && typeof document !== 'undefined' && !document.getElementById('feather-font')) {
  const style = document.createElement('style');
  style.id = 'feather-font';
  style.textContent = "@font-face{font-family:'feather';src:url('/fonts/Feather.ttf') format('truetype');font-display:block}";
  document.head.appendChild(style);
}

// Slim, quiet scrollbars everywhere: no track or arrow buttons, a thin rounded
// thumb that is faint until the panel is hovered and firm while dragged.
if (Platform.OS === 'web' && typeof document !== 'undefined' && !document.getElementById('novira-scrollbars')) {
  const style = document.createElement('style');
  style.id = 'novira-scrollbars';
  style.textContent = [
    'input,textarea{min-width:0}',
    '*{scrollbar-width:thin;scrollbar-color:transparent transparent}',
    '*:hover{scrollbar-color:rgba(14,42,74,.22) transparent}',
    '::-webkit-scrollbar{width:10px;height:10px}',
    '::-webkit-scrollbar-track{background:transparent}',
    '::-webkit-scrollbar-button{display:none;width:0;height:0}',
    '::-webkit-scrollbar-corner{background:transparent}',
    '::-webkit-scrollbar-thumb{background:transparent;border-radius:8px;border:3px solid transparent;background-clip:padding-box}',
    '*:hover::-webkit-scrollbar-thumb{background-color:rgba(14,42,74,.2)}',
    '::-webkit-scrollbar-thumb:hover{background-color:rgba(14,42,74,.38)}',
    '::-webkit-scrollbar-thumb:active{background-color:rgba(0,106,177,.6)}',
  ].join('');
  document.head.appendChild(style);
}

export function Icon({ name, size = 18, color = C.sub }: { name: IconName; size?: number; color?: string }) {
  if (Platform.OS !== 'web') return <Feather name={name} size={size} color={color} />;
  return (
    <Text selectable={false} style={{ fontFamily: 'feather', fontSize: size, lineHeight: size, color, fontWeight: 'normal', fontStyle: 'normal' }}>
      {String.fromCodePoint(Feather.glyphMap[name] as number)}
    </Text>
  );
}

export function PanelTitle({ title, right }: { title: string; right?: ReactNode }) {
  return <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}><T size={14} weight="600">{title}</T>{right}</View>;
}

export function T({ children, style, size = 14, weight = '400', color = C.text, numberOfLines }: {
  children: ReactNode; style?: StyleProp<TextStyle>; size?: number; weight?: TextStyle['fontWeight']; color?: string; numberOfLines?: number;
}) {
  return <Text numberOfLines={numberOfLines} style={[{ fontFamily: font.family, fontSize: size, fontWeight: weight, color }, style]}>{children}</Text>;
}

type BtnKind = 'primary' | 'secondary' | 'soft' | 'ghost' | 'dark' | 'danger';
export function Button({ label, onPress, kind = 'primary', icon, loading, disabled, style, small }: {
  label?: string; onPress?: () => void; kind?: BtnKind; icon?: IconName; loading?: boolean; disabled?: boolean; style?: StyleProp<ViewStyle>; small?: boolean;
}) {
  const bg = { primary: C.blue, secondary: C.surface, soft: C.blueTint, ghost: 'transparent', dark: C.dark, danger: C.surface }[kind];
  const fg = { primary: '#fff', secondary: C.text, soft: C.blue, ghost: C.sub, dark: '#fff', danger: C.red }[kind];
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed, hovered }: any) => [
        s.btn, small && s.btnSmall, { backgroundColor: bg, opacity: disabled ? 0.5 : pressed ? 0.85 : 1 },
        (kind === 'secondary' || kind === 'danger') && { borderWidth: 1, borderColor: C.border },
        hovered && kind === 'primary' && { backgroundColor: C.blueHover },
        hovered && (kind === 'secondary' || kind === 'ghost') && { backgroundColor: C.bg },
        style,
      ]}>
      {loading ? <ActivityIndicator size="small" color={fg} /> : icon ? <Icon name={icon} size={small ? 14 : 16} color={fg} /> : null}
      {label ? <T size={small ? 12.5 : 13.5} weight="600" color={fg}>{label}</T> : null}
    </Pressable>
  );
}

export function Field({ label, style, ...props }: TextInputProps & { label?: string; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[{ gap: 6 }, style]}>
      {label ? <T size={12.5} weight="600" color={C.sub}>{label}</T> : null}
      <TextInput placeholderTextColor={C.muted} {...props} style={[s.input, props.multiline && { minHeight: 96, textAlignVertical: 'top', paddingTop: 10 }]} />
    </View>
  );
}

export function Card({ children, style, pad = 20 }: { children: ReactNode; style?: StyleProp<ViewStyle>; pad?: number }) {
  return <View style={[s.card, { padding: pad }, style]}>{children}</View>;
}

const BADGE: Record<string, [string, string]> = {
  blue: [C.blueTint, C.blue], green: [C.greenTint, C.green], amber: [C.amberTint, C.amber], gray: ['#EEF1F5', C.sub], dark: [C.dark, '#fff'],
};
export function Badge({ label, kind = 'blue' }: { label: string; kind?: keyof typeof BADGE }) {
  const [bg, fg] = BADGE[kind];
  return <View style={[s.badge, { backgroundColor: bg }]}><T size={11} weight="600" color={fg}>{label}</T></View>;
}

export const statusBadge = (st: string) => st === 'approved' ? <Badge label="Approved" kind="green" /> : st === 'in_review' ? <Badge label="In review" kind="amber" /> : <Badge label="Draft" kind="gray" />;

export function Chip({ label, active, onPress, icon }: { label: string; active?: boolean; onPress?: () => void; icon?: IconName }) {
  return (
    // never wider than its row: a long label ends in an ellipsis instead of spilling out
    <Pressable onPress={onPress} style={[s.chip, { maxWidth: '100%' }, active ? { backgroundColor: C.blue, borderColor: C.blue } : null]}>
      {icon ? <Icon name={icon} size={13} color={active ? '#fff' : C.sub} /> : null}
      <T size={12.5} weight={active ? '600' : '400'} color={active ? '#fff' : C.text} numberOfLines={1} style={{ flexShrink: 1 }}>{label}</T>
    </Pressable>
  );
}

export function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <Pressable onPress={() => onChange(!value)} style={[s.toggle, { backgroundColor: value ? C.blue : '#CBD3DD' }]}>
      <View style={[s.knob, { left: value ? 18 : 2 }]} />
    </Pressable>
  );
}

export function Empty({ icon, title, text, action }: { icon: IconName; title: string; text: string; action?: ReactNode }) {
  return (
    <View style={{ alignItems: 'center', padding: 48, gap: 10 }}>
      <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: C.blueTint, alignItems: 'center', justifyContent: 'center' }}><Icon name={icon} size={24} color={C.blue} /></View>
      <T size={16} weight="600">{title}</T>
      <T color={C.sub} style={{ textAlign: 'center', maxWidth: 420 }}>{text}</T>
      {action}
    </View>
  );
}

export function ErrorNote({ text }: { text?: string | null }) {
  if (!text) return null;
  return (
    <View style={{ flexDirection: 'row', gap: 8, padding: 12, borderRadius: radius.md, backgroundColor: '#FDECEC', alignItems: 'flex-start' }}>
      <Icon name="alert-circle" size={16} color={C.red} />
      <T size={13} color="#8A2323" style={{ flex: 1 }}>{text}</T>
    </View>
  );
}

export function PageHeader({ title, subtitle, right }: { title: string; subtitle?: string; right?: ReactNode }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 22, gap: 16, flexWrap: 'wrap' }}>
      <View style={{ gap: 4, flexShrink: 1 }}>
        <T size={24} weight="700">{title}</T>
        {subtitle ? <T color={C.sub}>{subtitle}</T> : null}
      </View>
      <View style={{ flexDirection: 'row', gap: 10 }}>{right}</View>
    </View>
  );
}

export function Avatar({ name, size = 34, color = '#2F6FB3' }: { name: string; size?: number; color?: string }) {
  const initials = name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
  return <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color, alignItems: 'center', justifyContent: 'center' }}><T size={size * 0.38} weight="600" color="#fff">{initials}</T></View>;
}

export function Swatch({ color, selected, onPress, size = 24 }: { color: string; selected?: boolean; onPress?: () => void; size?: number }) {
  return (
    <Pressable onPress={onPress} style={{ padding: 2, borderRadius: size, borderWidth: 2, borderColor: selected ? C.blue : 'transparent' }}>
      <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color, borderWidth: 1, borderColor: '#D5DCE5' }} />
    </Pressable>
  );
}

export const s = StyleSheet.create({
  btn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, height: 38, paddingHorizontal: 16, borderRadius: radius.md },
  btnSmall: { height: 30, paddingHorizontal: 10, gap: 6 },
  input: { minWidth: 0, height: 40, borderWidth: 1, borderColor: C.border, borderRadius: radius.md, paddingHorizontal: 12, fontSize: 14, color: C.text, backgroundColor: C.surface, fontFamily: font.family, outlineColor: C.blue } as any,
  card: { backgroundColor: C.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: C.border },
  badge: { alignSelf: 'flex-start', paddingHorizontal: 9, height: 22, borderRadius: 11, justifyContent: 'center' },
  chip: { flexDirection: 'row', gap: 6, alignItems: 'center', height: 30, paddingHorizontal: 14, borderRadius: 15, borderWidth: 1, borderColor: C.border, backgroundColor: C.surface },
  toggle: { width: 36, height: 20, borderRadius: 10 },
  knob: { position: 'absolute', top: 2, width: 16, height: 16, borderRadius: 8, backgroundColor: '#fff' },
});
