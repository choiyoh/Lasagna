import { NodeCircleProgram } from 'sigma/rendering';

/**
 * 부드러운 노드: 왼쪽 위에서 빛을 받은 은은한 입체감, 바깥쪽 얇은 밝은 테두리, 바깥으로 번지는 후광.
 * sigma 의 기본 원 프로그램을 확장해 셰이더만 바꾼다(도형은 삼각형 하나 — 원이 삼각형의 내접원이라
 * 후광을 그릴 여유를 두려고 삼각형을 1.5배로 키우고 원 반지름은 그대로 둔다).
 */
const VERTEX = /* glsl */ `
attribute vec4 a_id;
attribute vec4 a_color;
attribute vec2 a_position;
attribute float a_size;
attribute float a_angle;

uniform mat3 u_matrix;
uniform float u_sizeRatio;
uniform float u_correctionRatio;

varying vec4 v_color;
varying vec2 v_diffVector;
varying float v_radius;

const float bias = 255.0 / 254.0;

void main() {
  float size = a_size * u_correctionRatio / u_sizeRatio * 6.0;
  vec2 diffVector = size * vec2(cos(a_angle), sin(a_angle));
  vec2 position = a_position + diffVector;
  gl_Position = vec4((u_matrix * vec3(position, 1)).xy, 0, 1);

  v_diffVector = diffVector;
  v_radius = size / 3.0;

  #ifdef PICKING_MODE
  v_color = a_id;
  #else
  v_color = a_color;
  #endif
  v_color.a *= bias;
}
`;

const FRAGMENT = /* glsl */ `
precision highp float;

varying vec4 v_color;
varying vec2 v_diffVector;
varying float v_radius;

uniform float u_correctionRatio;

void main(void) {
  float d = length(v_diffVector);

  #ifdef PICKING_MODE
  gl_FragColor = d <= v_radius ? v_color : vec4(0.0);
  #else
  float aa = u_correctionRatio * 1.5;
  float core = 1.0 - smoothstep(v_radius - aa, v_radius, d);

  // 입체감: 왼쪽 위가 밝고 오른쪽 아래가 살짝 어둡다
  vec2 n = v_diffVector / max(v_radius, 0.0001);
  float lit = dot(n, normalize(vec2(-0.55, 0.85)));
  float shade = 1.0 + 0.16 * clamp(lit, -1.0, 1.0);
  // 바깥 테두리를 살짝 밝게
  float rim = smoothstep(v_radius * 0.8, v_radius - aa, d);
  vec3 body = mix(v_color.rgb * shade, vec3(1.0), rim * 0.22);

  // 후광: 반지름의 1.5배까지 번지며 사라진다
  float t = clamp((d - v_radius) / (v_radius * 0.5), 0.0, 1.0);
  float halo = (1.0 - t) * (1.0 - t) * 0.3;

  float a = v_color.a;
  float alpha = core * a + (1.0 - core) * halo * a;
  vec3 rgb = mix(v_color.rgb, body, core);
  gl_FragColor = vec4(rgb * alpha, alpha); // sigma 는 미리 곱한 알파로 섞는다
  #endif
}
`;

export class NodeGlowProgram extends NodeCircleProgram {
  override getDefinition() {
    return { ...super.getDefinition(), VERTEX_SHADER_SOURCE: VERTEX, FRAGMENT_SHADER_SOURCE: FRAGMENT };
  }
}
