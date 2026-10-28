import { useLocalSearchParams } from 'expo-router';
import Editor from '@/components/editor/Editor';

export default function EditorScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <Editor projectId={String(id)} />;
}
