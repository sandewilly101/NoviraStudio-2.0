// Two known, harmless console messages from the 3D stack, kept out of the way so
// real warnings stand out:
//  · React Three Fiber 9 (the current stable release) still creates a
//    THREE.Clock for every canvas, which three r186 reports as deprecated;
//  · on Windows, ANGLE's Direct3D shader compiler notes float rounding in
//    three's built-in shaders ("warning X4122 … cannot be represented
//    accurately in double precision").
// Everything else is passed through untouched.
const HARMLESS = [/THREE\.Clock: This module has been deprecated/, /warning X4122: sum of .* cannot be represented accurately in double precision/];

const isHarmless = (args: unknown[]) => {
  const text = args.map((a) => (typeof a === 'string' ? a : '')).join(' ');
  if (!HARMLESS.some((re) => re.test(text))) return false;
  // a shader log that also holds a real error or another warning stays visible
  return !/error|warning (?!X4122)/i.test(text.replace(/warning X4122[^\n]*/g, ''));
};

if (typeof console !== 'undefined' && !(console.warn as any).__novira) {
  const warn = console.warn.bind(console);
  const quiet = (...args: unknown[]) => { if (!isHarmless(args)) warn(...args); };
  (quiet as any).__novira = true;
  console.warn = quiet;
}
