/*
 * Small PDF text reader for computer-generated PDFs (such as Availity remittance PDFs).
 * Returns, for each page, the text pieces with their position.
 * Not a general PDF library: it does not handle scanned images, encryption, or every font type.
 * Runs in the browser (uses DecompressionStream) or in Node (uses zlib).
 */
(function (root) {
  var isNode = typeof module !== "undefined" && module.exports;

  function bytesToLatin1(bytes) {
    var out = "", CHUNK = 0x8000;
    for (var i = 0; i < bytes.length; i += CHUNK) {
      out += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
    }
    return out;
  }
  function latin1ToBytes(s) {
    var b = new Uint8Array(s.length);
    for (var i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 0xff;
    return b;
  }

  function inflate(bytes) {
    if (isNode) return Promise.resolve(new Uint8Array(require("zlib").inflateSync(Buffer.from(bytes))));
    var ds = new DecompressionStream("deflate");
    var stream = new Blob([bytes]).stream().pipeThrough(ds);
    return new Response(stream).arrayBuffer().then(function (b) { return new Uint8Array(b); });
  }

  // ---------- object parsing ----------
  function readObjects(src) {
    var objs = {};
    var re = /(\d+)\s+(\d+)\s+obj\b/g, m;
    var starts = [];
    while ((m = re.exec(src))) starts.push({ num: m[1], index: m.index, bodyStart: re.lastIndex });
    starts.forEach(function (s, i) {
      var end = src.indexOf("endobj", s.bodyStart);
      if (end < 0) end = i + 1 < starts.length ? starts[i + 1].index : src.length;
      var body = src.slice(s.bodyStart, end);
      var obj = { body: body, stream: null };
      var si = body.search(/\bstream\r?\n/);
      if (si >= 0) {
        var dataStart = body.indexOf("\n", si) + 1;
        var dict = body.slice(0, si);
        var lenMatch = dict.match(/\/Length\s+(\d+)(\s+\d+\s+R)?/);
        var data;
        if (lenMatch && !lenMatch[2]) data = body.substr(dataStart, parseInt(lenMatch[1], 10));
        else data = body.slice(dataStart, body.lastIndexOf("endstream")).replace(/\r?\n$/, "");
        obj.body = dict;
        obj.stream = data;
      }
      objs[s.num] = obj;
    });
    return objs;
  }

  function ref(dict, key) {
    var m = dict.match(new RegExp("/" + key + "\\s*(\\d+)\\s+\\d+\\s+R"));
    return m ? m[1] : null;
  }

  function streamBytes(obj) {
    var raw = latin1ToBytes(obj.stream);
    if (/\/FlateDecode/.test(obj.body)) return inflate(raw);
    if (/\/Filter/.test(obj.body)) return Promise.reject(new Error("Unsupported PDF compression"));
    return Promise.resolve(raw);
  }

  // Inner dictionary text for a key, e.g. /Font << ... >>, handling nesting.
  function subDict(body, key) {
    var i = body.indexOf("/" + key);
    if (i < 0) return null;
    var j = body.indexOf("<<", i);
    var between = body.slice(i + key.length + 1, j);
    if (j < 0 || /\S/.test(between.replace(/\s/g, ""))) return null;
    var depth = 0;
    for (var k = j; k < body.length - 1; k++) {
      if (body[k] === "<" && body[k + 1] === "<") { depth++; k++; }
      else if (body[k] === ">" && body[k + 1] === ">") { depth--; k++; if (depth === 0) return body.slice(j + 2, k - 1); }
    }
    return null;
  }

  // ---------- ToUnicode CMap ----------
  function parseCMap(text) {
    var map = {}, width = 2, m;
    var bfchar = /beginbfchar([\s\S]*?)endbfchar/g;
    while ((m = bfchar.exec(text))) {
      var pairs = m[1].match(/<[0-9A-Fa-f]+>/g) || [];
      for (var i = 0; i + 1 < pairs.length; i += 2) {
        var src = pairs[i].slice(1, -1);
        width = src.length / 2;
        map[parseInt(src, 16)] = hexToUnicode(pairs[i + 1].slice(1, -1));
      }
    }
    var bfrange = /beginbfrange([\s\S]*?)endbfrange/g;
    while ((m = bfrange.exec(text))) {
      var lines = m[1].split(/\n/);
      lines.forEach(function (line) {
        var arr = line.match(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*(<[0-9A-Fa-f]+>|\[[^\]]*\])/);
        if (!arr) return;
        var lo = parseInt(arr[1], 16), hi = parseInt(arr[2], 16);
        width = arr[1].length / 2;
        if (arr[3][0] === "<") {
          var base = parseInt(arr[3].slice(1, -1), 16);
          for (var c = lo; c <= hi; c++) map[c] = String.fromCharCode(base + (c - lo));
        } else {
          var list = arr[3].match(/<[0-9A-Fa-f]+>/g) || [];
          for (var c2 = lo; c2 <= hi && c2 - lo < list.length; c2++) map[c2] = hexToUnicode(list[c2 - lo].slice(1, -1));
        }
      });
    }
    return { map: map, bytes: width };
  }
  function hexToUnicode(h) {
    var s = "";
    for (var i = 0; i + 3 < h.length + 1; i += 4) s += String.fromCharCode(parseInt(h.substr(i, 4), 16));
    return s;
  }

  function decodeString(raw, font) {
    if (!font || !font.cmap) return raw;
    var out = "", n = font.cmap.bytes;
    for (var i = 0; i + n <= raw.length; i += n) {
      var code = 0;
      for (var k = 0; k < n; k++) code = code * 256 + raw.charCodeAt(i + k);
      out += font.cmap.map[code] !== undefined ? font.cmap.map[code] : "";
    }
    return out;
  }

  // ---------- content stream ----------
  function tokenize(s) {
    var tokens = [], i = 0, n = s.length;
    while (i < n) {
      var c = s[i];
      if (/\s/.test(c)) { i++; continue; }
      if (c === "%") { while (i < n && s[i] !== "\n" && s[i] !== "\r") i++; continue; }
      if (c === "(") {
        var depth = 1, out = ""; i++;
        while (i < n && depth > 0) {
          var ch = s[i];
          if (ch === "\\") {
            var nx = s[i + 1];
            if (/[0-7]/.test(nx)) { var oct = s.substr(i + 1, 3).match(/^[0-7]{1,3}/)[0]; out += String.fromCharCode(parseInt(oct, 8)); i += 1 + oct.length; continue; }
            var esc = { n: "\n", r: "\r", t: "\t", b: "\b", f: "\f" }[nx];
            out += esc !== undefined ? esc : nx === "\r" || nx === "\n" ? "" : nx; i += 2; continue;
          }
          if (ch === "(") depth++;
          else if (ch === ")") { depth--; if (depth === 0) { i++; break; } }
          out += ch; i++;
        }
        tokens.push({ t: "str", v: out }); continue;
      }
      if (c === "<" && s[i + 1] !== "<") {
        var end = s.indexOf(">", i);
        var hex = s.slice(i + 1, end).replace(/\s/g, "");
        if (hex.length % 2) hex += "0";
        var str = "";
        for (var h = 0; h < hex.length; h += 2) str += String.fromCharCode(parseInt(hex.substr(h, 2), 16));
        tokens.push({ t: "str", v: str }); i = end + 1; continue;
      }
      if (c === "<" || c === ">") { tokens.push({ t: "op", v: s.substr(i, 2) }); i += 2; continue; }
      if (c === "[" || c === "]") { tokens.push({ t: c }); i++; continue; }
      if (c === "/") {
        var j = i + 1;
        while (j < n && !/[\s\/\[\]<>()%{}]/.test(s[j])) j++;
        tokens.push({ t: "name", v: s.slice(i + 1, j) }); i = j; continue;
      }
      var k2 = i;
      while (k2 < n && !/[\s\/\[\]<>()%]/.test(s[k2])) k2++;
      var word = s.slice(i, k2);
      if (/^[-+]?(\d+\.?\d*|\.\d+)$/.test(word)) tokens.push({ t: "num", v: parseFloat(word) });
      else tokens.push({ t: "op", v: word });
      i = k2 > i ? k2 : i + 1;
    }
    return tokens;
  }

  function mul(a, b) {
    return [a[0] * b[0] + a[1] * b[2], a[0] * b[1] + a[1] * b[3], a[2] * b[0] + a[3] * b[2],
      a[2] * b[1] + a[3] * b[3], a[4] * b[0] + a[5] * b[2] + b[4], a[4] * b[1] + a[5] * b[3] + b[5]];
  }

  function runContent(text, fonts) {
    var tokens = tokenize(text), stack = [], items = [];
    var ctm = [1, 0, 0, 1, 0, 0], gstack = [];
    var tm = [1, 0, 0, 1, 0, 0], tlm = [1, 0, 0, 1, 0, 0], font = null, size = 10, leading = 0;
    var arr = null;
    function show(strs) {
      var raw = strs.join("");
      var str = decodeString(raw, font);
      if (!str) return;
      var m = mul(tm, ctm);
      items.push({ x: m[4], y: m[5], s: str, size: size * Math.abs(m[3] || m[0] || 1) });
    }
    tokens.forEach(function (tk) {
      if (tk.t === "[") { arr = []; return; }
      if (tk.t === "]") { stack.push({ t: "arr", v: arr }); arr = null; return; }
      if (arr) { if (tk.t === "str") arr.push(tk.v); return; }
      if (tk.t !== "op") { stack.push(tk); return; }
      var a = stack.map(function (x) { return x.v; });
      switch (tk.v) {
        case "q": gstack.push(ctm.slice()); break;
        case "Q": ctm = gstack.pop() || [1, 0, 0, 1, 0, 0]; break;
        case "cm": ctm = mul(a.slice(-6), ctm); break;
        case "BT": tm = [1, 0, 0, 1, 0, 0]; tlm = tm.slice(); break;
        case "Tf": font = fonts[a[a.length - 2]] || null; size = a[a.length - 1]; break;
        case "TL": leading = a[a.length - 1]; break;
        case "Td": tlm = mul([1, 0, 0, 1, a[a.length - 2], a[a.length - 1]], tlm); tm = tlm.slice(); break;
        case "TD": leading = -a[a.length - 1]; tlm = mul([1, 0, 0, 1, a[a.length - 2], a[a.length - 1]], tlm); tm = tlm.slice(); break;
        case "Tm": tlm = a.slice(-6); tm = tlm.slice(); break;
        case "T*": tlm = mul([1, 0, 0, 1, 0, -leading], tlm); tm = tlm.slice(); break;
        case "Tj": show([a[a.length - 1]]); break;
        case "'": tlm = mul([1, 0, 0, 1, 0, -leading], tlm); tm = tlm.slice(); show([a[a.length - 1]]); break;
        case '"': tlm = mul([1, 0, 0, 1, 0, -leading], tlm); tm = tlm.slice(); show([a[a.length - 1]]); break;
        case "TJ": show(a[a.length - 1] || []); break;
      }
      stack = [];
    });
    return items;
  }

  // ---------- pages ----------
  function pageOrder(objs) {
    var rootId = null;
    Object.keys(objs).forEach(function (k) { if (/\/Type\s*\/Catalog/.test(objs[k].body)) rootId = k; });
    var out = [];
    function walk(id, inherited) {
      var o = objs[id];
      if (!o) return;
      var res = ref(o.body, "Resources") || inherited;
      if (/\/Type\s*\/Pages/.test(o.body)) {
        var kids = (o.body.match(/\/Kids\s*\[([^\]]*)\]/) || [, ""])[1].match(/(\d+)\s+\d+\s+R/g) || [];
        kids.forEach(function (k) { walk(k.split(/\s+/)[0], res); });
      } else if (/\/Type\s*\/Page\b/.test(o.body)) out.push({ id: id, resources: res });
    }
    if (rootId) walk(ref(objs[rootId].body, "Pages"));
    if (!out.length) {
      Object.keys(objs).forEach(function (k) { if (/\/Type\s*\/Page\b/.test(objs[k].body)) out.push({ id: k, resources: null }); });
    }
    return out;
  }

  function loadFonts(objs, page) {
    var po = objs[page.id];
    var resBody = subDict(po.body, "Resources") || (page.resources && objs[page.resources] ? objs[page.resources].body : po.body);
    if (ref(po.body, "Resources")) resBody = objs[ref(po.body, "Resources")].body;
    var fontDict = subDict(resBody, "Font");
    if (!fontDict) { var fr = ref(resBody, "Font"); fontDict = fr && objs[fr] ? objs[fr].body : ""; }
    var fonts = {}, jobs = [], re = /\/([^\s\/]+)\s+(\d+)\s+\d+\s+R/g, m;
    while ((m = re.exec(fontDict || ""))) {
      (function (name, id) {
        var fo = objs[id];
        if (!fo) return;
        var tu = ref(fo.body, "ToUnicode");
        fonts[name] = { cmap: null };
        if (tu && objs[tu]) {
          jobs.push(streamBytes(objs[tu]).then(function (b) { fonts[name].cmap = parseCMap(bytesToLatin1(b)); }));
        }
      })(m[1], m[2]);
    }
    return Promise.all(jobs).then(function () { return fonts; });
  }

  function contentIds(objs, pageId) {
    var body = objs[pageId].body;
    var arr = body.match(/\/Contents\s*\[([^\]]*)\]/);
    if (arr) return (arr[1].match(/(\d+)\s+\d+\s+R/g) || []).map(function (r) { return r.split(/\s+/)[0]; });
    var one = ref(body, "Contents");
    return one ? [one] : [];
  }

  function extract(bytes) {
    var src = bytesToLatin1(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
    if (src.slice(0, 5) !== "%PDF-") return Promise.reject(new Error("not a PDF file"));
    if (/\/Encrypt\b/.test(src)) return Promise.reject(new Error("the PDF is password-protected"));
    var objs = readObjects(src);
    var pages = pageOrder(objs);
    return pages.reduce(function (p, page) {
      return p.then(function (acc) {
        return loadFonts(objs, page).then(function (fonts) {
          return Promise.all(contentIds(objs, page.id).map(function (id) {
            return objs[id] ? streamBytes(objs[id]).then(bytesToLatin1) : "";
          })).then(function (parts) {
            acc.push(runContent(parts.join("\n"), fonts));
            return acc;
          });
        });
      });
    }, Promise.resolve([]));
  }

  var api = { extract: extract };
  if (isNode) module.exports = api;
  else root.PdfText = api;
})(this);
