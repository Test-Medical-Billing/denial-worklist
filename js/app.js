(function () {
  "use strict";
  var Engine = window.DenialEngine, Codes = window.DenialCodes, Exporter = window.DenialExport;
  var B = Codes.BUCKETS;
  var BUCKET_CLASS = {};
  BUCKET_CLASS[B.FIX] = "fix"; BUCKET_CLASS[B.APPEAL] = "appeal"; BUCKET_CLASS[B.COVERAGE] = "coverage";
  BUCKET_CLASS[B.PATIENT] = "patient"; BUCKET_CLASS[B.REVIEW] = "review"; BUCKET_CLASS[B.NONE] = "none";
  var WORK_BUCKETS = [B.FIX, B.APPEAL, B.COVERAGE, B.REVIEW, B.PATIENT];

  var state = {
    eraFiles: [], eftFiles: [], result: null, mask: false, tab: "work",
    filter: { bucket: "work", practice: "", payer: "", q: "", hideDone: false },
    done: loadDone(),
  };

  var $ = function (id) { return document.getElementById(id); };

  // ---------- storage for "done" ticks (this browser only) ----------
  function loadDone() {
    try { return JSON.parse(localStorage.getItem("denial-worklist-done") || "{}"); } catch (e) { return {}; }
  }
  function saveDone() {
    try { localStorage.setItem("denial-worklist-done", JSON.stringify(state.done)); } catch (e) { /* storage unavailable */ }
  }

  // ---------- helpers ----------
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  var fmt = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
  function money(n) { return n == null || isNaN(n) ? "" : fmt.format(n); }
  function patient(n) { return state.mask ? Exporter.maskName(n) : n; }
  function member(m) { return state.mask ? Exporter.maskId(m) : m; }
  function tag(bucket) { return '<span class="tag t-' + BUCKET_CLASS[bucket] + '">' + esc(bucket) + "</span>"; }
  function titleCase(s) {
    return String(s || "").toLowerCase().replace(/\b([a-z])/g, function (m) { return m.toUpperCase(); });
  }

  function message(kind, text) {
    var div = document.createElement("div");
    div.className = "msg msg-" + kind;
    div.textContent = text;
    $("messages").appendChild(div);
  }

  // ---------- file loading ----------
  function wireDrop(zoneId, inputId, kind) {
    var zone = $(zoneId), input = $(inputId);
    input.addEventListener("change", function () { addFiles(input.files, kind); input.value = ""; });
    ["dragenter", "dragover"].forEach(function (ev) {
      zone.addEventListener(ev, function (e) { e.preventDefault(); zone.classList.add("is-over"); });
    });
    ["dragleave", "drop"].forEach(function (ev) {
      zone.addEventListener(ev, function (e) { e.preventDefault(); zone.classList.remove("is-over"); });
    });
    zone.addEventListener("drop", function (e) { addFiles(e.dataTransfer.files, kind); });
    zone.addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); input.click(); }
    });
  }

  // Read one ERA file: an 835 text file or an Availity PDF. Parsed once, then cached.
  function readEra(f) {
    return f.arrayBuffer().then(function (buf) {
      var bytes = new Uint8Array(buf);
      var head = String.fromCharCode.apply(null, bytes.subarray(0, 5));
      if (head === "%PDF-") {
        return window.PdfText.extract(bytes).then(function (pages) {
          if (!pages.some(function (p) { return p.length; })) {
            throw new Error(f.name + ": no text found in this PDF. It may be a scanned image, which can't be read");
          }
          var r = window.AvailityPdf.parse(pages, f.name);
          return { name: f.name, txns: r.txns, warnings: r.warnings };
        }).catch(function (err) { return { name: f.name, error: err.message }; });
      }
      return parseText835(f.name, new TextDecoder().decode(bytes));
    });
  }
  function parseText835(name, text) {
    try { return { name: name, txns: Engine.parse835(text, name), warnings: [] }; }
    catch (err) { return { name: name, error: err.message + ". Check that this is an 835 ERA file or an Availity PDF" }; }
  }

  function addFiles(fileList, kind) {
    var files = Array.prototype.slice.call(fileList || []);
    if (!files.length) return;
    if (kind === "era" && files.some(function (f) { return /\.pdf$/i.test(f.name); })) {
      $("messages").innerHTML = "";
      message("info", "Reading " + files.length + (files.length === 1 ? " file" : " files") + "…");
    }
    Promise.all(files.map(function (f) {
      if (kind === "era") return readEra(f);
      return f.text().then(function (text) { return { name: f.name, text: text }; });
    })).then(function (loaded) {
      var target = kind === "era" ? state.eraFiles : state.eftFiles;
      loaded.forEach(function (f) {
        var i = target.findIndex(function (x) { return x.name === f.name; });
        if (i >= 0) target[i] = f; else target.push(f);
      });
      run();
    });
  }

  function loadSamples() {
    var s = window.DENIAL_SAMPLES;
    state.eraFiles = Object.keys(s.eras).map(function (k) { return parseText835(k, s.eras[k]); });
    state.eftFiles = Object.keys(s.eft).map(function (k) { return { name: k, text: s.eft[k] }; });
    run();
  }

  function clearAll() {
    state.eraFiles = []; state.eftFiles = []; state.result = null;
    run();
  }

  // ---------- run analysis ----------
  function run() {
    $("messages").innerHTML = "";
    var txns = [], seen = {};
    state.eraFiles.forEach(function (f) {
      if (f.error) { message("error", f.error + "."); return; }
      (f.warnings || []).forEach(function (w) { message("warn", w); });
      f.txns.forEach(function (t) {
        var key = [t.payer, t.trace, t.amount, t.claims.length].join("|");
        if (seen[key]) {
          message("warn", f.name + ": payment " + (t.trace || "") + " is already loaded from " + seen[key] + ", so it was skipped.");
          return;
        }
        seen[key] = f.name;
        txns.push(t);
      });
    });

    var eft = null;
    if (state.eftFiles.length) {
      var deposits = [], header = null, columns = null;
      state.eftFiles.forEach(function (f) {
        try {
          var r = Engine.readEft(f.text, f.name);
          deposits = deposits.concat(r.deposits);
          header = header || r.header; columns = columns || r.columns;
          if (r.columns.trace < 0) message("warn", f.name + ": no trace or reference column found, so payments are matched by amount and date only.");
        } catch (err) {
          message("error", err.message);
        }
      });
      if (header) eft = { deposits: deposits, header: header, columns: columns };
    }

    state.result = txns.length ? Engine.analyze(txns, eft) : null;
    renderFileLists();
    render();
  }

  function renderFileLists() {
    var era = state.eraFiles.length, eft = state.eftFiles.length;
    $("list-era").textContent = era ? era + (era === 1 ? " file loaded" : " files loaded") : "";
    $("list-eft").textContent = eft ? eft + (eft === 1 ? " file loaded" : " files loaded") : "";
    $("drop-era").classList.toggle("has-files", era > 0);
    $("drop-eft").classList.toggle("has-files", eft > 0);
    $("btn-clear").hidden = !(era || eft);
  }

  // ---------- render ----------
  function render() {
    var r = state.result;
    $("empty").hidden = !!r;
    $("results").hidden = !r;
    if (!r) return;
    renderFlow(r);
    var toWork = r.work.filter(function (w) { return w.bucket !== B.NONE; });
    $("count-work").textContent = toWork.length;
    $("count-practices").textContent = r.practices.length;
    $("count-payments").textContent = r.recon.rows.length;
    $("count-claims").textContent = r.claims.length;
    renderFilters(r);
    renderWork(r);
    renderPractices(r);
    renderPayments(r);
    renderClaims(r);
    renderGuide();
    showTab(state.tab);
  }

  function renderFlow(r) {
    var billed = r.claims.reduce(function (s, c) { return s + c.charge; }, 0);
    var paid = r.claims.reduce(function (s, c) { return s + c.paid; }, 0);
    var byBucket = {};
    r.work.forEach(function (w) { byBucket[w.bucket] = (byBucket[w.bucket] || 0) + w.amount; });
    var segs = [
      { label: "Paid", cls: "paid", amount: paid },
      { label: "Patient owes", cls: "patient", amount: byBucket[B.PATIENT] || 0 },
      { label: "Contractual, no action", cls: "contract", amount: byBucket[B.NONE] || 0 },
      { label: B.FIX, cls: "fix", amount: byBucket[B.FIX] || 0 },
      { label: B.APPEAL, cls: "appeal", amount: byBucket[B.APPEAL] || 0 },
      { label: B.COVERAGE, cls: "coverage", amount: byBucket[B.COVERAGE] || 0 },
      { label: B.REVIEW, cls: "review", amount: byBucket[B.REVIEW] || 0 },
    ].filter(function (s) { return s.amount > 0.005; });
    var total = Math.max(billed, segs.reduce(function (s, x) { return s + x.amount; }, 0)) || 1;
    var work = (byBucket[B.FIX] || 0) + (byBucket[B.APPEAL] || 0) + (byBucket[B.COVERAGE] || 0) + (byBucket[B.REVIEW] || 0);
    var files = state.eraFiles.length;
    $("flow-lead").innerHTML = "<strong>" + money(billed) + "</strong> billed on " + r.claims.length + " claims from " +
      files + (files === 1 ? " ERA file" : " ERA files") + ". <strong>" + money(paid) + "</strong> paid, <strong>" +
      money(work) + "</strong> denied or held up, and <strong>" + money(byBucket[B.PATIENT] || 0) + "</strong> to bill patients.";
    $("flow-bar").innerHTML = segs.map(function (s) {
      return '<span class="c-' + s.cls + '" style="width:' + (100 * s.amount / total).toFixed(3) + '%" title="' +
        esc(s.label + ": " + money(s.amount)) + '"></span>';
    }).join("");
    $("flow-legend").innerHTML = segs.map(function (s) {
      return '<li><span class="sw c-' + s.cls + '"></span>' + esc(s.label) + " <b>" + money(s.amount) + "</b></li>";
    }).join("");
  }

  function renderFilters(r) {
    var toWork = r.work.filter(function (w) { return w.bucket !== B.NONE; });
    function sum(list) { return list.reduce(function (s, w) { return s + w.amount; }, 0); }
    var chips = [{ key: "work", label: "All to work", items: toWork }];
    WORK_BUCKETS.forEach(function (b) {
      var items = r.work.filter(function (w) { return w.bucket === b; });
      if (items.length) chips.push({ key: b, label: b, items: items, cls: BUCKET_CLASS[b] });
    });
    var none = r.work.filter(function (w) { return w.bucket === B.NONE; });
    if (none.length) chips.push({ key: B.NONE, label: B.NONE, items: none, cls: "none" });
    $("bucket-chips").innerHTML = chips.map(function (c) {
      return '<button type="button" class="chip" data-bucket="' + esc(c.key) + '" aria-pressed="' + (state.filter.bucket === c.key) + '">' +
        (c.cls ? '<span class="sw c-' + c.cls + '"></span>' : "") + esc(c.label) + " <b>" + c.items.length + "</b> " + money(sum(c.items)) + "</button>";
    }).join("");

    fillSelect("f-practice", "All practices", uniq(r.work.map(function (w) { return w.practice; })), state.filter.practice);
    fillSelect("f-payer", "All payers", uniq(r.work.map(function (w) { return w.payer; })), state.filter.payer);
  }

  function uniq(a) { return a.filter(function (v, i) { return v && a.indexOf(v) === i; }).sort(); }
  function fillSelect(id, all, values, current) {
    if (values.indexOf(current) < 0) current = "";
    $(id).innerHTML = '<option value="">' + all + "</option>" + values.map(function (v) {
      return '<option value="' + esc(v) + '"' + (v === current ? " selected" : "") + ">" + esc(titleCase(v)) + "</option>";
    }).join("");
    if (id === "f-practice") state.filter.practice = current; else state.filter.payer = current;
  }

  function filteredWork(r) {
    var f = state.filter, q = f.q.trim().toLowerCase();
    return r.work.filter(function (w) {
      if (f.bucket === "work" ? w.bucket === B.NONE : w.bucket !== f.bucket) return false;
      if (f.practice && w.practice !== f.practice) return false;
      if (f.payer && w.payer !== f.payer) return false;
      if (f.hideDone && state.done[Exporter.itemKey(w)]) return false;
      if (q) {
        var hay = [w.patientName, w.memberId, w.claimId, w.payerClaimNo, w.code, w.cpt, w.meaning, w.remarks].join(" ").toLowerCase();
        if (hay.indexOf(q) < 0) return false;
      }
      return true;
    });
  }

  function renderWork(r) {
    var rows = filteredWork(r);
    var head = "<thead><tr><th>Done</th><th>Action</th><th class=\"num\">Amount</th><th>Code</th><th>What it means and what to do</th>" +
      "<th>Remarks</th><th>Patient</th><th>Claim</th><th>Service date</th><th>Procedure</th><th>Payer</th><th>Practice</th></tr></thead>";
    var body = rows.length ? rows.map(function (w) {
      var key = Exporter.itemKey(w), done = !!state.done[key];
      return '<tr class="' + (done ? "is-done" : "") + '">' +
        '<td><input type="checkbox" data-key="' + esc(key) + '"' + (done ? " checked" : "") + ' aria-label="Mark as done"></td>' +
        "<td>" + tag(w.bucket) + "</td>" +
        '<td class="num">' + money(w.amount) + "</td>" +
        '<td class="nowrap">' + esc(w.code) + "</td>" +
        '<td class="what"><p>' + esc(w.meaning) + "</p><p>" + esc(w.action) + "</p></td>" +
        '<td class="nowrap muted">' + esc(w.remarks) + "</td>" +
        '<td class="nowrap">' + esc(titleCase(patient(w.patientName))) + '<br><span class="muted">' + esc(member(w.memberId)) + "</span></td>" +
        '<td class="nowrap">' + esc(w.claimId) + '<br><span class="muted">' + esc(w.payerClaimNo) + "</span></td>" +
        '<td class="nowrap">' + esc(w.dos) + "</td>" +
        '<td class="nowrap">' + esc(w.cpt) + "</td>" +
        "<td>" + esc(titleCase(w.payer)) + "</td>" +
        "<td>" + esc(titleCase(w.practice)) + "</td></tr>";
    }).join("") : '<tr class="empty-row"><td colspan="12">Nothing here with these filters.</td></tr>';
    $("t-work").innerHTML = head + "<tbody>" + body + "</tbody>";
  }

  function renderPractices(r) {
    var max = 0;
    r.practices.forEach(function (p) { p.topReasons.forEach(function (x) { max = Math.max(max, x.amount); }); });
    $("panel-practices").innerHTML = '<div class="practice-list">' + r.practices.map(function (p) {
      var reasons = p.topReasons.length ? p.topReasons.map(function (x) {
        return '<div class="reason"><span>' + esc(x.code) + " " + esc(x.meaning) + ' <span class="muted">(' + x.count + ")</span></span>" +
          '<span class="amt">' + money(x.amount) + '</span><div class="bar"><span class="c-' + BUCKET_CLASS[x.bucket] +
          '" style="width:' + (max ? (100 * x.amount / max).toFixed(1) : 0) + '%"></span></div></div>';
      }).join("") : '<p class="muted">No denials to work.</p>';
      return '<article class="practice"><div><h3>' + esc(titleCase(p.practice)) + '</h3><dl class="facts">' +
        "<dt>Claims</dt><dd>" + p.claims + "</dd>" +
        "<dt>Billed</dt><dd>" + money(p.charges) + "</dd>" +
        "<dt>Paid</dt><dd>" + money(p.paid) + "</dd>" +
        "<dt>Patient owes</dt><dd>" + money(p.patientResp) + "</dd>" +
        "<dt>Denied claims</dt><dd>" + p.denied + " (" + Math.round(p.denialRate * 100) + "%)</dd>" +
        "<dt>Money to work</dt><dd class=\"big\">" + money(p.atRisk) + "</dd>" +
        "<dt>Payment problems</dt><dd>" + p.paymentIssues + "</dd>" +
        '</dl></div><div class="reasons"><h4>Biggest denial reasons</h4>' + reasons + "</div></article>";
    }).join("") + "</div>";
  }

  function statusClass(s) {
    if (/^Matched/.test(s)) return "s-ok";
    if (s === "Amount mismatch" || s === "No deposit found") return "s-err";
    if (/^Paper check/.test(s)) return "s-warn";
    return "s-info";
  }

  function renderPayments(r) {
    var rec = r.recon, rows = rec.rows;
    var count = function (pred) { return rows.filter(pred).length; };
    var html = "";
    if (!rec.hasEft) {
      html += '<p class="section-note">Add an EFT deposit file (CSV) above to check that each payment reached the bank. Below is every payment in the ERA files.</p>';
    } else {
      html += '<div class="pay-summary"><span>Matched <b>' + count(function (x) { return /^Matched/.test(x.status); }) + "</b></span>" +
        "<span>Amount mismatch <b>" + count(function (x) { return x.status === "Amount mismatch"; }) + "</b></span>" +
        "<span>No deposit found <b>" + count(function (x) { return x.status === "No deposit found"; }) + "</b></span>" +
        "<span>Paper checks <b>" + count(function (x) { return /^Paper check/.test(x.status); }) + "</b></span>" +
        "<span>Deposits with no ERA <b>" + rec.unmatchedDeposits.length + "</b></span>" +
        (r.eftColumns ? '<span class="muted">Matched on columns: ' + ["trace", "amount", "date"].filter(function (k) { return r.eftColumns[k] >= 0; })
          .map(function (k) { return esc(r.eftHeader[r.eftColumns[k]]); }).join(", ") + "</span>" : "") + "</div>";
    }
    html += '<div class="table-wrap"><table class="grid"><thead><tr><th>Status</th><th>Payer</th><th>Practice</th><th>Method</th><th>ERA date</th>' +
      '<th>Trace or check #</th><th class="num">ERA amount</th><th class="num">Deposit</th><th class="num">Difference</th><th>ERA adds up</th></tr></thead><tbody>' +
      rows.map(function (x) {
        return '<tr><td><span class="status ' + statusClass(x.status) + '">' + esc(x.status) + "</span></td>" +
          "<td>" + esc(titleCase(x.payer)) + "</td><td>" + esc(titleCase(x.practice)) + "</td><td>" + esc(x.method) + "</td>" +
          '<td class="nowrap">' + esc(x.date) + '</td><td class="nowrap">' + esc(x.trace) + "</td>" +
          '<td class="num">' + money(x.amount) + '</td><td class="num">' + (x.deposit ? money(x.deposit.amount) : "") + "</td>" +
          '<td class="num">' + (x.difference ? money(x.difference) : "") + "</td>" +
          "<td>" + (x.balances ? "Yes" : '<span class="status s-err" title="Claim payments minus provider adjustments do not equal the payment amount">No</span>') + "</td></tr>";
      }).join("") + "</tbody></table></div>";

    if (rec.unmatchedDeposits.length) {
      html += '<h3 class="section">Deposits with no ERA</h3><p class="section-note">Money reached the bank but no ERA was loaded for it. Find the ERA so it can be posted.</p>' +
        '<div class="table-wrap"><table class="grid"><thead><tr><th>Deposit date</th><th>Description</th><th>Trace</th><th class="num">Amount</th><th>File</th></tr></thead><tbody>' +
        rec.unmatchedDeposits.map(function (d) {
          return '<tr><td class="nowrap">' + esc(d.date) + "</td><td>" + esc(d.description) + '</td><td class="nowrap">' + esc(d.trace) +
            '</td><td class="num">' + money(d.amount) + '</td><td class="muted">' + esc(d.file) + " row " + d.row + "</td></tr>";
        }).join("") + "</tbody></table></div>";
    }
    if (r.plb.length) {
      html += '<h3 class="section">Provider-level adjustments</h3><p class="section-note">Amounts the payer added or took back outside of claims, such as interest (L6) or overpayment recovery (WO). Positive amounts reduce the payment.</p>' +
        '<div class="table-wrap"><table class="grid"><thead><tr><th>Payer</th><th>Practice</th><th>Reason</th><th>Reference</th><th class="num">Amount</th><th>Trace</th></tr></thead><tbody>' +
        r.plb.map(function (p) {
          return "<tr><td>" + esc(titleCase(p.payer)) + "</td><td>" + esc(titleCase(p.practice)) + "</td><td>" + esc(p.reason) + "</td><td>" + esc(p.reference) +
            '</td><td class="num">' + money(p.amount) + '</td><td class="nowrap">' + esc(p.trace) + "</td></tr>";
        }).join("") + "</tbody></table></div>";
    }
    $("panel-payments").innerHTML = html;
  }

  function renderClaims(r) {
    var oc = { "Paid": "s-ok", "Partially paid": "s-warn", "Denied": "s-err", "Reversed": "s-warn", "Reversed, reprocessed": "s-info", "Patient owes all": "s-info" };
    var claims = r.claims.slice().sort(function (a, b) { return b.actionable - a.actionable; });
    $("t-claims").innerHTML = "<thead><tr><th>Result</th><th>Patient</th><th>Claim</th><th>Service date</th><th>Procedures</th>" +
      '<th class="num">Billed</th><th class="num">Paid</th><th class="num">Patient owes</th><th class="num">To work</th><th>Payer</th><th>Practice</th></tr></thead><tbody>' +
      claims.map(function (c) {
        return '<tr><td><span class="status ' + (oc[c.outcome] || "s-info") + '">' + esc(c.outcome) + "</span></td>" +
          '<td class="nowrap">' + esc(titleCase(patient(c.patientName))) + '<br><span class="muted">' + esc(member(c.memberId)) + "</span></td>" +
          '<td class="nowrap">' + esc(c.claimId) + '<br><span class="muted">' + esc(c.payerClaimNo) + "</span></td>" +
          '<td class="nowrap">' + esc(c.dos) + "</td><td>" + esc(c.cpts) + "</td>" +
          '<td class="num">' + money(c.charge) + '</td><td class="num">' + money(c.paid) + '</td><td class="num">' + money(c.patientResp) +
          '</td><td class="num">' + (c.actionable ? money(c.actionable) : "") + "</td>" +
          "<td>" + esc(titleCase(c.payer)) + "</td><td>" + esc(titleCase(c.practice)) + "</td></tr>";
      }).join("") + "</tbody>";
  }

  function renderGuide() {
    var order = [B.FIX, B.APPEAL, B.COVERAGE, B.REVIEW, B.PATIENT, B.NONE];
    var keys = Object.keys(Codes.CARC).sort(function (a, b) {
      var d = order.indexOf(Codes.CARC[a][0]) - order.indexOf(Codes.CARC[b][0]);
      return d || (parseInt(a, 10) || 999) - (parseInt(b, 10) || 999);
    });
    $("panel-guide").innerHTML = '<p class="section-note">How each denial reason code is sorted. Your team can change any row in <code>js/codes.js</code>.</p>' +
      '<div class="table-wrap"><table class="grid"><thead><tr><th>Code</th><th>Action</th><th>What it means</th><th>What to do</th></tr></thead><tbody>' +
      keys.map(function (k) {
        var e = Codes.CARC[k];
        return '<tr><td class="nowrap">' + esc(k) + "</td><td>" + tag(e[0]) + "</td><td>" + esc(e[1]) + "</td><td>" + esc(e[2]) + "</td></tr>";
      }).join("") + "</tbody></table></div>";
  }

  function showTab(name) {
    state.tab = name;
    Array.prototype.forEach.call(document.querySelectorAll("#tabs button"), function (b) {
      b.setAttribute("aria-selected", String(b.dataset.tab === name));
    });
    ["work", "practices", "payments", "claims", "guide"].forEach(function (t) { $("panel-" + t).hidden = t !== name; });
  }

  function downloadExcel() {
    if (!state.result) return;
    var bytes = window.XlsxWriter.writeXlsx(Exporter.buildSheets(state.result, { mask: state.mask, done: state.done }));
    var blob = new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "denial-worklist-" + new Date().toISOString().slice(0, 10) + ".xlsx";
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  // ---------- events ----------
  wireDrop("drop-era", "input-era", "era");
  wireDrop("drop-eft", "input-eft", "eft");
  $("btn-sample").addEventListener("click", loadSamples);
  $("btn-clear").addEventListener("click", clearAll);
  $("btn-excel").addEventListener("click", downloadExcel);
  $("mask").addEventListener("change", function (e) { state.mask = e.target.checked; render(); });
  $("tabs").addEventListener("click", function (e) {
    var b = e.target.closest("button[data-tab]");
    if (b) showTab(b.dataset.tab);
  });
  $("bucket-chips").addEventListener("click", function (e) {
    var c = e.target.closest(".chip");
    if (!c) return;
    state.filter.bucket = c.dataset.bucket;
    renderFilters(state.result); renderWork(state.result);
  });
  $("f-practice").addEventListener("change", function (e) { state.filter.practice = e.target.value; renderWork(state.result); });
  $("f-payer").addEventListener("change", function (e) { state.filter.payer = e.target.value; renderWork(state.result); });
  $("f-search").addEventListener("input", function (e) { state.filter.q = e.target.value; renderWork(state.result); });
  $("f-hide-done").addEventListener("change", function (e) { state.filter.hideDone = e.target.checked; renderWork(state.result); });
  $("t-work").addEventListener("change", function (e) {
    var cb = e.target;
    if (!cb.dataset || !cb.dataset.key) return;
    if (cb.checked) state.done[cb.dataset.key] = Date.now(); else delete state.done[cb.dataset.key];
    saveDone();
    renderWork(state.result);
  });

  render();
})();
