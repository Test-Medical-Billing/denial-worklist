/*
 * Reads Availity "Check Details" remittance PDFs (one or more checks per PDF)
 * and turns them into the same payment structure the 835 reader produces.
 * Uses word positions from pdf-text.js. Built from Availity's 2026 layout;
 * if Availity changes the layout, the balance checks will flag it.
 */
(function (root) {
  var isNode = typeof module !== "undefined" && module.exports;
  var Engine = isNode ? require("./engine.js") : root.DenialEngine;
  var STATUS = Engine.CLAIM_STATUS;

  // ---------- turn positioned words into lines of cells ----------
  function toLines(pages) {
    var lines = [];
    pages.forEach(function (items, p) {
      var rows = {};
      items.forEach(function (it) {
        var key = Math.round(it.y * 2) / 2;
        var found = null;
        Object.keys(rows).forEach(function (k) { if (Math.abs(k - key) < 1.2) found = k; });
        (rows[found !== null ? found : key] = rows[found !== null ? found : key] || []).push(it);
      });
      Object.keys(rows).map(Number).sort(function (a, b) { return b - a; }).forEach(function (y) {
        var words = rows[y].sort(function (a, b) { return a.x - b.x; });
        lines.push({ page: p + 1, y: y, cells: toCells(words) });
      });
    });
    return lines.map(function (l) {
      l.text = l.cells.map(function (c) { return c.s; }).join("  ");
      return l;
    });
  }

  // Approximate printed width of a word (DejaVu Sans proportions).
  function textWidth(s, size) {
    var w = 0;
    for (var i = 0; i < s.length; i++) {
      var ch = s[i];
      if (/[0-9$]/.test(ch)) w += 0.64;
      else if (/[A-Z]/.test(ch)) w += 0.68;
      else if (/[a-z]/.test(ch)) w += 0.58;
      else if (/[.,:;'|!\/\-() ]/.test(ch)) w += 0.36;
      else w += 0.6;
    }
    return w * size;
  }
  function wordGap(prev, w) {
    return w.x - (prev.x + textWidth(prev.s, prev.size));
  }

  function toCells(words) {
    var cells = [];
    words.forEach(function (w) {
      var last = cells[cells.length - 1];
      if (last) {
        var gap = wordGap(last.words[last.words.length - 1], w);
        if (gap < w.size * 1.1) {
          var glue = /-$/.test(last.s) && (/^\$|^\d/.test(w.s) || /^[A-Z]{2}-$/.test(last.s)) ? "" : " ";
          last.s += glue + w.s;
          last.lastX = w.x; last.lastLen = w.s.length;
          last.words.push(w);
          return;
        }
      }
      cells.push({ x: w.x, s: w.s, lastX: w.x, lastLen: w.s.length, words: [w] });
    });
    return cells;
  }

  // ---------- small helpers ----------
  function money(s) {
    if (!s) return 0;
    var m = String(s).replace(/\s/g, "").match(/^(-)?\$?(-)?([\d,]+\.?\d*)/);
    if (!m) return 0;
    var n = parseFloat(m[3].replace(/,/g, ""));
    return m[1] || m[2] ? -n : n;
  }
  function isoDate(s) {
    var m = String(s || "").match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    return m ? m[3] + "-" + ("0" + m[1]).slice(-2) + "-" + ("0" + m[2]).slice(-2) : "";
  }
  function round2(n) { return Math.round(n * 100) / 100; }
  function personName(s) {
    var p = String(s || "").split(",");
    return p.length > 1 ? (p.slice(1).join(" ").trim() + " " + p[0].trim()).trim() : String(s || "").trim();
  }

  var LABELS = ["Patient Name", "Claim Number", "Claim Date", "Claim Status Code", "Patient ID", "Group / Policy",
    "Facility Type", "Claim Charge", "Patient Ctrl Nmbr", "Contract Hdr", "Claim Frequency", "Claim Payment",
    "Rendering Prvd", "Rendering Prv ID", "Claim Received Date", "Patient Resp", "Original Ref Nmbr",
    "Payee Tax ID", "Payee ID", "Payee Name", "Payee Address", "Check/EFT Trace Number", "Payment Amount",
    "Check/EFT Date", "Production End Cycle Date", "Transaction Date"];

  var LABEL_WORDS = LABELS.map(function (l) { return { label: l, words: (l + ":").split(" ") }; })
    .sort(function (a, b) { return b.words.length - a.words.length; });

  // Read "Label: value" pairs from a line. A value is the words after its label,
  // up to the next label or a wide gap (the next column).
  function pairs(line) {
    var words = [];
    line.cells.forEach(function (c) { words = words.concat(c.words); });
    var out = {}, i = 0;
    function labelAt(idx) {
      for (var k = 0; k < LABEL_WORDS.length; k++) {
        var lw = LABEL_WORDS[k].words, ok = true;
        for (var j = 0; j < lw.length; j++) if (!words[idx + j] || words[idx + j].s !== lw[j]) { ok = false; break; }
        if (ok) return LABEL_WORDS[k];
      }
      return null;
    }
    while (i < words.length) {
      var L = labelAt(i);
      if (!L) { i++; continue; }
      i += L.words.length;
      var vals = [];
      while (i < words.length && !labelAt(i)) {
        if (vals.length && wordGap(words[i - 1], words[i]) > words[i].size * 3) break;
        vals.push(words[i].s); i++;
      }
      out[L.label] = vals.join(" ").replace(/^-\s+\$/, "-$").trim();
    }
    return out;
  }

  var ADJ_RE = /^(CO|PR|OA|PI|CR)-([A-Z0-9]+)/;
  var REMARK_RE = /\b(M[A-Z]?\d{1,3}|N\d{1,4})\b/g;

  // Column starts for the "Line Details" table, read from its header row.
  function tableColumns(headerLine) {
    var cols = [];
    var words = [];
    headerLine.cells.forEach(function (c) { words = words.concat(c.words); });
    function at(name) { var w = words.filter(function (w) { return w.s === name; }); return w.length ? w[0].x : null; }
    var adjXs = words.filter(function (w) { return w.s === "Adj"; }).map(function (w) { return w.x; });
    var spec = [["ctrl", at("Line")], ["dates", at("Dates")], ["rend", at("Rend")], ["rev", at("Rev")], ["sub", at("Sub")],
      ["adjud", at("Adjud")], ["remark", at("Remark")], ["supp", at("Supp")], ["charge", at("Charge")],
      ["adjcode", adjXs[0]], ["adjamt", adjXs[1]], ["payment", at("Payment")]];
    spec.forEach(function (s) { if (s[1] != null) cols.push({ key: s[0], start: s[1] - 12 }); });
    cols.sort(function (a, b) { return a.start - b.start; });
    return cols;
  }
  // Put each word in the table column whose header it falls under.
  function assign(line, cols) {
    var row = {};
    line.cells.forEach(function (c) {
      c.words.forEach(function (w) {
        var col = "ctrl";
        cols.forEach(function (k) { if (w.x >= k.start) col = k.key; });
        row[col] = row[col] ? row[col] + " " + w.s : w.s;
      });
    });
    Object.keys(row).forEach(function (k) {
      row[k] = row[k].replace(/-\s+\$/g, "-$").replace(/\b([A-Z]{2})-\s+([A-Z0-9])/g, "$1-$2");
    });
    return row;
  }

  function parseProc(s) {
    // "HC:99393 / 25 / 1"  ->  code 99393, modifiers [25], units 1
    var m = String(s || "").match(/^([A-Z]{1,2}):([A-Z0-9]+)\s*\/?\s*(.*)$/);
    if (!m) return null;
    var rest = m[3].split("/").map(function (x) { return x.trim(); });
    var units = rest.length > 1 ? rest.pop().replace(/\s+/g, "") : "";
    var mods = rest.join(" ").split(/[\s:]+/).filter(Boolean);
    return { code: m[2], modifiers: mods, units: units };
  }

  // ---------- main ----------
  function parse(pages, fileName) {
    var lines = toLines(pages);
    var warnings = [];
    if (!lines.some(function (l) { return /^Check Summary/.test(l.text); }) || !lines.some(function (l) { return /Line Ctrl Nmbr/.test(l.text); })) {
      throw new Error(fileName + ": this PDF layout isn't supported yet. Only Availity \"Check Details\" PDFs can be read for now");
    }

    var txns = [], txn = null, claim = null, svc = null, cols = null, mode = null, payerNext = false;

    function finishClaim() {
      if (!claim) return;
      claim.dos = claim.dos || (claim.services[0] && claim.services[0].dos) || "";
      claim = null; svc = null; cols = null;
    }

    lines.forEach(function (line) {
      var t = line.text;
      // Page furniture repeated on every page.
      if (/^Page\s+\d+$/.test(t)) return;
      if (/^Payer:/.test(t) && /Total Paid:/.test(t)) {
        if (txn && !txn.payer) txn.payer = (t.match(/^Payer:\s*(.*?)\s{2,}/) || [])[1] || "";
        return;
      }
      if (/^Check Summary/.test(t)) {
        finishClaim();
        txn = { file: fileName, payer: "", payerId: "", payee: "", payeeNPI: "", payeeTIN: "", amount: 0, method: "",
          paymentDate: "", trace: "", claims: [], plb: [], source: "Availity PDF" };
        txns.push(txn); mode = "header"; payerNext = true;
        return;
      }
      if (!txn) return;

      var kv = pairs(line);
      if (mode === "header") {
        if (payerNext && line.cells.length && line.cells[0].x < 200 && !/:/.test(line.cells[0].s)) {
          txn.payer = line.cells[0].s; payerNext = false;
        }
        if (kv["Payee Tax ID"]) txn.payeeTIN = kv["Payee Tax ID"];
        if (kv["Payee ID"]) txn.payeeNPI = kv["Payee ID"];
        if (kv["Payee Name"]) txn.payee = kv["Payee Name"];
        if (kv["Check/EFT Trace Number"]) txn.trace = kv["Check/EFT Trace Number"];
        if (kv["Payment Amount"]) txn.amount = money(kv["Payment Amount"]);
        if (kv["Check/EFT Date"]) txn.paymentDate = isoDate(kv["Check/EFT Date"]);
        if (/^Provider Adjustment Code/.test(t)) { mode = "plb"; return; }
      }
      if (mode === "plb" && !/^Patient Name:/.test(t)) {
        var c0 = line.cells[0], amt = line.cells[line.cells.length - 1];
        if (c0 && /^[A-Z0-9]{2}$/.test(c0.s) && amt && /\$/.test(amt.s)) {
          var ref = line.cells.slice(1, -1).map(function (c) { return c.s; }).join(" ");
          txn.plb.push({ providerId: txn.payeeNPI, date: txn.paymentDate, reason: c0.s, reference: ref, amount: money(amt.s) });
        }
        return;
      }

      if (/^Patient Name:/.test(t)) {
        finishClaim();
        mode = "claim";
        var statusCode = (kv["Claim Status Code"] || "").trim();
        var dates = (kv["Claim Date"] || "").match(/\d{1,2}\/\d{1,2}\/\d{4}/g) || [];
        claim = { patientControl: "", statusCode: statusCode, status: STATUS[statusCode] || ("Status " + statusCode),
          charge: 0, paid: 0, patientResp: 0, payerClaimNo: kv["Claim Number"] || "",
          patientName: personName(kv["Patient Name"]), memberId: "", renderingName: "", renderingNPI: "",
          dos: isoDate(dates[0]), adjustments: [], services: [], remarks: [], _readLines: 0 };
        txn.claims.push(claim);
        return;
      }
      if (!claim) return;

      if (mode === "claim") {
        if (kv["Patient ID"] !== undefined) claim.memberId = kv["Patient ID"];
        if (kv["Claim Charge"] !== undefined) claim.charge = money(kv["Claim Charge"]);
        if (kv["Patient Ctrl Nmbr"] !== undefined) claim.patientControl = kv["Patient Ctrl Nmbr"];
        if (kv["Claim Payment"] !== undefined) claim.paid = money(kv["Claim Payment"]);
        if (kv["Rendering Prvd"] !== undefined) claim.renderingName = personName(kv["Rendering Prvd"]);
        if (kv["Rendering Prv ID"] !== undefined) claim.renderingNPI = kv["Rendering Prv ID"];
        if (kv["Patient Resp"] !== undefined) claim.patientResp = money(kv["Patient Resp"]);
        // Claim-level adjustments, if Availity prints any outside the line table.
        var ca = line.cells.filter(function (c) { return ADJ_RE.test(c.s); });
        if (ca.length && !/^Line Details/.test(t)) {
          ca.forEach(function (c) {
            var idx = line.cells.indexOf(c), next = line.cells[idx + 1];
            var m = c.s.match(ADJ_RE);
            if (next && /\$/.test(next.s)) claim.adjustments.push({ group: m[1], code: m[2], amount: money(next.s), level: "claim" });
          });
        }
      }
      if (/^Line Details/.test(t)) { mode = "lines-wait"; return; }
      if (/^Line Ctrl Nmbr/.test(t)) { cols = tableColumns(line); mode = "lines"; return; }
      if (mode === "lines" && /^Service\b/.test(t) && /Modifier/.test(t)) return;
      if (/^Supplemental Information/.test(t)) { mode = "claim-tail"; return; }

      if (mode === "lines" && cols) {
        var row = assign(line, cols);
        var isNew = row.dates && /\d{1,2}\/\d{1,2}\/\d{4}\s*-/.test(row.dates) && row.adjud && /:/.test(row.adjud);
        if (isNew) {
          var proc = parseProc(row.adjud) || parseProc(row.sub) || { code: "", modifiers: [], units: "" };
          svc = { code: proc.code, modifiers: proc.modifiers, charge: money(row.charge), paid: money(row.payment),
            units: proc.units, dos: isoDate(row.dates), adjustments: [], remarks: [] };
          claim.services.push(svc);
        }
        if (!svc) return;
        if (row.adjcode && ADJ_RE.test(row.adjcode)) {
          var am = row.adjcode.match(ADJ_RE);
          svc.adjustments.push({ group: am[1], code: am[2], amount: money(row.adjamt), level: "service" });
        }
        if (row.remark) (row.remark.match(REMARK_RE) || []).forEach(function (r) { if (svc.remarks.indexOf(r) < 0) svc.remarks.push(r); });
      }
    });
    finishClaim();

    // ---------- checks: does what we read add up? ----------
    txns.forEach(function (tx) {
      tx.claims.forEach(function (c) {
        delete c._readLines;
        if (c.services.length) {
          var linePaid = round2(c.services.reduce(function (s, x) { return s + x.paid; }, 0));
          var lineCharge = round2(c.services.reduce(function (s, x) { return s + x.charge; }, 0));
          if (Math.abs(linePaid - c.paid) > 0.01 || Math.abs(lineCharge - c.charge) > 0.01) {
            warnings.push(fileName + ": claim " + (c.payerClaimNo || c.patientControl) + " lines don't add up to the claim totals; check it in the PDF.");
          }
          c.services.forEach(function (s) {
            var adj = round2(s.adjustments.reduce(function (t, a) { return t + a.amount; }, 0));
            if (Math.abs(round2(s.charge - adj - s.paid)) > 0.01) {
              warnings.push(fileName + ": claim " + (c.payerClaimNo || c.patientControl) + ", " + (s.code || "a line") +
                ": charge minus adjustments doesn't equal payment; check it in the PDF.");
            }
          });
        }
      });
      var paid = tx.claims.reduce(function (s, c) { return s + c.paid; }, 0);
      var plb = tx.plb.reduce(function (s, p) { return s + p.amount; }, 0);
      // The 835 standard subtracts provider adjustments from the payment. Availity's PDF may print them
      // with the opposite sign; if flipping them makes the check balance, store them the 835 way.
      if (plb && Math.abs(round2(paid - plb) - round2(tx.amount)) > 0.01 && Math.abs(round2(paid + plb) - round2(tx.amount)) <= 0.01) {
        tx.plb.forEach(function (p) { p.amount = -p.amount; });
        plb = -plb;
      }
      if (Math.abs(round2(paid - plb) - round2(tx.amount)) > 0.01) {
        warnings.push(fileName + ": payment " + tx.trace + " claims (" + round2(paid) + ") minus provider adjustments (" + round2(plb) +
          ") don't equal the payment amount (" + tx.amount + "). Some lines may not have been read.");
      }
    });
    if (!txns.length) throw new Error(fileName + ": no checks found in this PDF");
    return { txns: txns, warnings: warnings };
  }

  var api = { parse: parse, _toLines: toLines };
  if (isNode) module.exports = api;
  else root.AvailityPdf = api;
})(this);
