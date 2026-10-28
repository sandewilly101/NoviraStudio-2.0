import { OrbitControls, useTexture } from '@react-three/drei';
import { Canvas } from '@react-three/fiber';
import { Suspense } from 'react';
import * as THREE from 'three';

function Sphere({ url }: { url: string }) {
  const tex = useTexture(url, (t) => { (Array.isArray(t) ? t : [t]).forEach((x) => { x.colorSpace = THREE.SRGBColorSpace; }); });
  return <mesh scale={[-1, 1, 1]}><sphereGeometry args={[50, 64, 40]} /><meshBasicMaterial map={tex} side={THREE.BackSide} toneMapped={false} /></mesh>;
}

export default function PanoramaViewer({ url }: { url: string }) {
  return (
    <Canvas camera={{ position: [0, 0, 0.1], fov: 75 }} flat>
      <Suspense fallback={null}><Sphere url={url} /></Suspense>
      <OrbitControls enableZoom={false} enablePan={false} rotateSpeed={-0.35} />
    </Canvas>
  );
}
