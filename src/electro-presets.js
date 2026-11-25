/* Electrocardiogramas propios de Pretendrop, en el formato que Butterchurn lee
   directo: ecuaciones en EEL de MilkDrop (las corre eel-wasm) y shaders en GLSL.

   Coordenadas: en ondas y formas y=0 es abajo. Las ondas además estiran el eje
   vertical por ancho/alto, y en EEL `aspecty` vale justo ese factor, así que una
   altura en fracciones de pantalla se escribe `.5 + d/aspecty`. En el comp,
   uv.y=0 es arriba. */

const OFF_WAVE = { baseVals: { enabled: 0 }, init_eqs_eel: "", frame_eqs_eel: "", point_eqs_eel: "" };
const OFF_SHAPE = { baseVals: { enabled: 0 }, init_eqs_eel: "", frame_eqs_eel: "" };

/* Fondo quieto: sin movimiento de malla, sin la onda de audio por defecto ni bordes. */
const STILL = {
  gammaadj: 1,
  decay: 1,
  zoom: 1,
  rot: 0,
  warp: 0,
  dx: 0,
  dy: 0,
  sx: 1,
  sy: 1,
  wave_a: 0,
  echo_alpha: 0,
  ob_size: 0,
  ob_a: 0,
  ib_size: 0,
  ib_a: 0,
  mv_a: 0,
  wrap: 0,
};

/* Complejo PQRST con el pico R en 1; `p` es la fase del latido, de 0 a 1. */
const pqrst = (p) => `(.13*exp(-sqr((${p} - .17)*22)) - .15*exp(-sqr((${p} - .36)*60))
  + exp(-sqr((${p} - .40)*45)) - .3*exp(-sqr((${p} - .445)*55))
  + .32*exp(-sqr((${p} - .66)*12)))`;

/* El mismo complejo pero disparado por un golpe: `s` son segundos desde el golpe,
   con el pico R a 35 ms. */
const qrst = (s) => `(-.15*exp(-sqr((${s} - .012)*110)) + exp(-sqr((${s} - .035)*80))
  - .3*exp(-sqr((${s} - .062)*90)) + .33*exp(-sqr((${s} - .25)*16)))`;

/* Onda de oxímetro: subida rápida, bajada lenta y la muesca dicrota. */
const pleth = (u) => `above(${u}, 0)*((1 - exp(-${u}*9))*exp(-${u}*3.5)
  + .2*exp(-sqr((${u} - .36)*12)))`;

/* El pulso sube con la energía de la canción, como si el monitor la escuchara. */
const HEART_RATE = `
energy = energy*.985 + .015*min(.5*(bass_att + mid_att), 2.5);
bpm = min(max(44 + 30*energy, 56), 132);
ph = ph + bpm/(60*max(fps, 1));
kick = max(kick*.86, min(bass, 2.4));`;

/* Bloom con los desenfoques de Butterchurn y viñeta suave. */
const glow = (k1, k2) => `(texture(sampler_blur1, uv).rgb * scale1 + bias1) * ${k1.toFixed(2)}
    + (texture(sampler_blur2, uv).rgb * scale2 + bias2) * ${k2.toFixed(2)}`;
const VIGNETTE = "ret *= 1.0 - 0.5 * pow(clamp(rad * 1.25, 0.0, 1.0), 3.0);";

/* Monitor de hospital: barrido de izquierda a derecha sobre rejilla, con un hueco
   negro que borra el trazo viejo justo delante del cabezal. */
