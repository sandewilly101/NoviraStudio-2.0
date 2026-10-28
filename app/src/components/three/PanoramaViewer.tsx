import { Image } from 'react-native';

export default function PanoramaViewer({ url }: { url: string }) {
  return <Image source={{ uri: url }} style={{ width: '100%', height: '100%' }} resizeMode="contain" />;
}
