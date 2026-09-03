(() => {
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const canvas = document.getElementById("bg-shader");
  if (!canvas || reduce) {
    document.documentElement.classList.add("no-shader");
    return;
  }

  const gl = canvas.getContext("webgl", {
    alpha: false,
    antialias: false,
    depth: false,
    stencil: false,
    powerPreference: "low-power",
  });
  if (!gl) {
    document.documentElement.classList.add("no-shader");
    return;
  }

  const vs = `
    attribute vec2 a;
    void main(){ gl_Position = vec4(a, 0.0, 1.0); }
  `;

  const fs = `
    precision highp float;
    uniform vec2 u_res;
    uniform float u_time;
    uniform vec2 u_mouse;
    uniform vec2 u_click;
    uniform float u_burst;

    float hash(vec2 p){
      return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
    }
    float noise(vec2 p){
      vec2 i = floor(p);
      vec2 f = fract(p);
      f = f * f * (3.0 - 2.0 * f);
      float a = hash(i);
      float b = hash(i + vec2(1.0, 0.0));
      float c = hash(i + vec2(0.0, 1.0));
      float d = hash(i + vec2(1.0, 1.0));
      return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
    }
    float fbm(vec2 p){
      float v = 0.0;
      float a = 0.5;
      for (int i = 0; i < 5; i++){
        v += a * noise(p);
        p = p * 2.07 + vec2(1.7, 9.2);
        a *= 0.5;
      }
      return v;
    }

    void main(){
      vec2 p = (gl_FragCoord.xy - 0.5 * u_res) / min(u_res.x, u_res.y);
      float t = u_time * 0.022;

      vec2 q = p * 1.15;
      q.y += t * 0.045;
      q += 0.08 * vec2(fbm(q + t * 0.15), fbm(q + 3.1 - t * 0.12));

      float smoke = fbm(q * 1.55);
      float smoke2 = fbm(q * 2.6 + smoke * 0.5);
      float field = mix(smoke, smoke2, 0.35);

      float ridge = 1.0 - abs(field * 2.0 - 1.0);
      ridge = pow(ridge, 16.0);

      vec3 bg = vec3(0.047, 0.039, 0.035);
      vec3 ash = vec3(0.078, 0.05, 0.038);
      vec3 ember = vec3(0.78, 0.34, 0.18);

      vec3 col = mix(bg, ash, field * 0.42);
      col += ember * ridge * 0.07;

      vec2 cell = floor(gl_FragCoord.xy / 42.0);
      float h = hash(cell);
      if (h > 0.992){
        vec2 c = (cell + 0.5) * 42.0;
        float d = length(gl_FragCoord.xy - c);
        col += ember * exp(-d * d * 0.06) * 0.16;
      }

      vec2 m = u_mouse;
      if (m.x > 0.0){
        vec2 mp = (m - 0.5 * u_res) / min(u_res.x, u_res.y);
        float md = length(p - mp);
        col += ember * exp(-md * 4.5) * 0.07;
      }

      if (u_burst > 0.001){
        vec2 cp = (u_click - 0.5 * u_res) / min(u_res.x, u_res.y);
        float cd = length(p - cp);
        float ring = abs(cd - (1.0 - u_burst) * 0.7);
        col += ember * exp(-ring * 22.0) * u_burst * 0.35;
      }

      float g = hash(gl_FragCoord.xy);
      col += (g - 0.5) * 0.01;

      gl_FragColor = vec4(col, 1.0);
    }
  `;

  function compile(type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      console.warn(gl.getShaderInfoLog(s));
      return null;
    }
    return s;
  }

  const vsh = compile(gl.VERTEX_SHADER, vs);
  const fsh = compile(gl.FRAGMENT_SHADER, fs);
  if (!vsh || !fsh) {
    document.documentElement.classList.add("no-shader");
    return;
  }

  const prog = gl.createProgram();
  gl.attachShader(prog, vsh);
  gl.attachShader(prog, fsh);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    document.documentElement.classList.add("no-shader");
    return;
  }
  gl.useProgram(prog);

  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, "a");
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

  const uRes = gl.getUniformLocation(prog, "u_res");
  const uTime = gl.getUniformLocation(prog, "u_time");
  const uMouse = gl.getUniformLocation(prog, "u_mouse");
  const uClick = gl.getUniformLocation(prog, "u_click");
  const uBurst = gl.getUniformLocation(prog, "u_burst");

  const mouse = { x: -1, y: -1, tx: -1, ty: -1 };
  const click = { x: 0, y: 0 };
  let burst = 0;
  let start = performance.now();
  let running = true;

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, window.innerWidth < 800 ? 1 : 1.4);
    const w = Math.floor(window.innerWidth * dpr);
    const h = Math.floor(window.innerHeight * dpr);
    if (canvas.width === w && canvas.height === h) return;
    canvas.width = w;
    canvas.height = h;
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    gl.viewport(0, 0, w, h);
  }

  window.addEventListener("resize", resize, { passive: true });
  window.addEventListener(
    "pointermove",
    (e) => {
      const dpr = canvas.width / window.innerWidth;
      mouse.tx = e.clientX * dpr;
      mouse.ty = (window.innerHeight - e.clientY) * dpr;
    },
    { passive: true }
  );

  document.addEventListener("visibilitychange", () => {
    running = !document.hidden;
    if (running) requestAnimationFrame(frame);
  });

  window.emberBurst = function emberBurst(clientX, clientY, power) {
    const dpr = canvas.width / window.innerWidth;
    click.x = clientX * dpr;
    click.y = (window.innerHeight - clientY) * dpr;
    burst = Math.max(burst, power || 1);
  };

  function frame(now) {
    if (!running) return;
    resize();
    mouse.x += (mouse.tx - mouse.x) * 0.06;
    mouse.y += (mouse.ty - mouse.y) * 0.06;
    burst *= 0.94;
    if (burst < 0.002) burst = 0;

    gl.uniform2f(uRes, canvas.width, canvas.height);
    gl.uniform1f(uTime, (now - start) / 1000);
    gl.uniform2f(uMouse, mouse.x, mouse.y);
    gl.uniform2f(uClick, click.x, click.y);
    gl.uniform1f(uBurst, burst);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    requestAnimationFrame(frame);
  }

  resize();
  requestAnimationFrame(frame);
})();