const monitor = {
  version: 2,
  baseVals: { ...STILL, decay: 0.985 },
  init_eqs_eel: "ph = 0; energy = 1; kick = 0;",
  frame_eqs_eel: `${HEART_RATE}
sweep = 4.5;
p = ph - floor(ph);
q1 = ph;
q2 = bpm/60;
q3 = .2 + .08*kick;
q4 = sweep;
q5 = .5 + ((time - floor(time/sweep)*sweep)/sweep - .5)/aspectx;
q6 = ${pqrst("p")}*q3 - .1;`,
  pixel_eqs_eel: "",
  warp: "",
  comp: `shader_body {
  vec2 px = uv * texsize.xy;
  float cell = texsize.y / 8.0;
  vec2 major = abs(fract(px / cell + 0.5) - 0.5) * cell;
  vec2 minor = abs(fract(px / (cell * 0.2) + 0.5) - 0.5) * cell * 0.2;
  float gridMajor = 1.0 - smoothstep(0.0, 1.5, min(major.x, major.y));
  float gridMinor = 1.0 - smoothstep(0.0, 1.0, min(minor.x, minor.y));
  vec2 head = (uv - vec2(q5, 0.5 - q6)) * texsize.xy / texsize.y;
  ret = vec3(0.03, 0.17, 0.11) * gridMajor + vec3(0.015, 0.06, 0.04) * gridMinor;
  ret += texture(sampler_main, uv).rgb * 1.25 + ${glow(1.3, 0.8)};
  ret += vec3(0.75, 1.0, 0.85) * exp(-dot(head, head) * 3000.0) * 1.2;
  ret *= 0.93 + 0.07 * sin(px.y * 2.0);
  ${VIGNETTE}
}`,
  waves: [
    {
      /* Trazo: solo el tramo del último cuadro; la estela la guarda el feedback. */
      baseVals: { enabled: 1, samples: 512, thick: 1, additive: 0, r: 0.15, g: 1, b: 0.45, a: 1 },
      init_eqs_eel: "",
      frame_eqs_eel: "",
      point_eqs_eel: `
t0 = floor(time/q4)*q4;
tp = max(time - (1 - sample)*1.6/max(fps, 1), t0);
x = .5 + ((tp - t0)/q4 - .5)/aspectx;
p = q1 - (time - tp)*q2;
p = p - floor(p);
y = .5 + (${pqrst("p")}*q3 - .1)/aspecty;`,
    },
    {
      /* Borrador: un zigzag negro y denso que corre delante del cabezal. */
      baseVals: { enabled: 1, samples: 512, thick: 1, additive: 0, r: 0, g: 0, b: 0, a: 1 },
      init_eqs_eel: "",
      frame_eqs_eel: "",
      point_eqs_eel: `
hx = (time - floor(time/q4)*q4)/q4;
x = .5 + (hx + .008 + .05*sample - .5)/aspectx;
z = sample*96;
z = z - floor(z);
y = .5 + (abs(z*2 - 1) - .5)*1.3/aspecty;`,
    },
    OFF_WAVE,
    OFF_WAVE,
  ],
  shapes: [OFF_SHAPE, OFF_SHAPE, OFF_SHAPE, OFF_SHAPE],
};

/* Papel corrido: cada bombo dispara un latido y la pantalla pulsa con él. Abajo,
   la curva del oxímetro llega un poco después, como en un monitor real. */
const latido = {
  version: 2,
  baseVals: { ...STILL, decay: 0.996 },
  init_eqs_eel: "lastbeat = -10; prevbeat = -10; amp = .6;",
  frame_eqs_eel: `
gap = time - lastbeat;
hit = above(bass, 1.3)*above(bass, bass_att*1.1)*above(gap, .35);
solo = above(gap, 1.3);
trig = min(hit + solo, 1);
amp = if(trig, if(hit, min(.45 + .3*bass, 1.25), .55), amp);
prevbeat = if(trig, lastbeat, prevbeat);
lastbeat = if(trig, time, lastbeat);
speed = .2;
dx = -speed/max(fps, 1);
s1 = time - lastbeat;
s2 = time - prevbeat;
q1 = lastbeat;
q2 = amp;
q3 = speed;
q4 = exp(-s1*6)*amp;
q5 = prevbeat;
q6 = .5 + (.8 - .5)/aspectx;
q7 = .1 + (${qrst("s1")} + ${qrst("s2")})*amp*.2;`,
  pixel_eqs_eel: "",
  /* El papel corre un número entero de pixeles por cuadro; con el corrimiento
     fraccionario, el muestreo bilineal emborrona los picos en pocos segundos. */
  warp: `shader_body {
  vec2 st = uv_orig + floor((uv - uv_orig) * texsize.xy + 0.5) * texsize.zw;
  ret = texture(sampler_main, st).rgb * decay - 0.002;
}`,
  comp: `shader_body {
  float beat = q4;
  vec2 c = uv - 0.5;
  vec2 z = 0.5 + c * (1.0 - 0.02 * beat);
  vec2 ca = c * 0.008 * beat;
  vec3 col = vec3(texture(sampler_main, z + ca).r, texture(sampler_main, z).g, texture(sampler_main, z - ca).b);
  vec3 bloom = (texture(sampler_blur1, z).rgb * scale1 + bias1) * 1.4
    + (texture(sampler_blur3, z).rgb * scale3 + bias3) * (0.6 + 1.6 * beat);
  vec2 pen = (uv - vec2(q6, 0.5 - q7)) * texsize.xy / texsize.y;
  ret = vec3(0.16, 0.0, 0.03) * beat * (1.0 - rad * 1.2);
  ret += col * 1.2 + bloom;
  ret += vec3(1.0, 0.55, 0.6) * exp(-dot(pen, pen) * 2500.0);
  ${VIGNETTE}
}`,
  waves: [
    {
      baseVals: { enabled: 1, samples: 512, thick: 1, additive: 1, r: 1, g: 0.16, b: 0.26, a: 1 },
      init_eqs_eel: "",
      frame_eqs_eel: "",
      point_eqs_eel: `
tp = time - (1 - sample)*1.6/max(fps, 1);
s1 = tp - q1;
s2 = tp - q5;
x = .5 + (.8 - (time - tp)*q3 - .5)/aspectx;
y = .5 + (.1 + (${qrst("s1")} + ${qrst("s2")})*q2*.2)/aspecty;`,
    },
    {
      baseVals: { enabled: 1, samples: 512, thick: 0, additive: 1, r: 0.3, g: 0.85, b: 1, a: 0.8 },
      init_eqs_eel: "",
      frame_eqs_eel: "",
      point_eqs_eel: `
tp = time - (1 - sample)*1.6/max(fps, 1);
u1 = tp - q1 - .16;
u2 = tp - q5 - .16;
x = .5 + (.8 - (time - tp)*q3 - .5)/aspectx;
y = .5 + (-.28 + (${pleth("u1")} + ${pleth("u2")})*.16)/aspecty;`,
    },
    OFF_WAVE,
    OFF_WAVE,
  ],
  shapes: [OFF_SHAPE, OFF_SHAPE, OFF_SHAPE, OFF_SHAPE],
};

