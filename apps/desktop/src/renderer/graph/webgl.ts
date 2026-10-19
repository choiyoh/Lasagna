/**
 * 이 컴퓨터에서 WebGL 을 쓸 수 있는지 본다.
 * 원격 데스크톱·가상 머신·GPU 차단 목록에서는 컨텍스트가 null 이거나 getContext 가 던진다.
 * 확인용으로 만든 컨텍스트는 바로 놓아 준다(브라우저는 동시에 살아 있는 WebGL 컨텍스트 수를 제한하고,
 * 한도를 넘으면 가장 오래된 컨텍스트 — 그래프가 쓰는 것일 수도 있다 — 를 잃게 한다).
 */
export function hasWebGL(createCanvas: () => HTMLCanvasElement = () => document.createElement('canvas')): boolean {
  try {
    const canvas = createCanvas();
    // sigma 는 webgl2 를 우선 쓰고, 없으면 webgl1 로 떨어진다. 둘 중 하나만 있으면 된다.
    const gl = (canvas.getContext('webgl2') || canvas.getContext('webgl') || canvas.getContext('experimental-webgl')) as WebGLRenderingContext | null;
    if (!gl) return false;
    try {
      gl.getExtension?.('WEBGL_lose_context')?.loseContext();
    } catch {
      // 놓아 주지 못해도 판정에는 영향이 없다
    }
    return true;
  } catch {
    return false;
  }
}

let cached: boolean | undefined;

/** hasWebGL 결과를 앱이 떠 있는 동안 기억한다. 그래프를 다시 그릴 때마다 확인용 컨텍스트를 만들지 않는다. */
export function webglAvailable(): boolean {
  cached ??= hasWebGL();
  return cached;
}
