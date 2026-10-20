(function () {
  "use strict";

  var U = window.FlowsUI;
  if (!U || U.nnOrb) return;

  var MIN = 40, FRAME = 33, CAP = 180000, BLOOM = 720, TAU = 6.2832;
  var VS = "attribute vec2 a;varying vec2 p;void main(){p=a;gl_Position=vec4(a,0.,1.);}";
  var FS = [
    "#ifdef GL_FRAGMENT_PRECISION_HIGH", "precision highp float;", "#else", "precision mediump float;", "#endif",
    "varying vec2 p;uniform vec3 u[7];uniform float t,b,px;",
    "float sq(float x){return x*x;}",
    "vec3 env(vec3 d){float h=d.y*.5+.5;vec3 c=mix(u[2],u[1],smoothstep(0.,.5,h));c=mix(c,u[0],smoothstep(.45,1.,h));",
    "c+=u[3]*exp(-sq((d.y-.3)*5.))*(.45+.35*d.x);c+=u[0]*smoothstep(.7,1.,h)*.5;return c;}",
    "vec3 hue(float h){return clamp(abs(fract(h+vec3(0.,.6667,.3333))*6.-3.)-1.,0.,1.);}",
    "void main(){float r2=dot(p,p),r=sqrt(r2);float aa=1.-smoothstep(1.-px*1.5,1.,r);",
    "if(aa<=0.){gl_FragColor=vec4(0.);return;}",
    "vec3 n=vec3(p,sqrt(max(1.-r2,0.))),I=vec3(0.,0.,-1.);",
    "vec3 L=normalize(vec3(-.55+.3*sin(t),.62+.15*cos(t*.7),.55));",
    "float ci=n.z,F=.04+.96*pow(1.-ci,5.);",
    "vec3 rf=env(reflect(I,n)),tr=vec3(0.),ior=vec3(1.49,1.51,1.53);",
    "for(int i=0;i<3;i++){float e=1./ior[i];vec3 T=refract(I,n,e);float len=-2.*dot(n,T);vec3 q=n+T*len;",
    "vec3 T2=refract(T,-q,ior[i]);if(dot(T2,T2)<.01)T2=reflect(T,-q);",
    "vec3 col=env(T2)*exp(-len*1.1);tr[i]=col[i];}",
    "vec3 T=refract(I,n,1./1.51);float len=-2.*dot(n,T);vec3 em=vec3(0.);",
    "vec3 l0=vec3(-.35,.3,.1)+.18*vec3(sin(t*1.1),cos(t*.9),sin(t*.7));",
    "vec3 l1=vec3(.4,.1,-.1)+.18*vec3(cos(t),sin(t*1.3),cos(t*.6));",
    "vec3 l2=vec3(-.05,-.45,.05)+.18*vec3(sin(t*.8),cos(t*1.2),sin(t));",
    "for(int j=0;j<8;j++){vec3 q=n+T*len*((float(j)+.5)/8.);",
    "em+=u[4]*exp(-dot(q-l0,q-l0)*9.)+u[5]*exp(-dot(q-l1,q-l1)*9.)+u[6]*exp(-dot(q-l2,q-l2)*9.);}",
    "em*=len/8.*(1.1+b);",
    "float arc=exp(-sq((p.y-(.66-.28*p.x*p.x))/.05))*smoothstep(0.,.35,p.y)*smoothstep(1.,.5,abs(p.x));",
    "float thin=.5+.5*cos(ci*9.+t*.5);vec3 film=hue(.52-(p.x*.5+.5)*.62)*arc*(.6+.4*thin)*(1.+b);",
    "vec3 H=normalize(L+vec3(0.,0.,1.));float nh=max(dot(n,H),0.);",
    "vec3 spec=u[3]*(pow(nh,80.)*.9+pow(nh,12.)*.08);",
    "vec3 col=tr*(1.-F)+rf*F+em+film;",
    "col*=1.-.78*exp(-r2*3.);",
    "col+=u[3]*pow(1.-ci,3.)*(.26+.1*b)*(.6+.4*dot(normalize(p+.001),vec2(-.7,.7)));",
    "col+=spec;",
    "gl_FragColor=vec4(col*aa,aa);}"
  ].join("\n");

  var ORBS = new Map(), cx = null, loopOn = false;

  function mq(q) { return !!(window.matchMedia && window.matchMedia(q).matches); }
  function tok(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }
  function col(name) {
    if (!cx) { var c = document.createElement("canvas"); c.width = c.height = 1; cx = c.getContext("2d"); }
    if (!cx) return [0, 0, 0, 1];
    cx.fillStyle = tok(name);
    var v = String(cx.fillStyle);
    if (v.charAt(0) === "#") return [parseInt(v.slice(1, 3), 16) / 255, parseInt(v.slice(3, 5), 16) / 255, parseInt(v.slice(5, 7), 16) / 255, 1];
    var m = v.match(/[\d.]+/g) || [0, 0, 0, 1];
    return [m[0] / 255, m[1] / 255, m[2] / 255, m.length > 3 ? +m[3] : 1];
  }
  function mix(a, b, k) { return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k]; }
  function envs() {
    var g = col("--ground-base"), out = [];
    ["--aur-1", "--aur-2", "--aur-3"].forEach(function (n) { var a = col(n); out.push(mix(g, a, Math.min(1, a[3] * 5))); });
    ["--label-1", "--nn-cyan", "--nn-violet", "--nn-pink"].forEach(function (n) { out.push(col(n).slice(0, 3)); });
    return new Float32Array([].concat.apply([], out));
  }

  function stateOf(el) {
    var s = el.hasAttribute("data-nn") ? el.getAttribute("data-nn") : ((el.closest("[data-nn]") || el).getAttribute("data-nn") || "off");
    if (s === "idle" && el.classList.contains("nn-mirror") && document.documentElement.hasAttribute("data-nn-busy")) return "think";
    return s;
  }

  function shader(gl, type, src) {
    var s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    return gl.getShaderParameter(s, gl.COMPILE_STATUS) ? s : null;
  }

  function build(o) {
    var el = o.el, size = el.offsetWidth, dpr = Math.min(window.devicePixelRatio || 1, 2);
    var cv = document.createElement("canvas");
    cv.width = cv.height = Math.max(2, Math.round(size * dpr));
    cv.setAttribute("aria-hidden", "true");
    var gl = cv.getContext("webgl", { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: true });
    if (!gl) return false;
    var vs = shader(gl, gl.VERTEX_SHADER, VS), fs = shader(gl, gl.FRAGMENT_SHADER, FS), pr = gl.createProgram();
    if (!vs || !fs || !pr) return false;
    gl.attachShader(pr, vs);
    gl.attachShader(pr, fs);
    gl.linkProgram(pr);
    if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) return false;
    gl.useProgram(pr);
    var buf = gl.createBuffer(), at = gl.getAttribLocation(pr, "a");
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(at);
    gl.vertexAttribPointer(at, 2, gl.FLOAT, false, 0, 0);
    gl.viewport(0, 0, cv.width, cv.height);
    gl.clearColor(0, 0, 0, 0);
    o.gl = gl;
    o.cv = cv;
    o.loc = { u: gl.getUniformLocation(pr, "u"), t: gl.getUniformLocation(pr, "t"), b: gl.getUniformLocation(pr, "b"), px: gl.getUniformLocation(pr, "px") };
    cv.addEventListener("webglcontextlost", function (e) { e.preventDefault(); teardown(o); });
    var kids = el.children;
    el.insertBefore(cv, kids[3] || null);
    el.classList.add("has-gl");
    return true;
  }

  function draw(o, t, b) {
    var gl = o.gl;
    if (!gl) return;
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.uniform3fv(o.loc.u, o.env);
    gl.uniform1f(o.loc.t, t);
    gl.uniform1f(o.loc.b, b);
    gl.uniform1f(o.loc.px, 2 / o.cv.width);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  function stop(o) {
    if (o.raf) cancelAnimationFrame(o.raf);
    o.raf = 0;
  }

  function teardown(o) {
    stop(o);
    if (o.cv && o.cv.parentNode) o.cv.remove();
    o.cv = o.gl = null;
    o.el.classList.remove("has-gl");
  }

  function bloomAt(o, now) {
    var k = (now - o.spokeAt) / BLOOM;
    return k >= 1 ? 0 : Math.sin(Math.PI * Math.max(0, k));
  }

  function tick(o, now) {
    o.raf = 0;
    if (!o.gl || document.hidden || !o.vis) return;
    if (now - o.last >= FRAME) {
      o.last = now;
      var el = now - o.t0;
      var capped = el > CAP && o.state !== "spoke";
      var b = o.state === "spoke" ? bloomAt(o, now) : 0;
      draw(o, (el / 1000) * (TAU / 5.2), b);
      if (capped || (o.state === "spoke" && b === 0 && now - o.spokeAt >= BLOOM)) { o.anim = false; return; }
    }
    o.raf = requestAnimationFrame(function (n) { tick(o, n); });
  }

  function apply(o) {
    var s = stateOf(o.el);
    if (s === "plain" || s === "off") { teardown(o); o.state = s; return; }
    if (!o.gl) {
      if (mq("(prefers-reduced-transparency: reduce)") || mq("(forced-colors: active)") || !build(o)) { teardown(o); o.state = s; return; }
    }
    var was = o.state;
    o.state = s;
    o.env = envs();
    stop(o);
    var t0 = performance.now();
    var motion = !mq("(prefers-reduced-motion: reduce)");
    if (s === "think" || s === "refresh") {
      if (was !== s || !o.anim) { o.t0 = t0; }
      o.anim = motion;
    } else if (s === "spoke") {
      o.spokeAt = t0;
      o.anim = motion;
      if (!o.t0) o.t0 = t0;
    } else {
      o.anim = false;
    }
    if (o.anim && o.vis && !document.hidden) {
      o.last = 0;
      o.raf = requestAnimationFrame(function (n) { tick(o, n); });
    } else {
      draw(o, 0, 0);
    }
  }

  function mount(el) {
    if (!el || ORBS.has(el) || el.offsetWidth < MIN) return;
    var o = { el: el, gl: null, cv: null, raf: 0, state: "", anim: false, vis: true, last: 0, t0: 0, spokeAt: 0, env: null, mo: null, io: null };
    ORBS.set(el, o);
    var host = el.closest("[data-nn]") || el;
    o.mo = new MutationObserver(function () { apply(o); });
    o.mo.observe(host, { attributes: true, attributeFilter: ["data-nn"] });
    if (host !== el) o.mo.observe(el, { attributes: true, attributeFilter: ["data-nn"] });
    if (el.classList.contains("nn-mirror")) o.mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-nn-busy"] });
    if (typeof IntersectionObserver === "function") {
      o.vis = false;
      o.io = new IntersectionObserver(function (es) {
        var v = es[es.length - 1].isIntersecting;
        if (v === o.vis) return;
        o.vis = v;
        if (!v) stop(o); else if (o.anim && !o.raf && o.gl) o.raf = requestAnimationFrame(function (n) { tick(o, n); });
      });
      o.io.observe(el);
    }
    apply(o);
  }

  function update(el, state) {
    var o = ORBS.get(el);
    if (!o) { mount(el); return; }
    if (typeof state === "string") el.setAttribute("data-nn", state);
    apply(o);
  }

  function destroy(el) {
    var o = ORBS.get(el);
    if (!o) return;
    teardown(o);
    if (o.mo) o.mo.disconnect();
    if (o.io) o.io.disconnect();
    ORBS.delete(el);
  }

  function scan(root) {
    (root || document).querySelectorAll(".nn-orb").forEach(function (el) {
      if (!ORBS.has(el)) mount(el);
    });
  }

  document.addEventListener("visibilitychange", function () {
    ORBS.forEach(function (o) {
      if (document.hidden) stop(o);
      else if (o.anim && o.vis && o.gl && !o.raf) o.raf = requestAnimationFrame(function (n) { tick(o, n); });
    });
  });

  window.FlowsUI = Object.freeze(Object.assign({}, window.FlowsUI, { nnOrb: Object.freeze({ mount: mount, update: update, destroy: destroy, scan: scan }) }));
  scan();
}());