/* Espiral: el cabezal da la vuelta como manecilla dibujando el latido, y el zoom
   empuja cada vuelta hacia afuera mientras cambia de color. El centro se enciende
   con cada pico R. */
const espiral = {
  version: 2,
  baseVals: { ...STILL, zoom: 1.0025 },
  init_eqs_eel: "ph = 0; energy = 1; kick = 0;",
  frame_eqs_eel: `${HEART_RATE}
turn = 5;
p = ph - floor(ph);
v = ${pqrst("p")};
q1 = ph;
q2 = bpm/60;
q3 = .045 + .02*kick;
q4 = max(v, 0);
q7 = -6.28318/turn;
th = time*q7 + 1.5708;
rr = .16 + v*q3;
q5 = .5 + rr*cos(th)/aspecty;
q6 = rr*sin(th);
q8 = .55 + .45*sin(time*.21);
q9 = .55 + .45*sin(time*.17 + 2.1);
q10 = .55 + .45*sin(time*.13 + 4.2);`,
  pixel_eqs_eel: "",
  /* La textura es de 8 bits: un decay cercano a 1 se queda pegado en gris y uno
     menor borra la espiral en un segundo. Restar 1/255 al azar en parte de los
     pixeles cada cuadro la apaga despacio y del todo. */
  warp: `shader_body {
  vec2 nuv = uv_orig * texsize.xy * texsize_noise_hq.zw + rand_frame.xy;
  ret = texture(sampler_main, uv).rgb - step(texture(sampler_noise_hq, nuv).x, 0.15) / 255.0;
}`,
  comp: `shader_body {
  vec3 tint = vec3(q8, q9, q10);
  vec2 c = (uv - 0.5) * texsize.xy / texsize.y;
  vec2 head = (uv - vec2(q5, 0.5 - q6)) * texsize.xy / texsize.y;
  ret = texture(sampler_main, uv).rgb * 1.5 + ${glow(1.4, 0.9)};
  ret += tint * exp(-dot(c, c) * 60.0) * q4 * 0.5;
  ret += mix(tint, vec3(1.0), 0.6) * exp(-dot(head, head) * 3000.0);
  ret = ret / (1.0 + 0.25 * ret);
  ${VIGNETTE}
}`,
  waves: [
    {
      baseVals: { enabled: 1, samples: 512, thick: 1, additive: 0, a: 1 },
      init_eqs_eel: "",
      frame_eqs_eel: "r = q8; g = q9; b = q10;",
      point_eqs_eel: `
tp = time - (1 - sample)*1.6/max(fps, 1);
p = q1 - (time - tp)*q2;
p = p - floor(p);
th = tp*q7 + 1.5708;
rr = .16 + ${pqrst("p")}*q3;
x = .5 + rr*cos(th)/aspecty;
y = .5 + rr*sin(th)/aspecty;`,
    },
    OFF_WAVE,
    OFF_WAVE,
    OFF_WAVE,
  ],
  shapes: [OFF_SHAPE, OFF_SHAPE, OFF_SHAPE, OFF_SHAPE],
};

export default {
  "pretendrop - electro monitor": monitor,
  "pretendrop - electro latido": latido,
  "pretendrop - electro espiral": espiral,
};
