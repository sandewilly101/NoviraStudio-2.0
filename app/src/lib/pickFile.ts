import { Platform } from 'react-native';

// Opens the browser's file picker. Returns null on native or if cancelled.
export function pickFile(accept: string): Promise<File | null> {
  if (Platform.OS !== 'web') return Promise.resolve(null);
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.onchange = () => resolve(input.files?.[0] || null);
    input.addEventListener('cancel', () => resolve(null));
    input.click();
  });
}
